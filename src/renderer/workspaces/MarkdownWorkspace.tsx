import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import {
  AlertTriangle, Check, ChevronDown, Eye, FileCode2, FilePlus2, FolderOpen, Pencil, RefreshCw, Save,
  Search, SplitSquareHorizontal, SquarePen, WrapText,
} from 'lucide-react';
import type { RepoFile, TextFile } from '../../shared/types';
import { call, errorDetail, errorMessage } from '../lib/api';
import { useApp } from '../state/AppState';
import { cx } from '../lib/utils';
import { formatBytes, formatDateTime } from '../../shared/format';
import { EmptyState, Field, Modal, Spinner } from '../components/ui';

type Mode = 'source' | 'preview' | 'split';

function slugify(value: string, index: number): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
  return `heading-${index}-${slug || 'section'}`;
}

export function MarkdownWorkspace(): React.JSX.Element {
  const { snapshot, settings, runOperation, toast, refresh } = useApp();
  const repoPath = snapshot?.info.path ?? '';
  const [files, setFiles] = useState<RepoFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [path, setPath] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState('');
  const [version, setVersion] = useState<string | null>(null);
  const [modifiedAt, setModifiedAt] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('split');
  const [saving, setSaving] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [externalChanged, setExternalChanged] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [newPath, setNewPath] = useState('docs/notes.md');
  const [search, setSearch] = useState('');
  const [showOutline, setShowOutline] = useState(true);
  const [forceOpen, setForceOpen] = useState(false);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const dirty = content !== original;

  const loadFiles = useCallback(async () => {
    if (!repoPath) return;
    setFilesLoading(true);
    try {
      setFiles(await call('files.listMarkdown', { repoPath }));
    } catch (error) {
      toast('error', 'Could not list Markdown files', errorDetail(error) ?? errorMessage(error));
    } finally {
      setFilesLoading(false);
    }
  }, [repoPath, toast]);

  useEffect(() => { void loadFiles(); }, [loadFiles, snapshot?.refreshedAt]);

  const openFile = useCallback(async (target: string, force = false) => {
    if (!force && dirty && !window.confirm('Discard unsaved changes in the current document?')) return;
    setLoadingFile(true);
    try {
      const file = await call('files.readText', { repoPath, path: target });
      setPath(file.path);
      setContent(file.content);
      setOriginal(file.content);
      setVersion(file.version);
      setModifiedAt(file.modifiedAt);
      setExternalChanged(false);
      setSearch('');
    } catch (error) {
      toast('error', 'Could not open the file', errorDetail(error) ?? errorMessage(error));
    } finally {
      setLoadingFile(false);
    }
  }, [repoPath, dirty, toast]);

  useEffect(() => {
    if (path || files.length === 0 || !repoPath) return;
    const preferred = files.find((file) => /^readme\.md$/i.test(file.path)) ?? files[0];
    if (preferred) void openFile(preferred.path, true);
  }, [files, path, repoPath, openFile]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (detail === 'new-markdown') { setNewOpen(true); return; }
      const payload = (event as CustomEvent<{ action?: string; path?: string }>).detail;
      if (payload && typeof payload === 'object' && payload.action === 'open-markdown' && payload.path) void openFile(payload.path);
    };
    window.addEventListener('gitpp:action', handler);
    return () => window.removeEventListener('gitpp:action', handler);
  }, [openFile]);

  const save = async (force = false) => {
    if (!path) return;
    setSaving(true);
    const result = await runOperation('Saving document…', () => call('files.saveText', {
      repoPath,
      path,
      content,
      ...(force || !version ? {} : { expectedVersion: version }),
    }), { refresh: false });
    setSaving(false);
    if (result) {
      setOriginal(content);
      setVersion(result.version);
      setExternalChanged(false);
      setForceOpen(false);
      toast('success', 'Document saved', `${result.path} · ${formatBytes(result.size)}`);
      await refresh();
      await loadFiles();
    } else if (force) {
      setForceOpen(false);
    }
  };

  const create = async () => {
    if (!newPath.trim()) return;
    const target = newPath.trim().endsWith('.md') ? newPath.trim() : `${newPath.trim()}.md`;
    const result = await runOperation('Creating document…', () => call('files.saveText', {
      repoPath,
      path: target,
      content: `# ${target.split('/').pop()?.replace(/\.md$/i, '') ?? 'Document'}\n\n`,
    }), { refresh: false, success: `${target} created` });
    if (result) {
      setNewOpen(false);
      await loadFiles();
      await openFile(target, true);
      await refresh();
    }
  };

  const checkDisk = async () => {
    if (!path) return;
    try {
      const file: TextFile = await call('files.readText', { repoPath, path });
      if (version && file.version !== version) {
        setExternalChanged(true);
        toast('warning', 'File changed on disk', 'Reload it to see the external changes, or review carefully before forcing a save.');
      } else {
        toast('info', 'File is unchanged on disk');
        setExternalChanged(false);
      }
    } catch (error) {
      toast('error', 'Could not check the file', errorMessage(error));
    }
  };

  useEffect(() => {
    const onFocus = () => { if (path) void checkDisk(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, version]);

  const html = useMemo(() => {
    const raw = marked.parse(content, { async: false }) as string;
    return DOMPurify.sanitize(raw, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'link', 'meta', 'base'],
      FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick'],
      ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i,
    });
  }, [content]);

  useEffect(() => {
    const container = previewRef.current;
    if (!container) return;
    const headings = container.querySelectorAll('h1, h2, h3, h4');
    headings.forEach((heading, index) => { heading.id = slugify(heading.textContent ?? '', index); });
  }, [html, mode]);

  const outline = useMemo(() => content.split('\n').map((line, index) => {
    const match = /^(#{1,4})\s+(.*)$/.exec(line);
    return match && match[2] ? { level: (match[1] ?? '').length, text: match[2], line: index } : null;
  }).filter((entry): entry is { level: number; text: string; line: number } => Boolean(entry)), [content]);

  const matches = useMemo(() => {
    if (!search.trim()) return [];
    const needle = search.toLowerCase();
    const found: number[] = [];
    content.split('\n').forEach((line, index) => { if (line.toLowerCase().includes(needle)) found.push(index); });
    return found;
  }, [search, content]);

  const jumpToLine = (line: number) => {
    const textarea = sourceRef.current;
    if (!textarea) return;
    const position = content.split('\n').slice(0, line).join('\n').length;
    textarea.focus();
    textarea.setSelectionRange(position, position + (content.split('\n')[line] ?? '').length);
    const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight) || 20;
    textarea.scrollTop = Math.max(0, line * lineHeight - textarea.clientHeight / 2);
  };

  const scrollSync = () => {
    if (mode !== 'split' || !sourceRef.current || !previewRef.current) return;
    const source = sourceRef.current;
    const ratio = source.scrollTop / Math.max(1, source.scrollHeight - source.clientHeight);
    previewRef.current.scrollTop = ratio * Math.max(0, previewRef.current.scrollHeight - previewRef.current.clientHeight);
  };

  if (!snapshot) {
    return <div className="workspace"><EmptyState icon={FileCode2} title="No repository open" description="Open a repository to edit its real Markdown documents with a safe preview." /></div>;
  }

  return (
    <div className="workspace">
      <div className="workspace-header">
        <div className="workspace-heading">
          <h1>Markdown Studio {dirty ? <span className="tag amber">unsaved</span> : null}</h1>
          <p>{path ? <span><span className="mono">{path}</span> · {content.split(/\s+/).filter(Boolean).length} words · saved {modifiedAt ? formatDateTime(modifiedAt) : '—'}</span> : 'Edit repository documents without leaving Git++.'}</p>
        </div>
        <div className="workspace-actions">
          <button className="btn" onClick={() => setNewOpen(true)}><FilePlus2 size={13} /> New</button>
          <button className="btn" onClick={() => void checkDisk()} disabled={!path}><RefreshCw size={13} /> Check disk</button>
          <button className="btn primary" onClick={() => void save()} disabled={!path || !dirty || saving}>{saving ? <Spinner /> : <Save size={13} />} Save</button>
        </div>
      </div>
      <div className="workspace-body flush">
        <div className="markdown-layout">
          <div className="md-files">
            <div className="panel-header" style={{ position: 'sticky', top: 0, zIndex: 1 }}><h2>Documents</h2><span className="tag">{files.length}</span></div>
            {filesLoading ? <div className="loading-state"><Spinner /> Scanning…</div> : null}
            {!filesLoading && files.length === 0 ? <div className="small muted" style={{ padding: 12 }}>No Markdown files tracked or untracked in this repository.</div> : null}
            {files.map((file) => (
              <button key={file.path} className={cx('file-row', path === file.path && 'selected')} style={{ borderRadius: 0, padding: '7px 10px' }} onClick={() => void openFile(file.path)} title={file.path}>
                <FileCode2 size={12} style={{ color: 'var(--text-muted)', flex: '0 0 auto' }} />
                <span className="file-name">{file.path}</span>
                <span className="small dim">{formatBytes(file.size)}</span>
              </button>
            ))}
          </div>
          <div className="md-editor-area">
            {path ? (
              <>
                <div className="md-toolbar">
                  <span className="mono small truncate" style={{ maxWidth: 260 }}>{path}</span>
                  {dirty ? <span className="tag amber">modified</span> : <span className="tag green"><Check size={9} />saved</span>}
                  <div className="spacer" />
                  <div className="segmented">
                    <button className={cx(mode === 'source' && 'active')} onClick={() => setMode('source')} title="Source"><SquarePen size={12} /></button>
                    <button className={cx(mode === 'split' && 'active')} onClick={() => setMode('split')} title="Split"><SplitSquareHorizontal size={12} /></button>
                    <button className={cx(mode === 'preview' && 'active')} onClick={() => setMode('preview')} title="Preview"><Eye size={12} /></button>
                  </div>
                  <div className="row" style={{ gap: 4 }}>
                    <Search size={12} style={{ color: 'var(--text-muted)' }} />
                    <input className="input" style={{ width: 150, padding: '3px 7px', fontSize: 11 }} placeholder="Find in source" value={search} onChange={(event) => setSearch(event.target.value)} />
                    {search ? <span className="small dim">{matches.length} line{matches.length === 1 ? '' : 's'}</span> : null}
                    {matches.length > 0 ? <button className="btn sm" onClick={() => jumpToLine(matches[0] ?? 0)}>Jump</button> : null}
                  </div>
                  <button className="btn ghost sm" onClick={() => setShowOutline((value) => !value)}><ChevronDown size={11} /> Outline</button>
                </div>
                {externalChanged ? (
                  <div className="banner warn" style={{ margin: 8 }}>
                    <AlertTriangle size={14} />
                    <span>The file changed on disk since you opened it. {dirty ? 'Your unsaved edits would overwrite those changes.' : 'Reload to see the external changes.'}</span>
                    <div className="banner-actions">
                      <button className="btn sm" onClick={() => void openFile(path, true)}>Reload</button>
                      {dirty ? <button className="btn sm danger" onClick={() => setForceOpen(true)}>Overwrite…</button> : null}
                    </div>
                  </div>
                ) : null}
                {showOutline && outline.length > 0 ? (
                  <div className="md-outline">
                    <div className="md-outline-list">
                      {outline.map((heading, index) => (
                        <button key={`${heading.line}-${index}`} className="md-outline-item" style={{ paddingLeft: 8 + (heading.level - 1) * 12 }} onClick={() => {
                          if (mode === 'preview') previewRef.current?.querySelectorAll('h1,h2,h3,h4')[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                          else jumpToLine(heading.line);
                        }}>{heading.text}</button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className={cx('md-main', mode === 'split' && 'split')}>
                  {mode !== 'preview' ? (
                    <div className="md-source">
                      <textarea ref={sourceRef} value={content} onChange={(event) => setContent(event.target.value)} onScroll={scrollSync} spellCheck style={{ fontSize: settings.editor.fontSize }} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); } }} aria-label="Markdown source" />
                    </div>
                  ) : null}
                  {mode !== 'source' ? (
                    <div className="md-preview" ref={previewRef} onClick={(event) => {
                      const anchor = (event.target as HTMLElement).closest('a');
                      if (anchor) {
                        event.preventDefault();
                        const href = anchor.getAttribute('href') ?? '';
                        if (/^https?:/i.test(href)) void call('app.openExternal', { url: href }).catch((error) => toast('error', 'Could not open link', errorMessage(error)));
                        else toast('info', 'Relative link', 'Git++ will not navigate to repository files from a Markdown preview. Open the file in Markdown Studio instead.');
                      }
                    }} dangerouslySetInnerHTML={{ __html: html }} />
                  ) : null}
                </div>
                <div className="statusbar" style={{ borderTop: '1px solid var(--border)' }}>
                  <span className="item"><WrapText size={11} /> {content.length} chars</span>
                  <span className="item">{outline.length} headings</span>
                  <span className="item">{matches.length} search matches</span>
                  <span className="spacer" />
                  <span className="item">Preview sanitizes HTML and blocks remote resources.</span>
                </div>
              </>
            ) : (
              <EmptyState icon={FileCode2} title="Select or create a document" description="Choose a Markdown file on the left, or create a new one. Git++ writes the real file on disk." actions={<button className="btn primary" onClick={() => setNewOpen(true)}><FilePlus2 size={13} /> New document</button>} />
            )}
          </div>
        </div>
      </div>

      {newOpen ? (
        <Modal title="New Markdown document" description="The file is created in the repository working tree. You can stage it from Changes." onClose={() => setNewOpen(false)} width="narrow" footer={<><button className="btn ghost" onClick={() => setNewOpen(false)}>Cancel</button><button className="btn primary" disabled={!newPath.trim()} onClick={() => void create()}>Create</button></>}>
          <Field label="Repository-relative path" help="Existing files are not overwritten (the save is rejected if the file changed)."><input className="input mono" value={newPath} onChange={(event) => setNewPath(event.target.value)} spellCheck={false} autoFocus /></Field>
        </Modal>
      ) : null}

      {forceOpen ? (
        <Modal title="Overwrite the file on disk?" description="An external change exists that Git++ does not have in memory." onClose={() => setForceOpen(false)} width="narrow" footer={<><button className="btn ghost" onClick={() => setForceOpen(false)}>Cancel</button><button className="btn danger" onClick={() => void save(true)}>Overwrite with my version</button></>}>
          <div className="banner danger"><AlertTriangle size={15} /> Saving now replaces the file on disk with the editor contents. The external change is lost unless it was committed or saved elsewhere.</div>
        </Modal>
      ) : null}
      <div style={{ display: 'none' }}><FolderOpen size={1} /><Pencil size={1} /></div>
    </div>
  );
}
