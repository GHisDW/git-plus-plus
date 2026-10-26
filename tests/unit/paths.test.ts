import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveInsideRepo, validateRelativePath } from '../../src/main/git/paths';

let root = '';
let outside = '';

beforeEach(async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'gitpp-paths-'));
  root = path.join(base, 'repo with spaces');
  outside = path.join(base, 'outside');
  await fs.mkdir(path.join(root, 'docs', 'nested'), { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(path.join(root, 'docs', 'nested', 'grüße.md'), '# hello\n');
  await fs.writeFile(path.join(outside, 'secret.txt'), 'secret');
  await fs.symlink(outside, path.join(root, 'escape-link'), 'dir').catch(() => undefined);
});

afterEach(async () => {
  await fs.rm(path.dirname(root), { recursive: true, force: true });
});

describe('repository path safety', () => {
  it('accepts spaces and unicode and rejects absolute or NUL paths', () => {
    expect(validateRelativePath('docs/nested/grüße.md')).toBe('docs/nested/grüße.md');
    expect(() => validateRelativePath('/etc/passwd')).toThrow(/Absolute/);
    expect(() => validateRelativePath('C:\\Windows\\win.ini')).toThrow(/Absolute/);
    expect(() => validateRelativePath('a\0b')).toThrow(/NUL/);
  });

  it('resolves real files inside the repository', async () => {
    const resolved = await resolveInsideRepo(root, 'docs/nested/grüße.md');
    expect(resolved).toContain('grüße.md');
    expect(await fs.readFile(resolved, 'utf8')).toContain('hello');
  });

  it('blocks traversal and symlink escapes', async () => {
    await expect(resolveInsideRepo(root, '../outside/secret.txt')).rejects.toThrow(/escapes/);
    await expect(resolveInsideRepo(root, 'escape-link/secret.txt')).rejects.toThrow(/outside the repository/);
  });

  it('supports creating new text files but keeps them inside the repo', async () => {
    const target = await resolveInsideRepo(root, 'docs/new file.md', { allowMissing: true });
    expect(target.startsWith(root)).toBe(true);
    await expect(resolveInsideRepo(root, '../new.md', { allowMissing: true })).rejects.toThrow(/escapes/);
  });
});
