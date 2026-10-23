import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { redact } from '../shared/errors';

export interface RunProcessOptions {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  input?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  /** Allow a non-zero exit code without throwing. */
  allowNonZero?: boolean;
}

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  timedOut: boolean;
  cancelled: boolean;
  truncated: boolean;
  commandLine: string;
}

export class ProcessError extends Error {
  readonly result: ProcessResult;
  readonly code: 'ENOENT' | 'EXIT' | 'TIMEOUT' | 'CANCELLED';

  constructor(code: 'ENOENT' | 'EXIT' | 'TIMEOUT' | 'CANCELLED', message: string, result: ProcessResult) {
    super(message);
    this.name = 'ProcessError';
    this.code = code;
    this.result = result;
  }
}

function quoteForDisplay(value: string): string {
  return /^[\w./:@%+=,-]+$/.test(value) ? value : `"${value.replace(/"/g, '\\"')}"`;
}

export function displayCommand(command: string, args: string[]): string {
  return [command, ...args].map(quoteForDisplay).join(' ');
}

function killTree(pid: number | undefined, detached: boolean): void {
  if (!pid) return;
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } catch {
      /* best effort */
    }
    return;
  }
  try {
    if (detached) process.kill(-pid, 'SIGKILL');
    else process.kill(pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

/**
 * Spawn a process without a shell. Arguments are passed as an array, so values
 * containing spaces, quotes, or shell metacharacters cannot be interpreted.
 * Output is bounded to protect the main process from a chatty child.
 */
export function runProcess(options: RunProcessOptions): Promise<ProcessResult> {
  const {
    command,
    args,
    cwd,
    timeoutMs = 60_000,
    maxOutputBytes = 4 * 1024 * 1024,
    input,
    signal,
    allowNonZero = false,
  } = options;
  const started = Date.now();
  const commandLine = displayCommand(command, args);

  return new Promise<ProcessResult>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ProcessError('CANCELLED', 'Cancelled before start', {
        stdout: '', stderr: '', exitCode: null, signal: null, durationMs: 0,
        timedOut: false, cancelled: true, truncated: false, commandLine,
      }));
      return;
    }
    if (command.includes('/') || command.includes('\\')) {
      if (!existsSync(command)) {
        reject(new ProcessError('ENOENT', `Executable not found: ${command}`, {
          stdout: '', stderr: '', exitCode: null, signal: null, durationMs: 0,
          timedOut: false, cancelled: false, truncated: false, commandLine,
        }));
        return;
      }
    }

    let child;
    try {
      child = spawn(command, args, {
        cwd,
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_PAGER: 'cat',
          GIT_EDITOR: 'true',
          GIT_MERGE_AUTOEDIT: 'no',
          LC_ALL: 'C',
          LANG: 'C',
          NO_COLOR: '1',
          ...options.env,
        },
      });
    } catch (error) {
      reject(new ProcessError('ENOENT', 'Failed to start process', {
        stdout: '', stderr: String(error), exitCode: null, signal: null, durationMs: 0,
        timedOut: false, cancelled: false, truncated: false, commandLine,
      }));
      return;
    }

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let truncated = false;
    let timedOut = false;
    let cancelled = false;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      const durationMs = Date.now() - started;
      const result: ProcessResult = {
        stdout: redact(stdoutChunks.join('')),
        stderr: redact(stderrChunks.join('')),
        exitCode: child.exitCode,
        signal: child.signalCode,
        durationMs,
        timedOut,
        cancelled,
        truncated,
        commandLine,
      };
      if (cancelled) reject(new ProcessError('CANCELLED', 'Operation cancelled', result));
      else if (timedOut) reject(new ProcessError('TIMEOUT', `Timed out after ${timeoutMs}ms`, result));
      else if (result.exitCode !== 0 && !allowNonZero) reject(new ProcessError('EXIT', `Process exited with code ${result.exitCode}`, result));
      else resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid, process.platform !== 'win32');
    }, timeoutMs);
    timer.unref?.();

    const onAbort = () => {
      cancelled = true;
      killTree(child.pid, process.platform !== 'win32');
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdoutBytes += Buffer.byteLength(chunk);
      if (stdoutBytes <= maxOutputBytes) stdoutChunks.push(chunk);
      else truncated = true;
    });
    child.stderr.on('data', (chunk: string) => {
      stderrBytes += Buffer.byteLength(chunk);
      if (stderrBytes <= maxOutputBytes) stderrChunks.push(chunk);
      else truncated = true;
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (settled) return;
      settled = true;
      const code = error.code === 'ENOENT' ? 'ENOENT' : 'EXIT';
      reject(new ProcessError(code, error.message, {
        stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') + `\n${error.message}`,
        exitCode: null, signal: null, durationMs: Date.now() - started,
        timedOut: false, cancelled: false, truncated, commandLine,
      }));
    });
    child.on('close', () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      finish();
    });
    if (input !== undefined) {
      child.stdin.on('error', () => undefined);
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
  });
}
