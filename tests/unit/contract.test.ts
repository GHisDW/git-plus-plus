import { describe, expect, it } from 'vitest';
import { API_METHODS, schemas } from '../../src/shared/contract';

describe('IPC contract validation', () => {
  it('rejects empty repository paths and invalid targets', () => {
    expect(schemas['git.status'].safeParse({ repoPath: '' }).success).toBe(false);
    expect(schemas['git.diff'].safeParse({ repoPath: '/repo', target: 'everything' }).success).toBe(false);
    expect(schemas['git.switchBranch'].safeParse({ repoPath: '/repo', name: 'main' }).success).toBe(true);
  });

  it('requires confirmation literals for destructive calls', () => {
    expect(schemas['git.abortOperation'].safeParse({ repoPath: '/repo' }).success).toBe(false);
    expect(schemas['git.abortOperation'].safeParse({ repoPath: '/repo', confirmation: 'abort' }).success).toBe(true);
    expect(schemas['git.discard'].safeParse({ repoPath: '/repo', entries: [{ path: 'a.ts', staged: false, untracked: false }] }).success).toBe(false);
  });

  it('exposes no unrestricted command-execution method', () => {
    for (const method of API_METHODS) {
      expect(method).not.toMatch(/exec|shell|spawn|run-command/i);
    }
    expect(API_METHODS.length).toBeGreaterThan(60);
  });

  it('bounds payload sizes', () => {
    expect(schemas['git.commit'].safeParse({ repoPath: '/repo', message: 'x'.repeat(20_001) }).success).toBe(false);
    expect(schemas['files.saveText'].safeParse({ repoPath: '/repo', path: 'a.md', content: 'x'.repeat(5_000_001) }).success).toBe(false);
  });
});
