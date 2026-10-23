import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, FileWarning, Plus, RefreshCw, Save, Search, ShieldQuestion, SlidersHorizontal, X } from 'lucide-react';
import type { IgnoreCheck, IgnoreTemplate } from '../../shared/types';
import { call, errorDetail, errorMessage } from '../lib/api';
import { useApp } from '../state/AppState';
import { cx } from '../lib/utils';
import { EmptyState, Field, Spinner } from '../components/ui';

export function IgnoreWorkspace(): React.JSX.Element {
  const { snapshot, refresh, toast } = useApp();
  const repoPath = snapshot?.info.path ?? '';
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState('');
  const [exists, setExists] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState<IgnoreTemplate[]>([]);
  const [templateSearch, setTemplateSearch] = useState('');
  const [preview, setPreview] = useState<{ template: IgnoreTemplate; lines: string[] } | null>(null);
  const [checkPath, setCheckPath] = useState('');
  const [checkResult, setCheckResult] = useState<IgnoreCheck | null>(null);
  const [checking, setChecking] = useState(false);

  const dirty = content !== original;

  const load = async () => {
    if (!repoPath) return;
    setLoading(true);
    try {
      const [file, nextTemplates] = await Promise.all([
        call('ignore.read', { repoPath }),
        call('ignore.templates', {}),
      ]);
      setContent(file.content);
      setOriginal(file.content);
      setExists(file.exists);
      setTemplates(nextTemplates);
    } catch (error) {
      toast('error', 'Could not open .gitignore', errorDetail(error) ?? errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [repoPath]);

  const existingLines = useMemo(() => new Set(content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)), [content]);

  const prepareTemplate = (template: IgnoreTemplate) => {
    const lines = template.lines.filter((line) => !existingLines.has(line));
    setPreview({ template, lines });
  };

  const applyTemplate = () => {
    if (!preview) return;
    if (preview.lines.length === 0) {
      toast('info', 'Nothing to add', 'Every line in this template is already present.');
      setPreview(null);
      return;
    }
    const next = content.trimEnd() + (content.trim() ? '\n\n' : '') + `# ${preview.template.name}\n${preview.lines.join('\n')}\n`;
    setContent(next);
    setPreview(null);
    toast('info', `${preview.lines.length} rules prepared`, 'Review them, then save. No files are removed from Git tracking.');
  };

  const save = async () => {
    setSaving(true);
    try {
      const result = await call('ignore.write', { repoPath, content });
      setOriginal(result.content);
      setExists(result.exists);
      toast('success', '.gitignore saved', 'Git will apply these rules to untracked files. Already tracked files remain tracked.');
      await refresh();
    } catch (error) {
      toast('error', 'Could not save .gitignore', errorDetail(error) ?? errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const check = async () => {
    if (!checkPath.trim()) return;
    setChecking(true);
    setCheckResult(null);
    try {
      const result = await call('ignore.check', { repoPath, path: checkPath.trim().replace(/^[.][\\/]/, '') });
      setCheckResult(result);
    } catch (error) {
      toast('error', 'Could not check that path', errorDetail(error) ?? errorMessage(error));
    } finally {
      setChecking(false);
    }
  };

  if (!snapshot) {
    return <div className="workspace"><EmptyState icon={SlidersHorizontal} title="No repository open" description="Open a repository to edit its real .gitignore file." /></div>;
  }

  const filteredTemplates = templates.filter((template) => !templateSearch || `${template.name} ${template.description}`.toLowerCase().includes(templateSearch.toLowerCase()));
  const ignoredTrackedWarning = snapshot.files.some((file) => !file.untracked && file.staged === false);

  return (
    <div className="workspace">
      <div className="workspace-header">
        <div className="workspace-heading">
          <h1>Ignore Studio {dirty ? <span className="tag amber">unsaved</span> : null}</h1>
          <p>Edit the real <span className="mono">.gitignore</span> at the repository root. Comments and existing formatting are preserved when appending templates.</p>
        </div>
        <div className="workspace-actions">
          <button className="btn" onClick={() => void load()}><RefreshCw size={13} /> Reload</button>
          <button className="btn primary" onClick={() => void save()} disabled={!dirty || saving}>{saving ? <Spinner /> : <Save size={13} />} Save .gitignore</button>
        </div>
      </div>
      <div className="workspace-body flush">
        {loading ? <div className="loading-state"><Spinner /> Reading .gitignore…</div> : null}
        {!loading ? (
          <div className="ignore-layout">
            <div className="ignore-editor">
              <div className="diff-toolbar">
                <span className="mono small">.gitignore</span>
                {exists ? <span className="tag">tracked file</span> : <span className="tag amber">will be created</span>}
                <div className="spacer" />
                <span className="small dim">{content.split('\n').length} lines</span>
              </div>
              <textarea value={content} onChange={(event) => setContent(event.target.value)} spellCheck={false} placeholder="# Dependencies\nnode_modules/\n\n# Build output\ndist/\n" aria-label="gitignore contents" />
              <div className="panel-body" style={{ borderTop: '1px solid var(--border)' }}>
                <div className="banner info"><AlertTriangle size={14} /><span><strong>Ignoring is not untracking.</strong> Rules apply to untracked files. A file already committed stays tracked until you explicitly run <span className="inline-code">git rm --cached</span>; Git++ never does that automatically.</span></div>
              </div>
            </div>
            <div className="ignore-side">
              <div className="panel-header"><h2>Check a path</h2></div>
              <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="row" style={{ gap: 6 }}>
                  <input className="input" value={checkPath} onChange={(event) => setCheckPath(event.target.value)} placeholder="src/generated/output.js" spellCheck={false} onKeyDown={(event) => { if (event.key === 'Enter') void check(); }} />
                  <button className="btn" onClick={() => void check()} disabled={checking}>{checking ? <Spinner /> : <Search size={12} />}</button>
                </div>
                {checkResult ? (
                  <div className={cx('banner', checkResult.ignored ? 'warn' : 'info')} style={{ padding: '8px 10px' }}>
                    <ShieldQuestion size={14} />
                    <div>
                      <strong>{checkResult.ignored ? 'This path is ignored.' : 'This path is not ignored.'}</strong>
                      {checkResult.ignored ? <div className="small mono">{checkResult.source}:{checkResult.line} → <span className="inline-code">{checkResult.pattern}</span></div> : <div className="small">No rule in .gitignore, .git/info/exclude or global excludes matches it.</div>}
                      {checkResult.ignored ? <div className="small">If the file is already tracked, the ignore rule has no effect on it.</div> : null}
                    </div>
                  </div>
                ) : null}
                <div className="small muted">Uses <span className="inline-code">git check-ignore -v --no-index</span>, so you can test hypothetical new files.</div>
              </div>
              <div className="panel-header" style={{ borderTop: '1px solid var(--border)' }}><h2>Templates</h2><span className="tag">{templates.length}</span></div>
              <div className="panel-body" style={{ padding: 8 }}>
                <input className="input" placeholder="Search templates" value={templateSearch} onChange={(event) => setTemplateSearch(event.target.value)} style={{ marginBottom: 8 }} />
                {filteredTemplates.map((template) => (
                  <div className="template-card" key={template.id}>
                    <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
                      <span className="name">{template.name}</span>
                      <button className="btn sm" onClick={() => prepareTemplate(template)}><Plus size={10} /> Add</button>
                    </div>
                    <span className="desc">{template.description}</span>
                  </div>
                ))}
              </div>
              <div style={{ padding: 12 }} className="small muted">
                {ignoredTrackedWarning ? 'Some tracked files are modified. Remember: ignore rules do not untrack them.' : 'Templates are static suggestions; always review before saving.'}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {preview ? (
        <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreview(null); }}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Template preview">
            <div className="modal-header"><div><h3>Add {preview.template.name} rules</h3><p>{preview.lines.length === 0 ? 'All of these rules are already present.' : `${preview.lines.length} new rule${preview.lines.length === 1 ? '' : 's'} will be appended.`}</p></div><button className="modal-close" onClick={() => setPreview(null)}><X size={16} /></button></div>
            <div className="modal-body">
              <pre className="mono-block">{preview.lines.length > 0 ? preview.lines.join('\n') : '(no new lines)'}</pre>
              <div className="banner info"><Check size={14} /> Existing content and comments are kept. Nothing is deleted, and no file is untracked.</div>
            </div>
            <div className="modal-footer"><button className="btn ghost" onClick={() => setPreview(null)}>Cancel</button><button className="btn primary" onClick={applyTemplate} disabled={preview.lines.length === 0}>Append rules</button></div>
          </div>
        </div>
      ) : null}
      <div style={{ display: 'none' }}><FileWarning size={1} /><Field label="" ><span /></Field></div>
    </div>
  );
}
