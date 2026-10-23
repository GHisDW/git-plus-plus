import { ERR, makeError, isErrno } from '../../shared/errors';
import type { AppError } from '../../shared/types';
import { ProcessError } from '../process';

/** Translate Git/process failures into actionable, redacted application errors. */
export class GitError extends Error {
  readonly appError: AppError;
  readonly stderr: string;
  readonly exitCode: number | null;

  constructor(appError: AppError, stderr = '', exitCode: number | null = null) {
    super(appError.message);
    this.name = 'GitError';
    this.appError = appError;
    this.stderr = stderr;
    this.exitCode = exitCode;
  }

  static fromProcess(error: unknown, gitPath: string): GitError {
    if (error instanceof GitError) return error;
    if (error instanceof ProcessError) {
      const stderr = error.result.stderr ?? '';
      const stdout = error.result.stdout ?? '';
      if (error.code === 'ENOENT') {
        return new GitError(ERR.gitNotFound(), stderr, null);
      }
      if (error.code === 'TIMEOUT') {
        return new GitError(
          makeError('TIMEOUT', 'timeout', error.message, {
            hint: 'The Git operation may still be running. Refresh the repository before retrying.',
            stderr,
          }),
          stderr,
          error.result.exitCode,
        );
      }
      if (error.code === 'CANCELLED') {
        return new GitError(ERR.cancelled('Git operation'), stderr, error.result.exitCode);
      }
      return new GitError(translateGitFailure(stderr || stdout, gitPath, error.result.commandLine), stderr, error.result.exitCode);
    }
    const errno = isErrno(error);
    if (errno?.code === 'ENOENT') return new GitError(ERR.gitNotFound(), String(error), null);
    return new GitError(ERR.internal('Unexpected Git failure', String(error)), String(error), null);
  }

  static toAppError(error: unknown): AppError {
    if (error instanceof GitError) return error.appError;
    return ERR.internal('Unexpected error', String(error));
  }
}

const NETWORK_HINTS = [
  'could not resolve host',
  'could not read from remote repository',
  'connection timed out',
  'connection refused',
  'network is unreachable',
  'ssl certificate problem',
  'failed to connect',
  'unable to access',
];
const AUTH_HINTS = [
  'authentication failed',
  'could not read username',
  'could not read password',
  'permission denied (publickey)',
  'terminal prompts disabled',
  'invalid username or password',
  'support for password authentication was removed',
  'host key verification failed',
];

function firstLine(text: string): string {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const interesting = lines.find((line) => !line.startsWith('hint:')) ?? lines[0] ?? 'Git command failed';
  return interesting.replace(/^(fatal|error):\s*/i, '');
}

export function translateGitFailure(raw: string, gitPath: string, commandLine = ''): AppError {
  const text = raw.toLowerCase();
  const summary = firstLine(raw);
  if (text.includes('not a git repository')) {
    return makeError('NOT_A_REPOSITORY', 'git', summary, {
      stderr: raw,
      hint: 'Pick a folder that contains a .git directory, or initialize a new repository.',
    });
  }
  if (text.includes('command not found') || (text.includes('no such file') && text.includes('git'))) {
    return makeError('GIT_NOT_FOUND', 'git', `Git executable not found (${gitPath}).`, {
      stderr: raw,
      hint: 'Install Git or set the correct executable path in Settings.',
    });
  }
  if (AUTH_HINTS.some((hint) => text.includes(hint))) {
    return makeError('AUTH_REQUIRED', 'auth', summary, {
      stderr: raw,
      hint: 'Git could not authenticate with the remote. Configure an SSH key or a Git credential helper outside Git++, then retry. Git++ never asks for or stores your Git password.',
    });
  }
  if (NETWORK_HINTS.some((hint) => text.includes(hint))) {
    return makeError('NETWORK_ERROR', 'network', summary, {
      stderr: raw,
      hint: 'Check your network connection, VPN, and remote URL. The operation was not completed.',
    });
  }
  if (text.includes('would be overwritten') || text.includes('your local changes')) {
    return makeError('GIT_CONFLICT', 'conflict', summary, {
      stderr: raw,
      hint: 'Commit, stash, or discard the listed local changes before switching or pulling. Git++ will not overwrite them automatically.',
    });
  }
  if (text.includes('conflict') || text.includes('needs merge')) {
    return makeError('GIT_CONFLICT', 'conflict', summary, {
      stderr: raw,
      hint: 'Open the conflict workspace to review the base, current, and incoming versions.',
    });
  }
  if (text.includes('not fully merged') || text.includes('unmerged')) {
    return makeError('GIT_FAILED', 'git', summary, {
      stderr: raw,
      hint: 'The branch contains commits that are not merged. Force deletion requires explicit confirmation and cannot be undone from Git++.',
    });
  }
  if (text.includes('already checked out') || text.includes('already exists')) {
    return makeError('GIT_FAILED', 'git', summary, {
      stderr: raw,
      hint: 'The branch or path is already in use. Pick another name or location.',
    });
  }
  if (text.includes('nothing to commit')) {
    return makeError('GIT_FAILED', 'git', summary, { stderr: raw, hint: 'Stage at least one change before creating a commit.' });
  }
  return makeError('GIT_FAILED', 'git', summary || 'Git command failed', {
    stderr: raw,
    detail: commandLine ? `Command: ${commandLine}` : undefined,
  });
}
