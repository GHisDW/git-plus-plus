import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, CheckCheck, FileDiff, Minus, Plus, RefreshCw, ShieldAlert,
  ShieldCheck, Sparkles, Trash2, Undo2, ListFilter,
} from 'lucide-react';
import type { DiffResult, RepoSnapshot, StatusEntry } from '../../shared/types';
import { call, errorDetail, errorMessage } from '../lib/api';
import { useApp } from '../state/AppState';
import { cx, fileIconState, plural } from '../lib/utils';
import { DiffViewer } from '../components/DiffViewer';
import { CommitBox } from '../components/CommitBox';
import { ConflictResolver } from '../components/ConflictResolver';
import { ConfirmDialog, EmptyState, Modal, Spinner } from '../components/ui';

interface Selection {
  path: string;
  stage: 'index' | 'worktree';
}

function entryState(entry: StatusEntry, side: 'index' | 'worktree'): string | null {
  if (entry.conflicted) return 'conflicted';
  if (entry.untracked) return side === 'worktree' ? 'untracked' : null;
  return side === 'index' ? entry.index : entry.worktree;
}

export function ChangesWorkspace(): React.JSX.Element {
  const { snapshot, settings, updateSettings, refresh, runOperation, toast, setWorkspace, applySnapshot, refresh: reloadRepo } = useApp();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [discardTarget, setDiscardTarget] = useState<StatusEntry | null>(null);
  const [showConflicts, setShowConflicts] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);

  const repoPath = snapshot?.info.path ?? '';
  const files = snapshot?.files ?? [];
  const staged = files.filter((file) => file.staged);
  const unstaged = files.filter((file) => file.unstaged && !file.conflicted);
  const untracked = files.filter((file) => file.untracked);
  const conflicted = files.filter((file) => file.conflicted);

  useEffect(() => {
    if (conflicted.length > 0) setShowConflicts(true);
  }, [conflicted.length]);

  useEffect(() => {
    if (!snapshot) return;
    if (selection && files.some((file) => file.path === selection.path)) return;
    const first = unstaged[0] ?? untracked[0] ?? staged[0] ?? conflicted[0];
    setSelection(first ? { path: first.path, stage: first.untracked || first.unstaged ? 'worktree' : 'index' } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot?.refreshedAt, snapshot?.info.path]);

  const loadDiff = useCallback(async () => {
    if (!repositoryDiffTarget(snapshot, selection)) {
      setDiff(null);
      return;
    }
    setDiffLoading(true);
    setDiffError(null);
    try {
      const target = selection?.stage === 'index' ? 'staged' : 'worktree';
      const result = await call('git.diff', {
        repoPath,
        target,
        path: selection?.path,
        context: settings.diff.context,
        ignoreWhitespace: settings.diff.ignoreWhitespace,
      });
      setDiff(result);
    } catch (error) {
      setDiffError(errorDetail(error) ?? errorMessage(error));
      setDiff(null);
    } finally {
      setDiffLoading(false);
    }
  }, [repoPath, selection, settings.diff.context, settings.diff.ignoreWhitespace, snapshot]);

  useEffect(() => {
    void loadDiff();
  }, [loadDiff]);

  useEffect(() => {
    if (!repoPath) return undefined;
    let active = true;
    void (async () => {
      try {
        const [config, runs] = await Promise.all([
          call('preflight.getConfig', { repoPath }),
          call('preflight.runs', { repoPath }),
        ]);
        if (!active) return;
        const latest = runs[0];
        if (config.blockCommitOnFailure && latest && latest.status === 'failed' && !latest.stale) {
          const failed = latest.results.filter((result) => result.status === 'failed' || result.status === 'timed-out');
          setBlockedReason(`Preflight blocks commits: ${failed.map((result) => result.name).join(', ') || 'a required check failed'}. Run checks again after fixing the problem.`);
        } else {
          setBlockedReason(null);
        }
      } catch {
        setBlockedReason(null);
      }
    })();
    return () => { active = false; };
  }, [repoPath, snapshot?.refreshedAt]);

  useEffect(() => {
    const handler = (event: Event) => {
      if ((event as CustomEvent<string>).detail === 'focus-commit') {
        setShowConflicts(false);
      }
    };
    window.addEventListener('gitpp:action', handler);
    return () => window.removeEventListener('gitpp:action', handler);
  }, []);

  const stageFiles = async (paths: string[], label: string) => {
    if (paths.length === 0) return;
    const result = await runOperation(label, () => call('git.stage', { repoPath, paths }), { success: paths.length === 1 ? 'Change staged' : `${paths.length} changes staged`, refresh: false });
    if (result) {
      applySnapshot(result);
      const updated = result.files.find((file) => file.path === selection?.path);
      if (selection && updated && !updated.unstaged && updated.staged) setSelection({ path: selection.path, stage: 'index' });
      await loadDiff();
    }
  };

  const unstageFiles = async (paths: string[], label: string) => {
    if (paths.length === 0) return;
    const result = await runOperation(label, () => call('git.unstage', { repoPath, paths }), { success: paths.length === 1 ? 'Change unstaged' : `${paths.length} changes unstaged`, refresh: false });
    if (result) {
      applySnapshot(result);
      const updated = result.files.find((file) => file.path === selection?.path);
      if (selection && updated && updated.unstaged && !updated.staged) setSelection({ path: selection.path, stage: 'worktree' });
      await loadDiff();
    }
  };

  const discard = async () => {
    if (!discardTarget) return;
    const entry = discardTarget;
    const result = await runOperation('Discarding changes…', () =>
      call('git.discard', { repoPath, entries: [{ path: entry.path, staged: false, untracked: entry.untracked }], confirmation: 'discard' }), {
      success: `Discarded changes in ${entry.path}`, refresh: false,
    });
    setDiscardTarget(null);
    if (result) {
      applySnapshot(result);
      await loadDiff();
    }
  };

  const stageHunk = async (file: DiffResult['files'][number], hunkIndex: number, direction: 'stage' | 'unstage') => {
    const hunk = file.hunks[hunkIndex];
    if (!hunk || !file.patch) {
      toast('warning', 'This hunk cannot be applied separately', 'Untracked files and some binary changes must be staged as a whole file.');
      return;
    }
    const { buildHunkPatch } = await import('../../shared/diff');
    const patch = buildHunkPatch(file, [hunkIndex]);
    const result = await runOperation(direction === 'stage' ? 'Staging hunk…' : 'Unstaging hunk…', () =>
      call('git.applyPatch', { repoPath, patch, direction }), { refresh: false, success: direction === 'stage' ? 'Hunk staged' : 'Hunk unstaged' });
    if (result) {
      applySnapshot(result);
      await loadDiff();
    }
  };

  const explainDiff = async () => {
    if (!diff) return;
    setAiBusy(true);
    setAiOpen(true);
    setAiText(null);
    try {
      const response = await call('ai.explain', { repoPath, task: 'explain-diff', input: diff.text.slice(0, 24_000) });
      setAiText(response.text);
    } catch (error) {
      setAiText(`Could not get an explanation.\n\n${errorDetail(error) ?? errorMessage(error)}`);
    } finally {
      setAiBusy(false);
    }
  };

  if (!snapshot) {
    return <div className="workspace"><EmptyState icon={FileDiff} title="No repository open" description="Open a repository to inspect and stage its real working-tree changes." /></div>;
  }

  const aiReady = settings.ai.enabled && settings.ai.consent && settings.ai.hasKey;
  const hasAnyChanges = files.length > 0;

  return (
    <div className="workspace">
      <div className="workspace-header">
        <div className="workspace-heading">
          <h1>Changes <span className="tag">{plural(files.length, 'changed path')}</span></h1>
          <p>Stage exactly what you intend to commit. Diffs come straight from Git; nothing here is simulated.</p>
        </div>
        <div className="workspace-actions">
          {aiReady && diff ? <button className="btn" onClick={() => void explainDiff()}><Sparkles size={13} /> Explain diff</button> : null}
          {conflicted.length > 0 ? <button className="btn danger" onClick={() => setShowConflicts(true)}><ShieldAlert size={13} /> Resolve conflicts ({conflicted.length})</button> : null}
          <button className="btn" onClick={() => void refresh()}><RefreshCw size={13} /> Refresh</button>
          <button className="btn" onClick={() => { setWorkspace('preflight'); }}><ShieldCheck size={13} /> Preflight</button>
        </div>
      </div>
      <div className="workspace-body flush">
        {!hasAnyChanges ? (
          <EmptyState
            icon={CheckCheck}
            title="Working tree is clean"
            description="There are no staged, unstaged, untracked or conflicted files. Make a change in your editor and refresh, or explore the repository history."
            actions={<><button className="btn" onClick={() => void refresh()}><RefreshCw size={13} /> Refresh</button><button className="btn" onClick={() => setWorkspace('history')}>View history</button></>}
          />
        ) : (
          <div className="split-body" style={{ flexDirection: 'column' }}>
            {conflicted.length > 0 ? (
              <div className="banner danger" style={{ margin: '10px 12px 0' }}>
                <AlertTriangle size={15} />
                <span><strong>{conflicted.length} unresolved conflict{conflicted.length === 1 ? '' : 's'}.</strong> Git will not allow a commit until each file is explicitly marked resolved.</span>
                <div className="banner-actions">
                  <button className="btn sm" onClick={() => setShowConflicts((value) => !value)}>{showConflicts ? 'View diffs' : 'Open conflict workspace'}</button>
                </div>
              </div>
            ) : null}
            <div className="changes-layout" style={{ flex: 1, minHeight: 0 }}>
              <div className="changes-sidebar">
                <div className="file-groups">
                  {conflicted.length > 0 ? (
                    <FileGroup
                      title="Conflicts"
                      entries={conflicted}
                      side="worktree"
                      selection={selection}
                      onSelect={(entry) => { setSelection({ path: entry.path, stage: 'worktree' }); setShowConflicts(true); }}
                      actionLabel="Resolve"
                      onGroupAction={() => setShowConflicts(true)}
                    />
                  ) : null}
                  {staged.length > 0 ? (
                    <FileGroup
                      title="Staged"
                      entries={staged}
                      side="index"
                      selection={selection}
                      onSelect={(entry) => { setSelection({ path: entry.path, stage: 'index' }); setShowConflicts(false); }}
                      actionLabel="Unstage all"
                      onGroupAction={() => void unstageFiles(staged.map((file) => file.path), 'Unstaging all files…')}
                      rowAction={(entry) => <button className="file-action" title="Unstage file" onClick={(event) => { event.stopPropagation(); void unstageFiles([entry.path], 'Unstaging file…'); }}><Minus size={12} /></button>}
                    />
                  ) : null}
                  {unstaged.length > 0 ? (
                    <FileGroup
                      title="Unstaged"
                      entries={unstaged}
                      side="worktree"
                      selection={selection}
                      onSelect={(entry) => { setSelection({ path: entry.path, stage: 'worktree' }); setShowConflicts(false); }}
                      actionLabel="Stage all"
                      onGroupAction={() => void stageFiles(unstaged.map((file) => file.path), 'Staging all unstaged files…')}
                      rowAction={(entry) => (
                        <>
                          <button className="file-action" title="Stage file" onClick={(event) => { event.stopPropagation(); void stageFiles([entry.path], 'Staging file…'); }}><Plus size={12} /></button>
                          <button className="file-action" title="Discard working-tree changes" onClick={(event) => { event.stopPropagation(); setDiscardTarget(entry); }}><Undo2 size={12} /></button>
                        </>
                      )}
                    />
                  ) : null}
                  {untracked.length > 0 ? (
                    <FileGroup
                      title="Untracked"
                      entries={untracked}
                      side="worktree"
                      selection={selection}
                      onSelect={(entry) => { setSelection({ path: entry.path, stage: 'worktree' }); setShowConflicts(false); }}
                      actionLabel="Stage all"
                      onGroupAction={() => void stageFiles(untracked.map((file) => file.path), 'Staging untracked files…')}
                      rowAction={(entry) => (
                        <>
                          <button className="file-action" title="Stage file" onClick={(event) => { event.stopPropagation(); void stageFiles([entry.path], 'Staging file…'); }}><Plus size={12} /></button>
                          <button className="file-action" title="Delete untracked file (cannot be undone)" onClick={(event) => { event.stopPropagation(); setDiscardTarget(entry); }}><Trash2 size={12} /></button>
                        </>
                      )}
                    />
                  ) : null}
                </div>
                <CommitBox snapshot={snapshot} diff={selection?.stage === 'index' ? null : diff} onCommitted={() => { void reloadRepo(); void loadDiff(); }} blockedReason={blockedReason} />
              </div>
              <div className="changes-main">
                {showConflicts && conflicted.length > 0 ? (
                  <ConflictResolver snapshot={snapshot} onUpdated={() => { void reloadRepo(); }} />
                ) : selection ? (
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
                    onRefresh={() => void loadDiff()}
                    hunkDirection={selection.stage === 'index' ? 'unstage' : 'stage'}
                    onStageHunk={stageHunk}
                    emptyTitle="No diff for this entry"
                    emptyDescription={selection.stage === 'index' ? 'The index matches HEAD for this path, or the change is binary.' : 'The working tree matches the index for this path.'}
                    actions={
                      <>
                        <span className="tag">{selection.stage === 'index' ? 'staged diff' : 'working tree'}</span>
                        {selection.stage === 'index' ? (
                          <button className="btn sm" onClick={() => void unstageFiles([selection.path], 'Unstaging file…')}><Minus size={11} /> Unstage</button>
                        ) : (
                          <button className="btn sm" onClick={() => void stageFiles([selection.path], 'Staging file…')}><Plus size={11} /> Stage</button>
                        )}
                      </>
                    }
                  />
                ) : (
                  <EmptyState icon={ListFilter} title="Select a change" description="Choose a file on the left to inspect its real diff, stage it, discard it, or stage individual hunks." />
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {discardTarget ? (
        <ConfirmDialog
          title={discardTarget.untracked ? 'Delete this untracked file?' : 'Discard working-tree changes?'}
          description={<span>This affects <span className="inline-code">{discardTarget.path}</span>. Git++ will run a real restore or delete operation.</span>}
          confirmLabel={discardTarget.untracked ? 'Delete file' : 'Discard changes'}
          danger
          onClose={() => setDiscardTarget(null)}
          onConfirm={discard}
          consequences={discardTarget.untracked ? [
            'The untracked file will be deleted from disk.',
            'Git cannot restore files it has never tracked.',
            'This cannot be undone from Git++.',
          ] : [
            'Changes in the working tree for this file will be replaced with the staged version (or HEAD if nothing is staged).',
            'Only this file is affected.',
            'Staged changes are kept; use Unstage to remove them from the index.',
          ]}
        />
      ) : null}

      {aiOpen ? (
        <Modal title="AI diff explanation" description="Generated from the diff text below. Review it critically; AI can be wrong." onClose={() => setAiOpen(false)} width="wide"
          footer={<button className="btn" onClick={() => setAiOpen(false)}>Close</button>}>
          {aiBusy ? <div className="loading-state"><Spinner /> Asking {settings.ai.model}…</div> : <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{aiText}</div>}
          <div className="banner warn"><AlertTriangle size={14} /> The diff was sent to {settings.ai.baseUrl} because you asked for an explanation. No repository content is sent automatically.</div>
        </Modal>
      ) : null}
    </div>
  );
}

function repositoryDiffTarget(snapshot: RepoSnapshot | null, selection: Selection | null): boolean {
  if (!snapshot || !selection) return false;
  return snapshot.files.some((file) => file.path === selection.path);
}

function FileGroup({
  title, entries, side, selection, onSelect, actionLabel, onGroupAction, rowAction,
}: {
  title: string;
  entries: StatusEntry[];
  side: 'index' | 'worktree';
  selection: Selection | null;
  onSelect: (entry: StatusEntry) => void;
  actionLabel: string;
  onGroupAction: () => void;
  rowAction?: (entry: StatusEntry) => React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="file-group">
      <div className="file-group-header">
        <span>{title}</span>
        <span className="count">{entries.length}</span>
        <button className="group-action" onClick={onGroupAction}>{actionLabel}</button>
      </div>
      {entries.map((entry) => {
        const state = entryState(entry, side);
        const active = selection?.path === entry.path && selection.stage === side;
        return (
          <button key={`${entry.path}-${side}`} className={cx('file-row', active && 'selected')} onClick={() => onSelect(entry)} title={entry.origPath ? `${entry.origPath} → ${entry.path}` : entry.path}>
            <span className={cx('file-status', fileIconState(state))}>{fileIconState(state)}</span>
            <span className="file-name">{entry.path}</span>
            {entry.conflicted ? <span className="tag red">conflict</span> : null}
            {rowAction ? rowAction(entry) : null}
          </button>
        );
      })}
    </div>
  );
}
