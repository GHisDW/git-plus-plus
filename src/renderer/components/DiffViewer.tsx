import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ChevronLeft, ChevronRight, Columns2, FileWarning, RotateCw, Rows3, WrapText,
} from 'lucide-react';
import type { DiffFile, DiffHunk, DiffLine, DiffResult } from '../../shared/types';
import { buildHunkPatch } from '../../shared/diff';
import { cx } from '../lib/utils';
import { CopyButton, EmptyState, Spinner } from './ui';

const KEYWORDS = /\b(const|let|var|function|return|if|else|for|while|class|interface|type|enum|import|from|export|default|async|await|try|catch|finally|throw|new|this|super|extends|implements|public|private|protected|static|readonly|void|string|number|boolean|null|undefined|true|false|def|elif|end|do|then|fi|case|esac|use|pub|fn|struct|impl|match|go|func|package|SELECT|FROM|WHERE|JOIN|INSERT|UPDATE|DELETE)\b/;

function highlightLine(text: string, language: string): React.ReactNode {
  if (language === 'text' || text.length > 400) return text;
  const parts: React.ReactNode[] = [];
  const pattern = /(\/\/[^\n]*|#[^\n]*|\/\*.*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][\w-]*\b)/g;
  let index = 0;
  let key = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > index) parts.push(text.slice(index, start));
    const token = match[0];
    let className = '';
    if (/^(\/\/|#|\/\*)/.test(token) && language !== 'css') className = 'token-comment';
    else if (/^["'`]/.test(token)) className = 'token-string';
    else if (/^\d/.test(token)) className = 'token-number';
    else if (KEYWORDS.test(token)) className = 'token-keyword';
    parts.push(className ? <span className={className} key={key++}>{token}</span> : token);
    index = start + token.length;
  }
  if (index < text.length) parts.push(text.slice(index));
  return parts;
}

interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

function buildSplitRows(hunk: DiffHunk): SplitRow[] {
  const rows: SplitRow[] = [];
  let index = 0;
  while (index < hunk.lines.length) {
    const line = hunk.lines[index];
    if (!line) break;
    if (line.kind === 'context' || line.kind === 'meta') {
      rows.push({ left: line, right: line });
      index += 1;
      continue;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (index < hunk.lines.length && hunk.lines[index]?.kind === 'del') {
      dels.push(hunk.lines[index] as DiffLine);
      index += 1;
    }
    while (index < hunk.lines.length && hunk.lines[index]?.kind === 'add') {
      adds.push(hunk.lines[index] as DiffLine);
      index += 1;
    }
    const max = Math.max(dels.length, adds.length);
    for (let i = 0; i < max; i += 1) rows.push({ left: dels[i] ?? null, right: adds[i] ?? null });
  }
  return rows;
}

function statusLabel(file: DiffFile): string {
  if (file.binary) return 'binary';
  if (file.status === 'added') return 'added';
  if (file.status === 'deleted') return 'deleted';
  if (file.status === 'renamed') return 'renamed';
  return 'modified';
}

function SideBySide({ file, context }: { file: DiffFile; context: number }): React.JSX.Element {
  void context;
  return (
    <div className="diff-split">
      <div className="diff-split-side">
        {file.hunks.map((hunk, hunkIndex) => (
          <div key={`left-${hunkIndex}`}>
            <div className="diff-hunk-header">{hunk.header}</div>
            {buildSplitRows(hunk).map((row, rowIndex) => (
              <div className={cx('diff-line', row.left?.kind)} key={rowIndex}>
                <span className="num">{row.left?.oldNumber ?? ''}</span>
                <span className="sign">{row.left ? (row.left.kind === 'del' ? '-' : row.left.kind === 'add' ? '+' : ' ') : ''}</span>
                <span className="code">
                  {row.left ? highlightLine(row.left.text, file.language) : <span className="diff-placeholder" style={{ padding: 0 }} />}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="diff-split-side">
        {file.hunks.map((hunk, hunkIndex) => (
          <div key={`right-${hunkIndex}`}>
            <div className="diff-hunk-header">{hunk.header}</div>
            {buildSplitRows(hunk).map((row, rowIndex) => (
              <div className={cx('diff-line', row.right?.kind)} key={rowIndex}>
                <span className="num">{row.right?.newNumber ?? ''}</span>
                <span className="sign">{row.right ? (row.right.kind === 'add' ? '+' : row.right.kind === 'del' ? '-' : ' ') : ''}</span>
                <span className="code">
                  {row.right ? highlightLine(row.right.text, file.language) : <span className="diff-placeholder" style={{ padding: 0 }} />}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Unified({ file, wrap, direction }: { file: DiffFile; wrap: boolean; direction: 'stage' | 'unstage' | null }): React.JSX.Element {
  return (
    <div className={cx('diff-lines', wrap && 'diff-wrap')}>
      {file.hunks.map((hunk, hunkIndex) => (
        <div key={hunkIndex}>
          <div className="diff-hunk-header">
            <span>{hunk.header}</span>
            {file.patch && direction ? <HunkActions file={file} hunkIndex={hunkIndex} direction={direction} /> : null}
          </div>
          {hunk.lines.map((line, lineIndex) => (
            <div className={cx('diff-line', line.kind)} key={lineIndex}>
              {line.kind === 'meta' ? (
                <span className="code">{line.text}</span>
              ) : (
                <>
                  <span className="num">{line.oldNumber ?? ''}</span>
                  <span className="num">{line.newNumber ?? ''}</span>
                  <span className="sign">{line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}</span>
                  <span className="code">{highlightLine(line.text, file.language)}</span>
                </>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function HunkActions({ file, hunkIndex, direction }: { file: DiffFile; hunkIndex: number; direction: 'stage' | 'unstage' }): React.JSX.Element {
  const patch = useMemo(() => buildHunkPatch(file, [hunkIndex]), [file, hunkIndex]);
  return (
    <span className="hunk-actions">
      <CopyButton value={patch} label="Copy hunk patch" />
      <button
        className="btn sm"
        title={direction === 'stage' ? 'Stage only this hunk' : 'Unstage only this hunk'}
        data-hunk-stage={`${file.newPath}:${hunkIndex}`}
        onClick={() => {
          window.dispatchEvent(new CustomEvent('gitpp:stage-hunk', { detail: { file, hunkIndex, direction } }));
        }}
      >
        {direction === 'stage' ? 'Stage hunk' : 'Unstage hunk'}
      </button>
    </span>
  );
}

export function DiffViewer({
  diff,
  loading,
  error,
  mode,
  wrap,
  ignoreWhitespace,
  onModeChange,
  onWrapChange,
  onIgnoreWhitespaceChange,
  onRefresh,
  emptyTitle = 'No changes to display',
  emptyDescription = 'Select a changed file, or choose a comparison above.',
  enableSplit = true,
  actions,
  onStageHunk,
  hunkDirection = null,
  initialFile,
}: {
  diff: DiffResult | null;
  loading?: boolean;
  error?: string | null;
  mode: 'unified' | 'split';
  wrap: boolean;
  ignoreWhitespace: boolean;
  onModeChange: (mode: 'unified' | 'split') => void;
  onWrapChange: (wrap: boolean) => void;
  onIgnoreWhitespaceChange: (ignore: boolean) => void;
  onRefresh?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  enableSplit?: boolean;
  actions?: React.ReactNode;
  onStageHunk?: (file: DiffFile, hunkIndex: number, direction: 'stage' | 'unstage') => Promise<void>;
  hunkDirection?: 'stage' | 'unstage' | null;
  initialFile?: string | null;
}): React.JSX.Element {
  const [fileIndex, setFileIndex] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [hunkCursor, setHunkCursor] = useState(0);

  useEffect(() => {
    setFileIndex(0);
    setHunkCursor(0);
  }, [diff]);

  useEffect(() => {
    if (initialFile && diff) {
      const index = diff.files.findIndex((file) => file.newPath === initialFile || file.oldPath === initialFile);
      if (index >= 0) setFileIndex(index);
    }
  }, [initialFile, diff]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ file: DiffFile; hunkIndex: number; direction: 'stage' | 'unstage' }>).detail;
      if (!detail || !onStageHunk) return;
      void onStageHunk(detail.file, detail.hunkIndex, detail.direction);
    };
    window.addEventListener('gitpp:stage-hunk', handler);
    return () => window.removeEventListener('gitpp:stage-hunk', handler);
  }, [onStageHunk]);

  const files = diff?.files ?? [];
  const file = files[Math.min(fileIndex, Math.max(0, files.length - 1))] ?? null;

  const jumpToHunk = (direction: 1 | -1) => {
    if (!file) return;
    const next = Math.max(0, Math.min(file.hunks.length - 1, hunkCursor + direction));
    setHunkCursor(next);
    const blocks = bodyRef.current?.querySelectorAll('.diff-hunk-header');
    blocks?.[next]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <div className="diff-toolbar">
        {files.length > 1 ? (
          <div className="diff-file-nav">
            <button className="btn ghost icon" disabled={fileIndex === 0} onClick={() => setFileIndex((index) => Math.max(0, index - 1))} aria-label="Previous file"><ChevronLeft size={14} /></button>
            <button className="btn ghost icon" disabled={fileIndex >= files.length - 1} onClick={() => setFileIndex((index) => Math.min(files.length - 1, index + 1))} aria-label="Next file"><ChevronRight size={14} /></button>
          </div>
        ) : null}
        <span className="diff-file-name" title={file?.displayPath}>{file?.displayPath ?? diff?.compared ?? 'Diff'}</span>
        {file ? <span className={cx('tag', file.status === 'added' ? 'green' : file.status === 'deleted' ? 'red' : 'accent')}>{statusLabel(file)}</span> : null}
        {file ? <span className="stat-add">+{file.additions}</span> : null}
        {file ? <span className="stat-del">−{file.deletions}</span> : null}
        <div className="spacer" />
        {file && file.hunks.length > 1 ? (
          <div className="diff-file-nav">
            <button className="btn ghost sm" onClick={() => jumpToHunk(-1)} title="Previous hunk">↑ hunk</button>
            <button className="btn ghost sm" onClick={() => jumpToHunk(1)} title="Next hunk">↓ hunk</button>
          </div>
        ) : null}
        {diff && diff.files.length > 0 ? <CopyButton value={file?.newPath ?? ''} label="Copy file path" /> : null}
        <button className={cx('btn ghost icon')} onClick={() => onIgnoreWhitespaceChange(!ignoreWhitespace)} title="Ignore whitespace changes" style={ignoreWhitespace ? { color: 'var(--accent)', background: 'var(--accent-soft)' } : undefined}>
          <AlertTriangle size={13} />
        </button>
        <button className="btn ghost icon" onClick={() => onWrapChange(!wrap)} title="Toggle line wrapping" style={wrap ? { color: 'var(--accent)' } : undefined}><WrapText size={13} /></button>
        {enableSplit ? (
          <div className="segmented">
            <button className={cx(mode === 'unified' && 'active')} onClick={() => onModeChange('unified')} title="Unified diff"><Rows3 size={12} /></button>
            <button className={cx(mode === 'split' && 'active')} onClick={() => onModeChange('split')} title="Side-by-side diff"><Columns2 size={12} /></button>
          </div>
        ) : null}
        {onRefresh ? <button className="btn ghost icon" onClick={onRefresh} title="Reload diff"><RotateCw size={13} /></button> : null}
        {actions}
      </div>
      <div className="diff-body" ref={bodyRef}>
        {loading ? <div className="loading-state"><Spinner /> Loading diff…</div> : null}
        {!loading && error ? (
          <div style={{ padding: 20 }}><div className="banner danger"><FileWarning size={15} /><div>{error}</div></div></div>
        ) : null}
        {!loading && !error && (!diff || files.length === 0) ? (
          <EmptyState icon={FileWarning} title={emptyTitle} description={emptyDescription} />
        ) : null}
        {!loading && !error && file ? (
          <div className="diff-file-block">
            {!diff?.truncated ? null : (
              <div className="banner warn" style={{ margin: 12 }}><AlertTriangle size={14} />This diff is very large and was truncated to protect the interface.</div>
            )}
            {file.binary ? (
              <div className="binary-notice"><FileWarning size={16} /> Binary file — Git++ does not render binary contents. Use an external tool to inspect it.</div>
            ) : null}
            {!file.binary && file.tooLarge ? (
              <div className="banner warn" style={{ margin: 12 }}><AlertTriangle size={14} /> This file&apos;s patch is too large to render. Use Git in a terminal or open the file directly.</div>
            ) : null}
            {!file.binary && !file.tooLarge ? (
              mode === 'split' ? <SideBySide file={file} context={diff?.stats.files ?? 0} /> : <Unified file={file} wrap={wrap} direction={hunkDirection} />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
