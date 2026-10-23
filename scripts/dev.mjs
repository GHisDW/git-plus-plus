import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
let electron;
let vite;
let stopping = false;

function cleanup(code = 0) {
  if (stopping) return;
  stopping = true;
  electron?.kill();
  vite?.kill();
  setTimeout(() => process.exit(code), 150);
}

async function waitForPort(port, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    const ready = await new Promise((resolve) => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => { socket.destroy(); resolve(false); });
    });
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('Vite did not start in time.');
}

vite = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', '--port', '5199', '--strictPort'], { stdio: 'inherit' });
await waitForPort(5199);

const build = spawn(process.execPath, ['scripts/build-main.mjs'], { stdio: 'inherit' });
await new Promise((resolve, reject) => build.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('Main build failed')))));

electron = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, GITPP_DEV_URL: 'http://localhost:5199' },
});
electron.on('exit', (code) => cleanup(code ?? 0));
process.on('SIGINT', () => cleanup(0));
process.on('SIGTERM', () => cleanup(0));
