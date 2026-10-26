import type { AppError, ErrorCode, ErrorKind } from './types';

const SECRET_PATTERNS: Array<[RegExp, string | ((value: string) => string)]> = [
  [/https?:\/\/[^/@\s]+:[^/@\s]+@/gi, 'https://***@'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, 'ghp_***REDACTED***'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, 'github_pat_***REDACTED***'],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/g, 'sk-***REDACTED***'],
  [/\bAKIA[0-9A-Z]{16}\b/g, 'AKIA***REDACTED***'],
  [/Authorization:\s*[^\n]+/gi, 'Authorization: ***REDACTED***'],
  [/x-access-token:[^@\s]+/gi, 'x-access-token:***REDACTED***'],
  [/\b(?:token|password|secret|api[_-]?key)\s*[=:]\s*[^\s&'"]{8,}/gi, (value: string) =>
    value.replace(/[=:]\s*\S+$/, '= ***REDACTED***'),
  ],
];

/** Remove credential-like material from any text that could be logged or displayed. */
export function redact(input: string): string {
  let output = input;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    output = typeof replacement === 'function' ? output.replace(pattern, replacement) : output.replace(pattern, replacement);
  }
  return output;
}

export function makeError(code: ErrorCode, kind: ErrorKind, message: string, extra: Partial<AppError> = {}): AppError {
  return {
    code,
    kind,
    message,
    ...(extra.detail ? { detail: redact(extra.detail).slice(0, 8000) } : {}),
    ...(extra.stderr ? { stderr: redact(extra.stderr).slice(0, 8000) } : {}),
    ...(extra.hint ? { hint: extra.hint } : {}),
  };
}

export const ERR = {
  validation: (message: string, hint?: string) => makeError('INVALID_INPUT', 'validation', message, { hint }),
  unsafePath: (message: string) =>
    makeError('UNSAFE_PATH', 'validation', message, {
      hint: 'Paths must resolve to a location inside the opened repository.',
    }),
  notRepo: (path: string) =>
    makeError('NOT_A_REPOSITORY', 'git', `Not a Git repository: ${path}`, {
      hint: 'Choose a folder containing a .git directory, or initialize a new repository.',
    }),
  gitNotFound: () =>
    makeError('GIT_NOT_FOUND', 'git', 'Git executable not found.', {
      hint: 'Install Git from https://git-scm.com/downloads and make sure it is on PATH, or set the Git executable path in Settings.',
    }),
  io: (message: string, detail?: string) => makeError('IO_ERROR', 'filesystem', message, { detail }),
  notFound: (message: string) => makeError('NOT_FOUND', 'not-found', message),
  unsupported: (message: string) => makeError('UNSUPPORTED', 'unsupported', message),
  timeout: (ms: number, operation?: string) =>
    makeError('TIMEOUT', 'timeout', `${operation ?? 'Operation'} timed out after ${Math.round(ms / 1000)}s.`, {
      hint: 'The operation may still be running in Git. Refresh the repository to check its state.',
    }),
  cancelled: (operation?: string) => makeError('CANCELLED', 'cancelled', `${operation ?? 'Operation'} was cancelled.`),
  internal: (message: string, detail?: string) => makeError('INTERNAL', 'unknown', message, { detail }),
};

export function isErrno(error: unknown): NodeJS.ErrnoException | null {
  if (error && typeof error === 'object' && 'code' in error && typeof (error as NodeJS.ErrnoException).code === 'string') {
    return error as NodeJS.ErrnoException;
  }
  return null;
}
