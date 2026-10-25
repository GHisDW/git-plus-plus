import { describe, expect, it } from 'vitest';
import { buildHunkPatch, parseDiff } from '../../src/shared/diff';

const PATCH = [
  'diff --git a/src/app.ts b/src/app.ts',
  'index 1111111..2222222 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,3 +1,4 @@',
  ' const a = 1;',
  '-const b = 2;',
  '+const b = 3;',
  '+const c = 4;',
  ' export { a };',
].join('\n');

describe('parseDiff', () => {
  it('parses files, hunks and line numbers', () => {
    const diff = parseDiff(PATCH);
    expect(diff.files).toHaveLength(1);
    const file = diff.files[0];
    expect(file?.newPath).toBe('src/app.ts');
    expect(file?.additions).toBe(2);
    expect(file?.deletions).toBe(1);
    expect(file?.hunks[0]?.lines.map((line) => [line.kind, line.oldNumber, line.newNumber])).toEqual([
      ['context', 1, 1],
      ['del', 2, null],
      ['add', null, 2],
      ['add', null, 3],
      ['context', 3, 4],
    ]);
    expect(file?.language).toBe('typescript');
  });

  it('detects renames, binary files and new files', () => {
    const diff = parseDiff([
      'diff --git a/old.txt b/new.txt',
      'similarity index 100%',
      'rename from old.txt',
      'rename to new.txt',
      'diff --git a/image.png b/image.png',
      'new file mode 100644',
      'Binary files /dev/null and b/image.png differ',
    ].join('\n'));
    expect(diff.files[0]).toMatchObject({ status: 'renamed', oldPath: 'old.txt', newPath: 'new.txt' });
    expect(diff.files[1]).toMatchObject({ status: 'binary', binary: true, newPath: 'image.png' });
  });

  it('builds a single-hunk patch usable for partial staging', () => {
    const file = parseDiff(PATCH).files[0];
    expect(file).toBeDefined();
    if (!file) return;
    const patch = buildHunkPatch(file, [0]);
    expect(patch).toContain('@@ -1,3 +1,4 @@');
    expect(patch).toContain('+const c = 4;');
    expect(patch.startsWith('diff --git a/src/app.ts b/src/app.ts')).toBe(true);
  });

  it('handles an empty diff', () => {
    const diff = parseDiff('');
    expect(diff.files).toEqual([]);
    expect(diff.stats).toEqual({ files: 0, additions: 0, deletions: 0 });
  });
});
