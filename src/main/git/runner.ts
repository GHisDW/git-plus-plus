import { GitError } from './errors';
import { runProcess, ProcessError, type ProcessResult } from '../process';
import type { AppError } from '../../shared/types';

export interface GitRunOptions {
  cwd: string;
  args: string[];
  timeoutMs?: number;
  maxOutputBytes?: number;
  input?: string;
  allowNonZero?: boolean;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
}

export interface GitResult extends ProcessResult {
  args: string[];
}

const GIT_CONFIG_ARGS = ['-c', 'core.quotePath=false', '-c', 'color.ui=false', '-c', 'core.pager=cat', '-c', 'credential.interactive=never'];

/**
 * Thin, typed wrapper around the Git CLI. All invocations use an argument
 * array (never a shell), a timeout, bounded output, and structured errors.
 */
export class GitRunner {
  private gitPath: string;

  constructor(gitPath = 'git') {
    this.gitPath = gitPath;
  }

  setGitPath(path: string): void {
    this.gitPath = path.trim() || 'git';
  }

  getGitPath(): string {
    return this.gitPath;
  }

  async run(options: GitRunOptions): Promise<GitResult> {
    try {
      const result = await runProcess({
        command: this.gitPath,
        args: [...GIT_CONFIG_ARGS, ...options.args],
        cwd: options.cwd,
        timeoutMs: options.timeoutMs ?? 60_000,
        maxOutputBytes: options.maxOutputBytes ?? 8 * 1024 * 1024,
        input: options.input,
        allowNonZero: options.allowNonZero,
        signal: options.signal,
        env: options.env,
      });
      return { ...result, args: options.args };
    } catch (error) {
      throw GitError.fromProcess(error, this.gitPath);
    }
  }

  async version(cwd = process.cwd()): Promise<string> {
    const result = await this.run({ cwd, args: ['--version'], timeoutMs: 15_000 });
    return result.stdout.trim();
  }

  async detect(cwd = process.cwd()): Promise<{ available: boolean; version: string | null; path: string; error: AppError | null }> {
    try {
      const raw = await this.version(cwd);
      return { available: true, version: raw.replace(/^git version\s*/i, '').trim(), path: this.gitPath, error: null };
    } catch (error) {
      const err = GitError.toAppError(error);
      return { available: false, version: null, path: this.gitPath, error: err };
    }
  }
}

export { ProcessError };
