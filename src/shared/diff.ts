import { languageForPath } from './lang';
import type { DiffFile, DiffHunk, DiffLine, DiffResult } from './types';

const MAX_PATCH_CHARS = 2_000_000;
const MAX_FILE_PATCH_CHARS = 400_000;

interface OpenFile {
  oldPath: string;
  newPath: string;
  lines: string[];
  hunks: DiffHunk[];
  binary: boolean;
  additions: number;
  deletions: number;
  oldMode?: string;
  newMode?: string;
  status: DiffFile['status'];
  tooLarge: boolean;
}

function unquotePath(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      // Git C-quotes non-ASCII paths; decode the common octal escapes.
      return trimmed
        .slice(1, -1)
        .replace(/\\([0-7]{3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)))
        .replace(/\\t/g, '\t')
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function stripPrefix(path: string): string {
  const clean = unquotePath(path.split('\t')[0] ?? path);
  return clean.replace(/^[ab]\//, '');
}

function splitHeaderPaths(header: string): { oldPath: string; newPath: string } {
  const rest = header.slice('diff --git '.length);
  const quoted = /^"a\/(.+)" "b\/(.+)"$/.exec(rest);
  if (quoted) return { oldPath: quoted[1] ?? '', newPath: quoted[2] ?? '' };
  const plain = /^a\/(.*) b\/(.*)$/.exec(rest);
  if (plain) return { oldPath: plain[1] ?? '', newPath: plain[2] ?? '' };
  return { oldPath: rest, newPath: rest };
}

function parseHunkHeader(header: string): { oldStart: number; oldLines: number; newStart: number; newLines: number } | null {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header);
  if (!match) return null;
  return {
    oldStart: Number(match[1]),
    oldLines: match[2] === undefined ? 1 : Number(match[2]),
    newStart: Number(match[3]),
    newLines: match[4] === undefined ? 1 : Number(match[4]),
  };
}

function finishFile(file: OpenFile, patch: string): DiffFile {
  const oldPath = file.oldPath;
  const newPath = file.newPath;
  const displayPath = oldPath === newPath ? newPath : `${oldPath} → ${newPath}`;
  return {
    oldPath,
    newPath,
    displayPath,
    status: file.status,
    binary: file.binary,
    tooLarge: file.tooLarge,
    additions: file.additions,
    deletions: file.deletions,
    hunks: file.hunks,
    patch,
    oldMode: file.oldMode,
    newMode: file.newMode,
    language: languageForPath(newPath || oldPath),
  };
}

/** Parse a unified diff into structured files and hunks. */
export function parseDiff(raw: string): DiffResult {
  const truncated = raw.length > MAX_PATCH_CHARS;
  const text = truncated ? raw.slice(0, MAX_PATCH_CHARS) : raw;
  const lines = text.split('\n');
  const files: DiffFile[] = [];
  let current: OpenFile | null = null;
  let currentLines: string[] = [];
  let hunk: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;

  const flush = () => {
    if (!current) return;
    const patch = currentLines.join('\n');
    if (patch.length > MAX_FILE_PATCH_CHARS) {
      current.tooLarge = true;
      current.hunks = [];
    }
    files.push(finishFile(current, patch));
    current = null;
    currentLines = [];
    hunk = null;
    inHunk = false;
  };

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      flush();
      const { oldPath, newPath } = splitHeaderPaths(line);
      current = {
        oldPath,
        newPath,
        lines: [],
        hunks: [],
        binary: false,
        additions: 0,
        deletions: 0,
        status: 'modified',
        tooLarge: false,
      };
      currentLines = [line];
      inHunk = false;
      continue;
    }
    if (!current) continue;
    currentLines.push(line);

    if (inHunk) {
      if (line.startsWith('@@ ')) {
        const parsed = parseHunkHeader(line);
        if (!parsed) continue;
        hunk = { header: line, ...parsed, lines: [] };
        current.hunks.push(hunk);
        oldNo = parsed.oldStart;
        newNo = parsed.newStart;
        continue;
      }
      if (hunk && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ') || line === '')) {
        const kind = line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'context';
        const textLine = line.slice(1);
        const entry: DiffLine = {
          kind,
          text: textLine,
          oldNumber: kind === 'add' ? null : oldNo,
          newNumber: kind === 'del' ? null : newNo,
        };
        hunk.lines.push(entry);
        if (kind === 'add') {
          current.additions += 1;
          newNo += 1;
        } else if (kind === 'del') {
          current.deletions += 1;
          oldNo += 1;
        } else {
          oldNo += 1;
          newNo += 1;
        }
        continue;
      }
      if (line.startsWith('\\')) {
        if (hunk) hunk.lines.push({ kind: 'meta', text: line, oldNumber: null, newNumber: null });
        continue;
      }
      inHunk = false;
    }

    if (line.startsWith('new file mode ')) {
      current.status = 'added';
      continue;
    }
    if (line.startsWith('deleted file mode ')) {
      current.status = 'deleted';
      continue;
    }
    if (line.startsWith('rename from ')) {
      current.status = 'renamed';
      current.oldPath = unquotePath(line.slice('rename from '.length));
      continue;
    }
    if (line.startsWith('rename to ')) {
      current.status = 'renamed';
      current.newPath = unquotePath(line.slice('rename to '.length));
      continue;
    }
    if (line.startsWith('copy from ')) {
      current.status = 'copied';
      current.oldPath = unquotePath(line.slice('copy from '.length));
      continue;
    }
    if (line.startsWith('copy to ')) {
      current.status = 'copied';
      current.newPath = unquotePath(line.slice('copy to '.length));
      continue;
    }
    if (line.startsWith('old mode ')) {
      current.oldMode = line.slice('old mode '.length).trim();
      current.status = 'mode';
      continue;
    }
    if (line.startsWith('new mode ')) {
      current.newMode = line.slice('new mode '.length).trim();
      continue;
    }
    if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
      current.binary = true;
      current.status = 'binary';
      continue;
    }
    if (line.startsWith('--- ')) {
      const candidate = stripPrefix(line.slice(4));
      if (candidate !== '/dev/null') current.oldPath = candidate;
      else current.status = 'added';
      continue;
    }
    if (line.startsWith('+++ ')) {
      const candidate = stripPrefix(line.slice(4));
      if (candidate !== '/dev/null') current.newPath = candidate;
      else current.status = 'deleted';
      continue;
    }
    if (line.startsWith('@@ ')) {
      const parsed = parseHunkHeader(line);
      if (!parsed) continue;
      hunk = { header: line, ...parsed, lines: [] };
      current.hunks.push(hunk);
      oldNo = parsed.oldStart;
      newNo = parsed.newStart;
      inHunk = true;
    }
  }
  flush();

  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  return {
    files,
    text,
    truncated,
    stats: { files: files.length, additions, deletions },
    compared: '',
  };
}

/** Build a minimal patch for the given hunk indices, usable with `git apply --cached --recount`. */
export function buildHunkPatch(file: DiffFile, hunkIndices: number[]): string {
  const selected = hunkIndices
    .map((index) => file.hunks[index])
    .filter((hunk): hunk is DiffHunk => Boolean(hunk));
  if (selected.length === 0) return '';
  const header = file.patch.split('\n').find((line) => line.startsWith('diff --git '));
  const extraHeaders = file.patch
    .split('\n')
    .filter((line) => /^(index |--- |\+\+\+ |new file mode |deleted file mode |old mode |new mode |similarity index |rename from |rename to |copy from |copy to )/.test(line));
  const body = selected
    .map((hunk) => [hunk.header, ...hunk.lines.map((line) => {
      if (line.kind === 'add') return `+${line.text}`;
      if (line.kind === 'del') return `-${line.text}`;
      if (line.kind === 'meta') return line.text;
      return ` ${line.text}`;
    })].join('\n'))
    .join('\n');
  return `${header ?? `diff --git a/${file.oldPath} b/${file.newPath}`}\n${extraHeaders.join('\n')}\n${body}\n`;
}
