import React, { useCallback, useEffect, useState } from 'react';
import { Archive, AlertTriangle, ArrowDownToLine, Clock, GitBranch, PackageOpen, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import type { DiffResult, StashEntry } from '../../shared/types';
import { call, errorDetail, errorMessage } from '../lib/api';
import { useApp } from '../state/AppState';
import { cx, plural } from '../lib/utils';
import { formatDateTime } from '../../shared/format';
import { DiffViewer } from '../components/DiffViewer';
import { ConfirmDialog, EmptyState, Field, Modal, Spinner } from '../components/ui';

export function StashesWorkspace(): React.JSX.Element {
  const { snapshot, settings, updateSettings, runOperation, toast, refresh } = useApp();
  const repoPath = snapshot?.info.path ?? '';
  const [stashes, setStashes] = useState<StashEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [includeUntracked, setIncludeUntracked] = useState(true);
  const [dropTarget, setDropTarget] = useState<StashEntry | null>(null);
  const [popTarget, setPopTarget] = useState<StashEntry | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!repoPath) return;
    if (!silent) setLoading(true);
    try {
      const list = await call('git.stashes', { repoPath });
      setStashes(list);
      setSelected((current) => (current && list.some((stash) => stash.ref === current) ? current : list[0]?.ref ?? null));
    } catch (error) {
      toast('error', 'Could not list stashes', errorDetail(error) ?? errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [repoPath, toast]);

  useEffect(() => { void load(); }, [load, snapshot?.refreshedAt]);

  useEffect(() => {
    const handler = (event: Event) => {
      if ((event as CustomEvent<string>).detail === 'new-stash') setCreateOpen(true);
    };
    window.addEventListener('gitpp:action', handler);
    return () => window.removeEventListener('gitpp:action', handler);
  }, []);

  useEffect(() => {
    if (!selected) { setDiff(null); return undefined; }
    let active = true;
    setDiffLoading(true);
    setDiffError(null);
    call('git.diff', { repoPath, target: 'stash', stashRef: selected, context: settings.diff.context, ignoreWhitespace: settings.diff.ignoreWhitespace })
      .then((result) => { if (active) setDiff(result); })
      .catch((error: unknown) => { if (active) setDiffError(errorDetail(error) ?? errorMessage(error)); })
      .finally(() => { if (active) setDiffLoading(false); });
    return () => { active = false; };
  }, [repoPath, selected, settings.diff.context, settings.diff.ignoreWhitespace, snapshot?.refreshedAt]);

  const create = async () => {
    const result = await runOperation('Stashing changes…', () => call('git.createStash', {
      repoPath,
      ...(message.trim() ? { message: message.trim() } : {}),
      includeUntracked,
    }), { success: 'Stash created', refresh: false });
    if (result) {
      setCreateOpen(false);
      setMessage('');
      await load(true);
      await refresh();
    }
  };

  const apply = async (stash: StashEntry, pop: boolean) => {
    const result = await runOperation(pop ? 'Popping stash…' : 'Applying stash…', () =>
      call(pop ? 'git.popStash' : 'git.applyStash', { repoPath, ref: stash.ref }), { refresh: false, success: pop ? 'Stash popped' : 'Stash applied. The stash entry was kept.' });
    setPopTarget(null);
    if (result) {
      await refresh();
      await load(true);
      if (result.operation.conflicts.length > 0) {
        toast('warning', 'Stash applied with conflicts', 'The stash entry was kept. Resolve conflicts in Changes.');
      }
    }
  };

  const drop = async () => {
    if (!dropTarget) return;
    const target = dropTarget;
    const result = await runOperation('Dropping stash…', () => call('git.dropStash', { repoPath, ref: target.ref }), { success: 'Stash dropped' });
    setDropTarget(null);
    if (result) await load(true);
  };

  if (!snapshot) {
    return <div className="workspace"><EmptyState icon={Archive} title="No repository open" description="Open a repository to create and restore real Git stashes." /></div>;
  }

  return (
    <div className="workspace">
      <div className="workspace-header">
        <div className="workspace-heading">
          <h1>Stashes <span className="tag">{stashes.length}</span></h1>
          <p>Stashes are convenient temporary storage, not backups. They live in this clone and can be lost.</p>
        </div>
        <div className="workspace-actions">
          <button className="btn" onClick={() => void load()}><RefreshCw size={13} /> Refresh</button>
          <button className="btn primary" onClick={() => setCreateOpen(true)}><Plus size={13} /> Stash changes</button>
        </div>
      </div>
      <div className="workspace-body flush">
        {loading ? <div className="loading-state"><Spinner /> Reading stashes…</div> : null}
        {!loading && stashes.length === 0 ? (
          <div className="workspace-body">
            <EmptyState icon={Archive} title="No stashes yet" description="Stash your staged and unstaged changes to temporarily clean the working tree. Untracked files are included only if you ask. A stash is not a substitute for a commit." actions={<button className="btn primary" onClick={() => setCreateOpen(true)}><Plus size={13} /> Create a stash</button>} />
          </div>
        ) : null}
        {!loading && stashes.length > 0 ? (
          <div className="stash-layout">
            <div className="stash-list">
              <div className="panel-header" style={{ position: 'sticky', top: 0, zIndex: 1 }}><h2>Saved states</h2><span className="tag">{plural(stashes.length, 'entry')}</span></div>
              {stashes.map((stash) => (
                <button key={stash.ref} className={cx('list-item', selected === stash.ref && 'selected')} style={{ width: '100%', textAlign: 'left', background: selected === stash.ref ? 'var(--accent-soft)' : undefined }} onClick={() => setSelected(stash.ref)}>
                  <Archive size={14} style={{ color: 'var(--text-muted)', marginTop: 2 }} />
                  <div className="item-main">
                    <div className="item-title">{stash.message || '(no message)'}</div>
                    <div className="item-sub">
                      <span className="mono">{stash.ref}</span>
                      <span className="mono">{stash.shortSha}</span>
                      {stash.branch ? <span><GitBranch size={9} /> {stash.branch}</span> : null}
                      <span><Clock size={9} /> {formatDateTime(stash.date)}</span>
                    </div>
                  </div>
                </button>
              ))}
              <div style={{ padding: 12 }} className="small muted">Tip: “Apply” keeps the stash; “Pop” removes it only if applying succeeds.</div>
            </div>
            <div className="stash-detail">
              {selected ? (
                <>
                  <div className="diff-toolbar">
                    <span className="diff-file-name">{stashes.find((stash) => stash.ref === selected)?.message ?? selected}</span>
                    <span className="tag">{selected}</span>
                    <div className="spacer" />
                    <button className="btn sm" onClick={() => { const stash = stashes.find((entry) => entry.ref === selected); if (stash) void apply(stash, false); }}><ArrowDownToLine size={11} /> Apply</button>
                    <button className="btn sm" onClick={() => { const stash = stashes.find((entry) => entry.ref === selected); if (stash) setPopTarget(stash); }}><PackageOpen size={11} /> Pop…</button>
                    <button className="btn sm danger" onClick={() => { const stash = stashes.find((entry) => entry.ref === selected); if (stash) setDropTarget(stash); }}><Trash2 size={11} /> Drop…</button>
                  </div>
                  <DiffViewer
                    diff={diff}
                    loading={diffLoading}
                    error={diffError}
                    mode={settings.diff.mode}
                    wrap={settings.diff.wrap}
                    ignoreWhitespace={settings.diff.ignoreWhitespace}
                    onModeChange={(mode) => void updateSettings({ diff: { mode } })}
                    onWrapChange={(wrap) => void updateSettings({ diff: { wrap } })}
                    onIgnoreWhitespaceChange={(ignoreWhitespace) => void updateSettings({ diff: { ignoreWhitespace } })}
                    hunkDirection={null}
                    emptyTitle="Stash contains no textual diff"
                    emptyDescription="The stash may only contain untracked binary files or metadata."
                  />
                  <div className="banner warn" style={{ margin: 12, marginTop: 0 }}>
                    <AlertTriangle size={14} />
                    <span>Applying a stash can conflict with current changes. Git++ leaves the stash in place if applying fails, and never drops it automatically.</span>
                  </div>
                </>
              ) : <EmptyState icon={Archive} title="Select a stash" description="Choose a saved state to inspect its real diff before applying it." />}
            </div>
          </div>
        ) : null}
      </div>

      {createOpen ? (
        <Modal title="Stash working changes" onClose={() => setCreateOpen(false)} width="narrow" footer={<><button className="btn ghost" onClick={() => setCreateOpen(false)}>Cancel</button><button className="btn primary" onClick={() => void create()}>Create stash</button></>}>
          <Field label="Message (optional)" help="A label makes the stash easier to find later."><input className="input" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="WIP: experiment with parser" autoFocus /></Field>
          <label className="checkbox-row"><input type="checkbox" checked={includeUntracked} onChange={(event) => setIncludeUntracked(event.target.checked)} /> Include untracked files (<span className="mono">--include-untracked</span>)</label>
          <div className="banner warn"><AlertTriangle size={14} /> Creating a stash removes those changes from your working tree. It is not a backup and does not include ignored files.</div>
        </Modal>
      ) : null}

      {popTarget ? (
        <ConfirmDialog title="Pop this stash?" description={<span>Git applies the stash and removes the entry only if applying succeeds. Conflicts may still occur.</span>} confirmLabel="Pop stash" onClose={() => setPopTarget(null)} onConfirm={() => apply(popTarget, true)} consequences={[`Stash: ${popTarget.ref} — ${popTarget.message}`, 'The changes are applied to the current working tree.', 'The stash is dropped only after a successful apply.', 'If conflicts occur, the stash entry is kept for recovery.']} />
      ) : null}

      {dropTarget ? (
        <ConfirmDialog title="Drop this stash?" description={<span>Dropping removes the stash entry. The changes are not applied and cannot be recovered by Git++.</span>} confirmLabel="Drop stash" danger onClose={() => setDropTarget(null)} onConfirm={drop} consequences={[`Stash: ${dropTarget.ref} — ${dropTarget.message}`, 'The stash commit becomes unreachable and may eventually be garbage-collected.', 'The working tree is not modified.']} />
      ) : null}
      <div style={{ display: 'none' }}><RotateCcw size={1} /></div>
    </div>
  );
}
