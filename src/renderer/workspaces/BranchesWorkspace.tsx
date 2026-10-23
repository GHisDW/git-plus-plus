import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowDown, ArrowUp, Boxes, Check, GitBranch, GitMerge, GitPullRequestArrow, Pencil, Plus,
  RefreshCw, Search, Trash2, Undo2, Upload, Link2, ChevronRight,
} from 'lucide-react';
import type { BranchInfo } from '../../shared/types';
import { call, errorDetail, errorMessage } from '../lib/api';
import { useApp } from '../state/AppState';
import { cx, plural } from '../lib/utils';
import { relativeTime } from '../../shared/format';
import { ConfirmDialog, EmptyState, Field, Modal, Spinner } from '../components/ui';

type ModalKind = 'create' | 'rename' | 'upstream' | 'delete' | null;

export function BranchesWorkspace(): React.JSX.Element {
  const { snapshot, runOperation, toast, setWorkspace } = useApp();
  const repoPath = snapshot?.info.path ?? '';
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showRemotes, setShowRemotes] = useState(true);
  const [modal, setModal] = useState<ModalKind>(null);
  const [target, setTarget] = useState<BranchInfo | null>(null);
  const [name, setName] = useState('');
  const [startPoint, setStartPoint] = useState('');
  const [checkout, setCheckout] = useState(true);
  const [upstream, setUpstream] = useState('');
  const [forceDelete, setForceDelete] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState<{ kind: 'merge' | 'rebase'; branch: BranchInfo } | null>(null);
  const [forcePhrase, setForcePhrase] = useState('');

  const load = async (silent = false) => {
    if (!repoPath) return;
    if (!silent) setLoading(true);
    try {
      setBranches(await call('git.branches', { repoPath }));
    } catch (error) {
      toast('error', 'Could not load branches', errorDetail(error) ?? errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [repoPath, snapshot?.refreshedAt]);

  useEffect(() => {
    const handler = (event: Event) => {
      if ((event as CustomEvent<string>).detail === 'new-branch') openCreate();
    };
    window.addEventListener('gitpp:action', handler);
    return () => window.removeEventListener('gitpp:action', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = branches.find((branch) => branch.isHead) ?? null;
  const local = branches.filter((branch) => !branch.isRemote);
  const remote = branches.filter((branch) => branch.isRemote);
  const filteredLocal = local.filter((branch) => branch.name.toLowerCase().includes(search.toLowerCase()));
  const filteredRemote = remote.filter((branch) => branch.name.toLowerCase().includes(search.toLowerCase()));

  const openCreate = () => {
    setName('');
    setStartPoint(current?.name ?? 'HEAD');
    setCheckout(true);
    setModal('create');
  };

  const switchTo = async (branch: BranchInfo) => {
    if (branch.isHead) return;
    setSwitching(branch.name);
    const result = await runOperation(`Switching to ${branch.name}…`, () => call('git.switchBranch', { repoPath, name: branch.name }), {
      success: `Now on ${branch.name}`,
      refresh: false,
    });
    setSwitching(null);
    if (result) {
      await load(true);
      toast('info', 'Branch switched', 'Uncommitted changes were checked for conflicts before switching.');
    }
  };

  const create = async () => {
    if (!name.trim()) return;
    const result = await runOperation('Creating branch…', () => call('git.createBranch', {
      repoPath,
      name: name.trim(),
      ...(startPoint.trim() ? { startPoint: startPoint.trim() } : {}),
      checkout,
    }), { success: `Branch ${name.trim()} created` });
    if (result) {
      setModal(null);
      await load(true);
    }
  };

  const rename = async () => {
    if (!target || !name.trim()) return;
    const result = await runOperation('Renaming branch…', () => call('git.renameBranch', { repoPath, from: target.name, to: name.trim() }), {
      success: `Renamed ${target.name} to ${name.trim()}`,
    });
    if (result) {
      setModal(null);
      await load(true);
    }
  };

  const remove = async () => {
    if (!target) return;
    const result = await runOperation(target && forceDelete ? 'Force-deleting branch…' : 'Deleting branch…', () =>
      call('git.deleteBranch', { repoPath, name: target.name, force: forceDelete }), {
      success: `Branch ${target.name} deleted`,
    });
    setModal(null);
    setForceDelete(false);
    setForcePhrase('');
    if (result) await load(true);
  };

  const setUpstreamBranch = async () => {
    if (!target || !upstream.trim()) return;
    const result = await runOperation('Setting upstream…', () => call('git.setUpstream', { repoPath, branch: target.name, upstream: upstream.trim() }), {
      success: `Upstream for ${target.name} set to ${upstream.trim()}`,
    });
    if (result) {
      setModal(null);
      await load(true);
    }
  };

  const runAdvanced = async () => {
    if (!advanced) return;
    const { kind, branch } = advanced;
    const result = await runOperation(kind === 'merge' ? `Merging ${branch.name}…` : `Rebasing onto ${branch.name}…`, () =>
      kind === 'merge' ? call('git.merge', { repoPath, ref: branch.name }) : call('git.rebase', { repoPath, onto: branch.name }), { silentError: false });
    setAdvanced(null);
    if (result) {
      await load(true);
      if ('conflicts' in (result as object) && Array.isArray((result as { conflicts?: string[] }).conflicts) && (result as { conflicts: string[] }).conflicts.length > 0) {
        toast('warning', 'Conflicts need resolution', 'Git stopped the operation. Resolve the files in Changes, then continue from the conflict workspace.');
        setWorkspace('changes');
      }
    }
  };

  if (!snapshot) {
    return <div className="workspace"><EmptyState icon={GitBranch} title="No repository open" description="Open a repository to manage its real local and remote-tracking branches." /></div>;
  }

  return (
    <div className="workspace">
      <div className="workspace-header">
        <div className="workspace-heading">
          <h1>Branches <span className="tag">{local.length} local · {remote.length} remote-tracking</span></h1>
          <p>{current ? <>Current branch <strong>{current.name}</strong>{current.checkedOutAt ? ` (also checked out at ${current.checkedOutAt})` : ''}</> : 'Detached HEAD — no branch is checked out'}</p>
        </div>
        <div className="workspace-actions">
          <button className="btn" onClick={() => void load()}><RefreshCw size={13} /> Refresh</button>
          <button className="btn primary" onClick={openCreate}><Plus size={13} /> New branch</button>
        </div>
      </div>
      <div className="workspace-body">
        {snapshot.info.head.detached ? (
          <div className="banner warn" style={{ marginBottom: 14 }}><AlertTriangle size={15} /><div><strong>Detached HEAD.</strong> New commits will not belong to a branch. Create a branch from this position to keep them.</div><div className="banner-actions"><button className="btn sm" onClick={() => { setTarget(null); setName(''); setCheckout(true); setStartPoint('HEAD'); setModal('create'); }}>Create branch here</button></div></div>
        ) : null}
        {snapshot.info.head.unborn ? (
          <div className="banner info" style={{ marginBottom: 14 }}><GitBranch size={15} /><div><strong>Unborn branch.</strong> This branch has no commits yet. Commit first, then create other branches.</div></div>
        ) : null}

        <div className="row" style={{ marginBottom: 12, gap: 8 }}>
          <div className="row" style={{ gap: 6, flex: 1, maxWidth: 360 }}>
            <Search size={13} style={{ color: 'var(--text-muted)' }} />
            <input className="input" placeholder="Filter branches" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
          <label className="checkbox-row"><input type="checkbox" checked={showRemotes} onChange={(event) => setShowRemotes(event.target.checked)} /> Show remote-tracking branches</label>
        </div>

        {loading ? <div className="loading-state"><Spinner /> Reading branches…</div> : null}
        {!loading ? (
          <div className="stack">
            <div className="panel">
              <div className="panel-header"><h2>Local branches</h2><span className="tag">{filteredLocal.length}</span></div>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Branch</th><th>Upstream</th><th>Tracking</th><th>Last commit</th><th>Updated</th><th /></tr></thead>
                  <tbody>
                    {filteredLocal.length === 0 ? <tr><td colSpan={6}><span className="muted small">No local branches match.</span></td></tr> : null}
                    {filteredLocal.map((branch) => (
                      <tr key={branch.fullName} className={cx(branch.isHead && 'selected')}>
                        <td>
                          <div className="row" style={{ gap: 6 }}>
                            <GitBranch size={12} style={{ color: branch.isHead ? 'var(--green)' : 'var(--text-muted)' }} />
                            <span className="mono" style={{ fontSize: 12 }}>{branch.name}</span>
                            {branch.isHead ? <span className="tag green">HEAD</span> : null}
                            {branch.checkedOutAt && !branch.isHead ? <span className="tag amber" title={branch.checkedOutAt}>worktree</span> : null}
                          </div>
                        </td>
                        <td className="mono">{branch.upstream ?? <span className="dim">not set</span>}</td>
                        <td>
                          <span className="row" style={{ gap: 5 }}>
                            {branch.ahead > 0 ? <span className="tag green"><ArrowUp size={9} />{branch.ahead}</span> : null}
                            {branch.behind > 0 ? <span className="tag amber"><ArrowDown size={9} />{branch.behind}</span> : null}
                            {branch.ahead === 0 && branch.behind === 0 ? <span className="dim small">in sync</span> : null}
                          </span>
                        </td>
                        <td className="truncate" style={{ maxWidth: 240 }} title={branch.subject}>{branch.subject || '—'}</td>
                        <td className="mono">{relativeTime(branch.updatedAt)}</td>
                        <td>
                          <div className="row-actions" style={{ opacity: 1 }}>
                            {!branch.isHead ? <button className="btn sm" onClick={() => void switchTo(branch)} disabled={Boolean(switching)} title="Switch to this branch">{switching === branch.name ? <Spinner /> : <Check size={11} />} Switch</button> : null}
                            {!branch.isHead && !branch.isHead ? <button className="btn ghost icon" onClick={() => { setTarget(branch); setAdvanced({ kind: 'merge', branch }); }} title="Merge into current branch"><GitMerge size={12} /></button> : null}
                            <button className="btn ghost icon" onClick={() => { setTarget(branch); setName(branch.name); setModal('rename'); }} title="Rename"><Pencil size={12} /></button>
                            <button className="btn ghost icon" onClick={() => { setTarget(branch); setUpstream(branch.upstream ?? `origin/${branch.name}`); setModal('upstream'); }} title="Set upstream"><Link2 size={12} /></button>
                            <button className="btn ghost icon" onClick={() => { setTarget(branch); setForceDelete(false); setForcePhrase(''); setModal('delete'); }} title="Delete"><Trash2 size={12} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {showRemotes ? (
              <div className="panel">
                <div className="panel-header"><h2>Remote-tracking branches</h2><span className="tag">{filteredRemote.length}</span><div className="panel-actions"><button className="btn ghost sm" onClick={() => { if (current) window.dispatchEvent(new CustomEvent('gitpp:action', { detail: { action: 'create-worktree', branch: current.name } })); setWorkspace('worktrees'); }}><Boxes size={11} /> Worktrees</button></div></div>
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Branch</th><th>Remote</th><th>Last commit</th><th>Updated</th><th /></tr></thead>
                    <tbody>
                      {filteredRemote.length === 0 ? <tr><td colSpan={5}><span className="muted small">No remote-tracking branches. Fetch from a remote to populate them.</span></td></tr> : null}
                      {filteredRemote.map((branch) => (
                        <tr key={branch.fullName}>
                          <td className="mono" style={{ fontSize: 12 }}>{branch.name}</td>
                          <td><span className="tag purple">{branch.remote ?? 'remote'}</span></td>
                          <td className="truncate" style={{ maxWidth: 260 }}>{branch.subject}</td>
                          <td className="mono">{relativeTime(branch.updatedAt)}</td>
                          <td><div className="row-actions" style={{ opacity: 1 }}>
                            <button className="btn sm" onClick={() => { setTarget(branch); setName(branch.name.split('/').slice(1).join('/')); setStartPoint(branch.name); setCheckout(true); setModal('create'); }} title="Create a local branch from this remote branch"><GitPullRequestArrow size={11} /> Track locally</button>
                          </div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <div style={{ height: 24 }} />
      </div>

      {modal === 'create' ? (
        <Modal title="Create branch" description="The branch is created with a real `git switch -c` (or `git branch` when checkout is off)." onClose={() => setModal(null)} width="narrow" footer={<><button className="btn ghost" onClick={() => setModal(null)}>Cancel</button><button className="btn primary" disabled={!name.trim()} onClick={() => void create()}>Create branch</button></>}>
          <Field label="Branch name" help="Git validates the name with check-ref-format. Spaces and some punctuation are rejected."><input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="feature/my-change" spellCheck={false} autoFocus /></Field>
          <Field label="Start point" help="A branch, tag or commit. Leave as HEAD for the current position."><input className="input" value={startPoint} onChange={(event) => setStartPoint(event.target.value)} spellCheck={false} /></Field>
          <label className="checkbox-row"><input type="checkbox" checked={checkout} onChange={(event) => setCheckout(event.target.checked)} /> Switch to the new branch after creating it</label>
        </Modal>
      ) : null}

      {modal === 'rename' && target ? (
        <Modal title={`Rename ${target.name}`} onClose={() => setModal(null)} width="narrow" footer={<><button className="btn ghost" onClick={() => setModal(null)}>Cancel</button><button className="btn primary" disabled={!name.trim()} onClick={() => void rename()}>Rename</button></>}>
          <Field label="New branch name"><input className="input" value={name} onChange={(event) => setName(event.target.value)} spellCheck={false} autoFocus /></Field>
          <div className="banner info">The branch ref is renamed locally. Upstream tracking and remote branches are not renamed by this operation.</div>
        </Modal>
      ) : null}

      {modal === 'upstream' && target ? (
        <Modal title={`Set upstream for ${target.name}`} onClose={() => setModal(null)} width="narrow" footer={<><button className="btn ghost" onClick={() => setModal(null)}>Cancel</button><button className="btn primary" disabled={!upstream.trim()} onClick={() => void setUpstreamBranch()}>Set upstream</button></>}>
          <Field label="Upstream reference" help="Example: origin/main. Git must already know this remote-tracking ref; fetch first if needed."><input className="input" value={upstream} onChange={(event) => setUpstream(event.target.value)} spellCheck={false} autoFocus /></Field>
        </Modal>
      ) : null}

      {modal === 'delete' && target ? (
        <ConfirmDialog
          title={`Delete branch ${target.name}?`}
          description="Git checks whether the branch is merged before deleting. Nothing is deleted from any remote."
          confirmLabel={forceDelete ? 'Force delete branch' : 'Delete branch'}
          danger
          onClose={() => { setModal(null); setForceDelete(false); setForcePhrase(''); }}
          onConfirm={remove}
          consequences={forceDelete ? [
            'Git runs `git branch -D`, which deletes the ref even if commits are unmerged.',
            'Commits may become unreachable (recoverable only via reflog for a limited time).',
            'No remote branch is affected.',
          ] : [
            'Git runs `git branch -d`; the branch is deleted only if it is fully merged.',
            'The branch must not be checked out in any worktree.',
            'No remote branch is affected.',
          ]}
          confirmPhrase={forceDelete ? `delete ${target.name}` : undefined}
        >
          <label className="checkbox-row"><input type="checkbox" checked={forceDelete} onChange={(event) => { setForceDelete(event.target.checked); setForcePhrase(''); }} /> Force delete (<span className="mono">-D</span>) even if unmerged</label>
          {target.checkedOutAt ? <div className="banner warn"><AlertTriangle size={14} /> This branch is checked out in a worktree at <span className="mono">{target.checkedOutAt}</span>. Git will refuse to delete it.</div> : null}
        </ConfirmDialog>
      ) : null}

      {advanced ? (
        <ConfirmDialog
          title={advanced.kind === 'merge' ? `Merge ${advanced.branch.name} into ${current?.name ?? 'HEAD'}?` : `Rebase ${current?.name ?? 'current branch'} onto ${advanced.branch.name}?`}
          description={advanced.kind === 'merge' ? 'A merge combines the two histories. Git may create a merge commit.' : 'Rebase replays your commits on top of the other branch, rewriting this branch’s local history.'}
          confirmLabel={advanced.kind === 'merge' ? 'Merge' : 'Rebase'}
          danger={advanced.kind === 'rebase'}
          onClose={() => setAdvanced(null)}
          onConfirm={runAdvanced}
          consequences={advanced.kind === 'merge' ? [
            `Current branch: ${current?.name ?? 'detached HEAD'}.`,
            `Incoming history: ${advanced.branch.name}.`,
            'Existing commits are preserved; a merge commit may be created.',
            'If both sides changed the same lines, Git stops with conflicts.',
          ] : [
            `Current branch: ${current?.name ?? 'detached HEAD'}.`,
            `New base: ${advanced.branch.name}.`,
            'Local commits are replayed and receive new hashes. Do not rebase shared branches without coordination.',
            'Conflicts may stop the rebase; it can be aborted from the conflict workspace.',
          ]}
        />
      ) : null}

      <div style={{ display: 'none' }}><Undo2 size={1} /><Upload size={1} /><ChevronRight size={1} /><AlertTriangle size={1} /><GitBranch size={1} /><Undo2 size={1} /></div>
    </div>
  );
}

void plural;
