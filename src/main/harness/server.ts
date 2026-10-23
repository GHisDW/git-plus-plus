/**
 * Browser test harness. This is NOT part of the desktop app build: it serves
 * the real renderer against the real main-process API over HTTP so the UI can
 * be exercised and screenshotted in environments where Electron cannot start
 * (for example a Linux container without GTK/X). Renderer code is identical.
 */
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createApi } from '../api';
import { MemorySecretStore } from '../services/secrets';
import { API_METHODS, type ApiMethodName } from '../../shared/contract';
import type { AppEvent } from '../../shared/types';

const port = Number(process.env.GITPP_HARNESS_PORT ?? 5205);
const dataDir = process.env.GITPP_HARNESS_DATA ?? path.join(process.cwd(), '.harness-data');
const rendererDir = path.resolve(process.env.GITPP_RENDERER_DIR ?? path.join(process.cwd(), 'dist', 'renderer'));
const demoRepo = process.env.GITPP_HARNESS_REPO ? path.resolve(process.env.GITPP_HARNESS_REPO) : null;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
};

const BRIDGE_JS = `
(() => {
  const call = async (method, payload) => {
    const response = await fetch('/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, payload: payload ?? {} }),
    });
    if (!response.ok) {
      let message = 'Harness transport error (' + response.status + ')';
      try { const body = await response.json(); message = body.message || message; } catch {}
      return { ok: false, error: { code: 'INTERNAL', kind: 'unknown', message } };
    }
    return response.json();
  };
  window.gitpp = {
    transport: 'http',
    platform: 'linux',
    invoke: call,
    onEvent: () => () => {},
    startup: async () => ({ warnings: [] }),
    onMenuCommand: () => () => {},
    window: undefined,
  };
})();
`;

async function main(): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
  const events: AppEvent[] = [];
  const api = await createApi({
    dataDir,
    secrets: new MemorySecretStore(),
    host: {
      meta: {
        name: 'Git++',
        version: '1.0.0',
        platform: 'linux',
        electron: 'test-harness',
        chrome: 'playwright',
        node: process.versions.node,
        dataDir,
        isPackaged: false,
      },
      openDirectoryDialog: async () => demoRepo,
      openFileDialog: async () => null,
      openExternal: async () => true,
      showItemInFolder: () => undefined,
      emit: (event) => {
        events.push(event);
        if (events.length > 200) events.shift();
      },
    },
  });

  if (demoRepo) {
    try {
      await api.git.open(demoRepo);
      const diffMode = process.env.GITPP_HARNESS_DIFF;
      if (diffMode === 'split') await api.settings.update({ diff: { mode: 'split' } });
      if (process.env.GITPP_HARNESS_THEME) await api.settings.update({ theme: process.env.GITPP_HARNESS_THEME as 'dark' | 'light' });
    } catch (error) {
      console.error('[harness] Could not open demo repository:', error);
    }
  }

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
      if (request.method === 'GET' && url.pathname === '/health') {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ ok: true, repo: demoRepo, dataDir }));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/harness-bridge.js') {
        response.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' });
        response.end(BRIDGE_JS);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/rpc') {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of request) {
          size += (chunk as Buffer).length;
          if (size > 20 * 1024 * 1024) {
            response.writeHead(413, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ message: 'Request too large' }));
            return;
          }
          chunks.push(chunk as Buffer);
        }
        let body: { method?: unknown; payload?: unknown };
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        } catch {
          response.writeHead(400, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ message: 'Invalid JSON' }));
          return;
        }
        if (typeof body.method !== 'string' || !API_METHODS.includes(body.method as ApiMethodName)) {
          response.writeHead(400, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ message: 'Unknown method' }));
          return;
        }
        const result = await api.invoke(body.method as ApiMethodName, body.payload ?? {});
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(result));
        return;
      }
      if (request.method !== 'GET') {
        response.writeHead(405);
        response.end();
        return;
      }

      const requested = url.pathname === '/' ? '/index.html' : url.pathname;
      const safeRelative = requested.replace(/^\/+/, '');
      if (safeRelative.includes('..') || safeRelative.includes('\0')) {
        response.writeHead(400);
        response.end('Bad path');
        return;
      }
      const filePath = path.join(rendererDir, safeRelative);
      let content = await fs.readFile(filePath).catch(() => null);
      if (!content) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not found');
        return;
      }
      if (safeRelative === 'index.html') {
        const html = content.toString('utf8');
        content = Buffer.from(html.replace('<head>', '<head>\n    <script src="/harness-bridge.js"></script>'));
      }
      response.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(content);
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ message: String(error) }));
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`[harness] Git++ test harness listening on http://127.0.0.1:${port} (repo: ${demoRepo ?? 'none'})`);
  });
}

void main();
