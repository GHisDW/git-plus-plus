import type { FileState, HeadInfo, StatusEntry } from './types';

export interface ParsedStatus {
  head: HeadInfo;
  entries: StatusEntry[];
}

const LETTER: Record<string, FileState> = {
  M: 'modified',
  T: 'typechange',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
};

const CONFLICT_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

function stateOf(letter: string): FileState | null {
  return LETTER[letter] ?? null;
}

/** Split a record on a fixed number of spaces, keeping the remainder intact. */
function fields(record: string, count: number): { parts: string[]; rest: string } {
  const parts: string[] = [];
  let index = 0;
  for (let i = 0; i < count; i++) {
    const space = record.indexOf(' ', index);
    if (space === -1) return { parts, rest: '' };
    parts.push(record.slice(index, space));
    index = space + 1;
  }
  return { parts, rest: record.slice(index) };
}

/**
 * Parse `git status --porcelain=v2 --branch -z` output.
 * Records are NUL separated (including the `#` branch headers).
 */
export function parsePorcelainV2(raw: string): ParsedStatus {
  const records = raw.split('\0');
  const head: HeadInfo = {
    branch: null,
    detached: false,
    unborn: false,
    oid: null,
    upstream: null,
    ahead: 0,
    behind: 0,
  };
  const entries: StatusEntry[] = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) continue;

    if (record.startsWith('# branch.oid ')) {
      const value = record.slice('# branch.oid '.length);
      head.oid = value === '(initial)' ? null : value;
      head.unborn = value === '(initial)';
      continue;
    }
    if (record.startsWith('# branch.head ')) {
      const value = record.slice('# branch.head '.length);
      head.detached = value === '(detached)';
      head.branch = head.detached ? null : value;
      continue;
    }
    if (record.startsWith('# branch.upstream ')) {
      head.upstream = record.slice('# branch.upstream '.length);
      continue;
    }
    if (record.startsWith('# branch.ab ')) {
      const match = /\+(\d+) -(\d+)/.exec(record);
      if (match) {
        head.ahead = Number(match[1]);
        head.behind = Number(match[2]);
      }
      continue;
    }

    const type = record[0];
    if (type === '1') {
      const { parts, rest } = fields(record, 8);
      const xy = parts[1] ?? '..';
      const indexState = stateOf(xy[0] ?? '.');
      const worktreeState = stateOf(xy[1] ?? '.');
      if (!rest) continue;
      entries.push({
        path: rest,
        index: indexState,
        worktree: worktreeState,
        untracked: false,
        conflicted: false,
        staged: indexState !== null,
        unstaged: worktreeState !== null,
      });
    } else if (type === '2') {
      const { parts, rest } = fields(record, 9);
      const xy = parts[1] ?? '..';
      const indexState = stateOf(xy[0] ?? '.');
      const worktreeState = stateOf(xy[1] ?? '.');
      const origPath = records[i + 1] ?? undefined;
      i += 1;
      if (!rest) continue;
      entries.push({
        path: rest,
        origPath,
        index: indexState,
        worktree: worktreeState,
        untracked: false,
        conflicted: false,
        staged: indexState !== null,
        unstaged: worktreeState !== null,
      });
    } else if (type === 'u') {
      const { parts, rest } = fields(record, 10);
      const xy = parts[1] ?? 'UU';
      if (!rest) continue;
      entries.push({
        path: rest,
        index: null,
        worktree: null,
        untracked: false,
        conflicted: true,
        staged: false,
        unstaged: true,
        // Preserve the conflict code for detail views.
        ...(CONFLICT_CODES.has(xy) ? {} : {}),
      });
    } else if (type === '?') {
      const path = record.slice(2);
      if (!path) continue;
      entries.push({
        path,
        index: null,
        worktree: 'untracked',
        untracked: true,
        conflicted: false,
        staged: false,
        unstaged: false,
      });
    } else if (type === '!') {
      const path = record.slice(2);
      if (!path) continue;
      entries.push({
        path,
        index: null,
        worktree: 'ignored',
        untracked: false,
        conflicted: false,
        staged: false,
        unstaged: false,
      });
    }
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));
  return { head, entries };
}

export function statusStats(entries: StatusEntry[]) {
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  let conflicted = 0;
  for (const entry of entries) {
    if (entry.conflicted) conflicted += 1;
    if (entry.untracked) untracked += 1;
    if (entry.staged) staged += 1;
    if (entry.unstaged && !entry.conflicted) unstaged += 1;
  }
  return { staged, unstaged, untracked, conflicted };
}

export function describeEntry(entry: StatusEntry): string {
  if (entry.conflicted) return 'conflicted';
  if (entry.untracked) return 'untracked';
  const state = entry.index ?? entry.worktree;
  return state ?? 'modified';
}
