import type {
  BranchInfo,
  CommitSummary,
  ConfigEntry,
  FileHistoryEntry,
  RemoteInfo,
  StashEntry,
  TagInfo,
  WorktreeInfo,
} from '../../shared/types';

const RS = '\x1e';
const FS = '\x1f';

export const LOG_FORMAT = `%H${FS}%h${FS}%P${FS}%an${FS}%ae${FS}%aI${FS}%D${FS}%s${FS}%b${RS}`;

export function parseLog(raw: string): CommitSummary[] {
  const commits: CommitSummary[] = [];
  for (const record of raw.split(RS)) {
    const trimmed = record.replace(/^\r?\n/, '');
    if (!trimmed.trim()) continue;
    const parts = trimmed.split(FS);
    if (parts.length < 8) continue;
    const [sha, shortSha, parents, author, authorEmail, date, refs, subject, body] = parts;
    if (!sha || !/^[0-9a-f]{7,64}$/i.test(sha)) continue;
    commits.push({
      sha,
      shortSha: shortSha ?? sha.slice(0, 7),
      parents: (parents ?? '').split(' ').filter(Boolean),
      author: author ?? 'Unknown',
      authorEmail: authorEmail ?? '',
      date: date ?? new Date(0).toISOString(),
      refs: (refs ?? '')
        .split(', ')
        .map((ref) => ref.trim())
        .filter(Boolean),
      subject: subject ?? '',
      body: (body ?? '').trim(),
    });
  }
  return commits;
}

export function parseBranches(raw: string, worktreeBranches: Map<string, string> = new Map()): BranchInfo[] {
  const branches: BranchInfo[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split(FS);
    if (parts.length < 8) continue;
    const [fullName, name, sha, shortSha, upstream, headMark, updatedAt, subject, track = '', symref = ''] = parts;
    if (!fullName || !name) continue;
    if (symref) continue;
    const isRemote = fullName.startsWith('refs/remotes/');
    if (isRemote && /\/HEAD$/.test(fullName)) continue;
    const aheadMatch = /ahead (\d+)/.exec(track);
    const behindMatch = /behind (\d+)/.exec(track);
    const remote = isRemote ? name.split('/')[0] ?? null : upstream ? upstream.split('/')[0] ?? null : null;
    branches.push({
      name,
      fullName,
      isRemote,
      remote,
      sha: sha ?? '',
      shortSha: shortSha ?? (sha ?? '').slice(0, 7),
      upstream: upstream || null,
      ahead: aheadMatch ? Number(aheadMatch[1]) : 0,
      behind: behindMatch ? Number(behindMatch[1]) : 0,
      isHead: headMark === '*' && !isRemote,
      updatedAt: updatedAt ?? '',
      subject: subject ?? '',
      checkedOutAt: worktreeBranches.get(name) ?? null,
    });
  }
  branches.sort((a, b) => {
    if (a.isHead !== b.isHead) return a.isHead ? -1 : 1;
    if (a.isRemote !== b.isRemote) return a.isRemote ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
  return branches;
}

export function parseWorktrees(raw: string): WorktreeInfo[] {
  const worktrees: WorktreeInfo[] = [];
  for (const block of raw.split(/\r?\n\r?\n/)) {
    if (!block.trim()) continue;
    const info: WorktreeInfo = {
      path: '',
      head: null,
      shortHead: null,
      branch: null,
      bare: false,
      detached: false,
      locked: false,
      lockReason: null,
      prunable: false,
      isMain: worktrees.length === 0,
      dirty: false,
    };
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) info.path = line.slice('worktree '.length);
      else if (line.startsWith('HEAD ')) {
        info.head = line.slice(5);
        info.shortHead = info.head.slice(0, 7);
      } else if (line.startsWith('branch ')) info.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
      else if (line === 'bare') info.bare = true;
      else if (line === 'detached') info.detached = true;
      else if (line.startsWith('locked')) info.locked = true;
      else if (line.startsWith('prunable')) info.prunable = true;
    }
    if (info.path) worktrees.push(info);
  }
  return worktrees;
}

export function parseStashes(raw: string): StashEntry[] {
  const stashes: StashEntry[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split(FS);
    if (parts.length < 4) continue;
    const [ref, sha, shortSha, message, date = ''] = parts;
    const indexMatch = /stash@\{(\d+)\}/.exec(ref ?? '');
    const branchMatch = /^(?:WIP on|On) ([^:]+):/.exec(message ?? '');
    stashes.push({
      index: indexMatch ? Number(indexMatch[1]) : stashes.length,
      ref: ref ?? '',
      sha: sha ?? '',
      shortSha: shortSha ?? '',
      message: (message ?? '').replace(/^(WIP on|On) [^:]+:\s*/, ''),
      date: date ?? '',
      branch: branchMatch ? branchMatch[1] ?? null : null,
    });
  }
  return stashes;
}

export function parseRemotes(raw: string): RemoteInfo[] {
  const map = new Map<string, RemoteInfo>();
  for (const line of raw.split('\n')) {
    const match = /^(\S+)\t(.+) \((fetch|push)\)$/.exec(line.trim());
    if (!match) continue;
    const [, name, url, kind] = match;
    if (!name || !url) continue;
    const existing = map.get(name) ?? { name, fetchUrl: '', pushUrl: '', branches: 0 };
    if (kind === 'fetch') existing.fetchUrl = url;
    else existing.pushUrl = url;
    map.set(name, existing);
  }
  return [...map.values()].map((remote) => ({ ...remote, pushUrl: remote.pushUrl || remote.fetchUrl }));
}

export function parseConfig(raw: string, scope: ConfigEntry['scope']): ConfigEntry[] {
  const entries: ConfigEntry[] = [];
  const blocks = raw.split('\0');
  for (const block of blocks) {
    if (!block.trim()) continue;
    const newline = block.indexOf('\n');
    if (newline !== -1) {
      entries.push({ key: block.slice(0, newline), value: block.slice(newline + 1), scope });
      continue;
    }
    const equals = block.indexOf('=');
    if (equals !== -1) entries.push({ key: block.slice(0, equals), value: block.slice(equals + 1), scope });
  }
  return entries.sort((a, b) => a.key.localeCompare(b.key));
}

export function parseTags(raw: string): TagInfo[] {
  const tags: TagInfo[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split(FS);
    if (parts.length < 4) continue;
    const [name, sha, objectType, subject, date = '', author = ''] = parts;
    if (!name) continue;
    tags.push({
      name,
      sha: sha ?? '',
      annotated: objectType === 'tag',
      message: subject ?? '',
      date: date || null,
      author: author || null,
    });
  }
  return tags;
}

export function parseFileHistory(raw: string): FileHistoryEntry[] {
  const entries: FileHistoryEntry[] = [];
  for (const block of raw.split(RS)) {
    const trimmed = block.replace(/^\r?\n/, '').trim();
    if (!trimmed) continue;
    const lines = trimmed.split(/\r?\n/);
    const fields = (lines[0] ?? '').split(FS);
    if (fields.length < 5) continue;
    const [sha, shortSha, author, date, subject] = fields;
    const changeLine = lines.find((line) => /^[AMDRCT]\d*\t/.test(line));
    if (!sha) continue;
    entries.push({
      sha,
      shortSha: shortSha ?? sha.slice(0, 7),
      author: author ?? '',
      date: date ?? '',
      subject: subject ?? '',
      path: changeLine ? (changeLine.split('\t')[1] ?? '') : '',
      changeType: changeLine ? (changeLine[0] ?? 'M') : 'M',
    });
  }
  return entries;
}
