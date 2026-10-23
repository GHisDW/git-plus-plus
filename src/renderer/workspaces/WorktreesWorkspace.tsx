import React, { useEffect, useState } from 'react';
import {
  AlertTriangle, Boxes, FolderOpen, GitBranch, Lock, Plus, RefreshCw, Sparkles, Trash2, Unlock, ArrowUpRight, ExternalLink,
} from 'lucide-react';
import type { WorktreeInfo } from '../../shared/types';
import { call, errorDetail, errorMessage } from '../lib/api';
import { useApp } from '../state/AppState';
import { cx, joinPath } from '../lib/utils';
import { ConfirmDialog, EmptyState, Field, Modal, Spinner } from '../components/ui';

export function WorktreesWorkspace(): React.JSX.Element {
  const { snapshot, runOperation, toast, openRepository, info } = useApp();
  const repoPath = snapshot?.info.path ?? '';
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [branch, setBranch] = useState('');
  const [destination, setDestination] = useState('');
  const [createBranch, setCreateBranch] = useState(true);
  const [startPoint, setStartPoint] = useState('HEAD');
  const [removeTarget, setRemoveTarget] = useState<WorktreeInfo | null>(null);
  const [forceRemove, setForceRemove] = useState(false);

  const load = async (silent = false) => {
    if (!repoPath) return;
    if (!silent) setLoading(true);
    try {
      setWorktrees(await call('git.worktrees', { repoPath }));
    } catch (error) {
      toast('error', 'Could not list worktrees', errorDetail(error) ?? errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [repoPath, snapshot?.refreshedAt]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: string; branch?: string } | string>).detail;
      if (typeof detail === 'string') {
          return;
      }
      if (detail && typeof detail === 'object' && detail.action === 'create-worktree') {
        setBranch(detail.branch ?? '');
        setCreateBranch(false);
        setCreateOpen(true);
      }
    };
    window.addEventListener('gitpp:action', handler);
    return () => window.removeEventListener('gitpp:action', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = () => {
    setBranch('');
    setCreateBranch(true);
    setStartPoint('HEAD');
    setDestination(snapshot ? joinPath(snapshot.info.path.replace(/[\\/][^\\/]+$/, ''), `${snapshot.info.name}-worktree`) : '');
    setCreateOpen(true);
  };

  const chooseDestination = async () => {
    try {
      const result = await call('dialog.openDirectory', { title: 'Choose an empty folder for the new worktree' });
      if (result.path) setDestination(result.path);
    } catch (error) {
      toast('error', 'Could not open the folder picker', errorMessage(error));
    }
  };

  const create = async () => {
    if (!branch.trim() || !destination.trim()) return;
    const result = await runOperation('Creating worktree…', () => call('git.addWorktree', {
      repoPath,
      path: destination.trim(),
      branch: branch.trim(),
      createBranch,
      ...(startPoint.trim() ? { startPoint: startPoint.trim() } : {}),
    }), { success: `Worktree for ${branch.trim()} created`, refresh: false });
    if (result) {
      setCreateOpen(false);
      await load(true);
    }
  };

  const remove = async () => {
    if (!removeTarget) return;
    const target = removeTarget;
    const result = await runOperation('Removing worktree…', () => call('git.removeWorktree', {
      repoPath,
      path: target.path,
      force: forceRemove,
      ...(forceRemove ? { confirmation: 'remove-worktree' as const } : {}),
    }), { success: 'Worktree removed', refresh: false });
    setRemoveTarget(null);
    setForceRemove(false);
    if (result) await load(true);
  };

  const prune = async () => {
    const result = await runOperation('Pruning stale worktree metadata…', () => call('git.pruneWorktrees', { repoPath }), { success: 'Worktree metadata pruned' });
    if (result) await load(true);
  };

  if (!snapshot) {
    return <div className="workspace"><EmptyState icon={Boxes} title="No repository open" description="Open a repository to create and manage real Git worktrees." /></div>;
  }

  return (
    <div className="workspace">
      <div className="workspace-header">
        <div className="workspace-heading">
          <h1>Parallel Universes <span className="tag purple">{worktrees.length} worktree{worktrees.length === 1 ? '' : 's'}</span></h1>
          <p>Real Git worktrees share one object database. Work on separate branches at the same time without stashing or copying folders.</p>
        </div>
        <div className="workspace-actions">
          <button className="btn" onClick={() => void load()}><RefreshCw size={13} /> Refresh</button>
          <button className="btn" onClick={() => void prune()} title="Remove metadata for worktrees whose folders were deleted">Prune</button>
          <button className="btn primary" onClick={openCreate}><Plus size={13} /> New worktree</button>
        </div>
      </div>
      <div className="workspace-body">
        <div className="banner info" style={{ marginBottom: 16 }}>
          <Sparkles size={15} />
          <span><strong>A worktree is a real checkout with its own HEAD and index.</strong> Branches checked out in one worktree cannot be checked out in another. Removing a worktree never deletes the branch; Git++ will not delete the folder unless Git does so as part of the remove operation.</span>
        </div>
        {loading ? <div className="loading-state"><Spinner /> Reading worktrees…</div> : null}
        {!loading ? (
          <div className="worktree-grid">
            {worktrees.map((worktree) => (
              <div key={worktree.path} className={cx('worktree-card', worktree.path === repoPath && 'current')}>
                <div className="worktree-head">
                  <div className="worktree-icon"><Boxes size={16} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="worktree-title">{worktree.isMain ? 'Main working tree' : 'Linked worktree'}</div>
                    <div className="worktree-path" title={worktree.path}>{worktree.path}</div>
                  </div>
                  {worktree.locked ? <span className="tag amber"><Lock size={9} />locked</span> : null}
                  {worktree.prunable ? <span className="tag red">missing</span> : null}
                </div>
                <div className="worktree-body">
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="row" style={{ gap: 5 }}><GitBranch size={11} />{worktree.branch ?? (worktree.detached ? 'detached HEAD' : 'bare')}</span>
                    {worktree.shortHead ? <span className="mono">{worktree.shortHead}</span> : null}
                  </div>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span>Working tree</span>
                    {worktree.statusError ? <span className="tag red">{worktree.statusError}</span> : <span className={cx('tag', worktree.dirty ? 'amber' : 'green')}>{worktree.dirty ? 'uncommitted changes' : 'clean'}</span>}
                  </div>
                  {worktree.path === repoPath ? <span className="tag accent">currently open</span> : null}
                </div>
                <div className="worktree-foot">
                  <button className="btn sm" onClick={() => void openRepository(worktree.path)} disabled={worktree.path === repoPath}><ArrowUpRight size={11} /> Open in Git++</button>
                  <button className="btn sm" onClick={() => void call('app.showItemInFolder', { path: worktree.path }).catch(() => toast('error', 'Could not reveal the folder'))}><FolderOpen size={11} /> Reveal folder</button>
                  {worktree.path !== repoPath ? <button className="btn sm danger" onClick={() => { setRemoveTarget(worktree); setForceRemove(false); }} disabled={worktree.isMain}><Trash2 size={11} /> Remove</button> : null}
                </div>
              </div>
            ))}
            <button className="worktree-card" style={{ alignItems: 'center', justifyContent: 'center', minHeight: 180, borderStyle: 'dashed', cursor: 'pointer' }} onClick={openCreate}>
              <Plus size={20} style={{ color: 'var(--accent)' }} />
              <span className="small" style={{ marginTop: 6 }}>Create another worktree</span>
              <span className="small dim">Work on a second branch right now</span>
            </button>
          </div>
        ) : null}
      </div>

      {createOpen ? (
        <Modal title="Create a worktree" description="Uses `git worktree add`. The destination must be empty or not exist yet." onClose={() => setCreateOpen(false)} width="normal" footer={<><button className="btn ghost" onClick={() => setCreateOpen(false)}>Cancel</button><button className="btn primary" disabled={!branch.trim() || !destination.trim()} onClick={() => void create()}>Create worktree</button></>}>
          <div className="grid-2">
            <Field label="Branch" help="Existing branch name, or a new name when “create branch” is checked."><input className="input" value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="feature/parallel-work" spellCheck={false} autoFocus /></Field>
            <Field label="Start point" help="Used only when creating a new branch."><input className="input" value={startPoint} onChange={(event) => setStartPoint(event.target.value)} spellCheck={false} /></Field>
          </div>
          <Field label="Destination folder">
            <div className="row" style={{ gap: 6 }}>
              <input className="input" value={destination} onChange={(event) => setDestination(event.target.value)} placeholder={info?.platform === 'win32' ? 'C:\\projects\\repo-worktree' : '/home/you/projects/repo-worktree'} spellCheck={false} />
              <button className="btn" onClick={() => void chooseDestination()}>Browse</button>
            </div>
          </Field>
          <label className="checkbox-row"><input type="checkbox" checked={createBranch} onChange={(event) => setCreateBranch(event.target.checked)} /> Create the branch if it does not exist</label>
          <div className="banner info"><Boxes size={14} /> The new worktree appears as a complete folder with its own uncommitted changes. Git++ will treat it as a separate repository.</div>
        </Modal>
      ) : null}

      {removeTarget ? (
        <ConfirmDialog
          title="Remove this worktree?"
          description={<span>Git removes the worktree registration for <span className="inline-code">{removeTarget.path}</span>. The branch is not deleted.</span>}
          confirmLabel={forceRemove ? 'Force remove worktree' : 'Remove worktree'}
          danger
          onClose={() => { setRemoveTarget(null); setForceRemove(false); }}
          onConfirm={remove}
          confirmPhrase={forceRemove ? `remove ${removeTarget.branch ?? 'worktree'}` : undefined}
          consequences={forceRemove ? [
            'Git is asked to remove the worktree even with uncommitted changes or untracked files.',
            'Uncommitted work in that folder may be lost.',
            'The branch itself and its commits remain.',
          ] : [
            'Git refuses to remove a worktree with uncommitted changes.',
            `Worktree status: ${removeTarget.dirty ? 'has uncommitted changes' : 'clean'}.`,
            'The branch and its commits remain. No remote is affected.',
          ]}
        >
          <label className="checkbox-row"><input type="checkbox" checked={forceRemove} onChange={(event) => setForceRemove(event.target.checked)} /> Force removal (<span className="mono">--force</span>) despite uncommitted changes</label>
          {removeTarget.locked ? <div className="banner warn"><Lock size={14} /> This worktree is locked. Git may require unlocking it first.</div> : null}
          {removeTarget.path === repoPath ? <div className="banner danger"><AlertTriangle size={14} /> This is the currently open worktree. Switch to another repository before removing it.</div> : null}
        </ConfirmDialog>
      ) : null}
      <div style={{ display: 'none' }}><Unlock size={1} /><ExternalLink size={1} /><ProjectIcon /></div>
    </div>
  );
}

function ProjectIcon(): React.JSX.Element {
  return <GitBranch size={1} />;
}

