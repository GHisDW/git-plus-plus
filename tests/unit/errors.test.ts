import { describe, expect, it } from 'vitest';
import { redact, makeError } from '../../src/shared/errors';
import { translateGitFailure } from '../../src/main/git/errors';

describe('secret redaction', () => {
  it('removes credentials from URLs and tokens', () => {
    const raw = [
      `fatal: unable to access https://user:${'ghp_' + 'a'.repeat(24)}@github.com/org/repo.git`,
      `Authorization: Bearer ${'sk-' + 'b'.repeat(24)}`,
      `password=${'hunter2'.repeat(2)}`,
    ].join('\n');
    const clean = redact(raw);
    expect(clean).not.toContain('hunter2');
    expect(clean).not.toContain('a'.repeat(24));
    expect(clean).not.toContain('b'.repeat(24));
    expect(clean).toContain('***');
  });

  it('redacts error detail and stderr', () => {
    const error = makeError('GIT_FAILED', 'git', 'failed', { detail: 'token=abcdefghijklmnop', stderr: 'https://a:b@host/x' });
    expect(error.detail).not.toContain('abcdefghijklmnop');
    expect(error.stderr).not.toContain('a:b@');
  });
});

describe('Git failure translation', () => {
  it('maps authentication failures', () => {
    const error = translateGitFailure('fatal: Authentication failed for https://github.com/x/y.git', 'git');
    expect(error.code).toBe('AUTH_REQUIRED');
    expect(error.kind).toBe('auth');
    expect(error.hint).toBeTruthy();
  });

  it('maps network failures', () => {
    expect(translateGitFailure("fatal: unable to access 'https://x': Could not resolve host: github.com", 'git').code).toBe('NETWORK_ERROR');
  });

  it('maps local-change conflicts', () => {
    const error = translateGitFailure('error: Your local changes to the following files would be overwritten by checkout', 'git');
    expect(error.code).toBe('GIT_CONFLICT');
    expect(error.hint).toContain('stash');
  });

  it('maps missing repositories', () => {
    expect(translateGitFailure('fatal: not a git repository (or any of the parent directories): .git', 'git').code).toBe('NOT_A_REPOSITORY');
  });
});
