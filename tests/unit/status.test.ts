import { describe, expect, it } from 'vitest';
import { parsePorcelainV2, statusStats } from '../../src/shared/status';

const OID = 'a'.repeat(40);
const record = (...parts: string[]) => parts.join('\0') + '\0';

describe('parsePorcelainV2', () => {
  it('parses branch headers, modified, renamed, conflicted and untracked entries', () => {
    const raw = record(
      `# branch.oid ${OID}`,
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      `1 .M N... 100644 100644 100644 ${'b'.repeat(40)} ${'b'.repeat(40)} src/my file.ts`,
      `2 R. N... 100644 100644 100644 ${'c'.repeat(40)} ${'d'.repeat(40)} R100 src/new name.ts`,
      'src/old name.ts',
      `u UU N... 100644 100644 100644 100644 ${'e'.repeat(40)} ${'f'.repeat(40)} ${'0'.repeat(40)} docs/conflict.md`,
      '? untracked.txt',
    );
    const parsed = parsePorcelainV2(raw);
    expect(parsed.head).toMatchObject({ branch: 'main', detached: false, oid: OID, upstream: 'origin/main', ahead: 2, behind: 1 });
    expect(parsed.entries).toHaveLength(4);
    const modified = parsed.entries.find((entry) => entry.path === 'src/my file.ts');
    expect(modified).toMatchObject({ worktree: 'modified', staged: false, unstaged: true });
    const renamed = parsed.entries.find((entry) => entry.path === 'src/new name.ts');
    expect(renamed).toMatchObject({ origPath: 'src/old name.ts', index: 'renamed', staged: true });
    const conflict = parsed.entries.find((entry) => entry.path === 'docs/conflict.md');
    expect(conflict?.conflicted).toBe(true);
    const untracked = parsed.entries.find((entry) => entry.path === 'untracked.txt');
    expect(untracked).toMatchObject({ untracked: true, worktree: 'untracked', unstaged: false });
    expect(statusStats(parsed.entries)).toEqual({ staged: 1, unstaged: 1, untracked: 1, conflicted: 1 });
  });

  it('handles unborn branches and detached HEAD', () => {
    const unborn = parsePorcelainV2(record('# branch.oid (initial)', '# branch.head main', '? README.md'));
    expect(unborn.head).toMatchObject({ unborn: true, oid: null, branch: 'main', detached: false });
    const detached = parsePorcelainV2(record(`# branch.oid ${OID}`, '# branch.head (detached)'));
    expect(detached.head).toMatchObject({ detached: true, branch: null, oid: OID });
  });

  it('does not treat ignored entries as changes', () => {
    const parsed = parsePorcelainV2(record('! node_modules/', '! dist/app.js'));
    expect(parsed.entries.map((entry) => entry.path)).toEqual(['dist/app.js', 'node_modules/']);
    expect(statusStats(parsed.entries)).toEqual({ staged: 0, unstaged: 0, untracked: 0, conflicted: 0 });
  });
});
