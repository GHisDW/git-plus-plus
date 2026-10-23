import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, FileWarning, GitMerge, RotateCcw, Save, ShieldAlert, Undo2 } from 'lucide-react';
import type { ConflictFile, RepoSnapshot } from '../../shared/types';
import { call, errorDetail, errorMessage } from '../lib/api';
import { useApp } from '../state/AppState';
import { cx } from '../lib/utils';
import { ConfirmDialog, EmptyState, Spinner } from './ui';

const KIND_LABEL: Record<ConflictFile['kind'], string> = {
  'both-modified': 'Both sides modified',
  'both-added': 'Both sides added',
  'deleted-by-them': 'Deleted by them',
  'deleted-by-us': 'Deleted by us',
  'added-by-us': 'Added by us',
  'added-by-them': 'Added by them',
  'both-deleted': 'Deleted by both',
  unknown: 'Conflict',
};

export function ConflictResolver({ snapshot, onUpdated }: { snapshot: RepoSnapshot; onUpdated: () => void }): React.JSX.Element {
  const { runOperation, toast, refresh } = useApp();
  const repoPath = snapshot.info.path;
  const [conflicts, setConflicts] = useState<ConflictFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [abortOpen, setAbortOpen] = useState(false);
  const [continueOpen, setContinueOpen] = useState(false);

  const load = async (keepSelection = true) => {
    setLoading(true);
    try {
      const list = await call('git.conflicts', { repoPath });
      setConflicts(list);
      setSelectedPath((current) => (keepSelection && current && list.some((entry) => entry.path === current) ? current : list[0]?.path ?? null));
    } catch (error) {
      toast('error', 'Could not load conflicts', errorDetail(error) ?? errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath, snapshot.refreshedAt]);

  const current = conflicts.find((entry) => entry.path === selectedPath) ?? null;

  useEffect(() => {
    setDraft(current?.working ?? '');
  }, [current?.path, current?.working]);

  const markers = useMemo(() => (draft.match(/^(<{7}|={7}|>{7})/gm) ?? []).length, [draft]);
  const dirty = current ? draft !== (current.working ?? '') : false;

  const save = async (): Promise<boolean> => {
    if (!current) return false;
    setSaving(true);
    const result = await runOperation('Saving resolved file…', () => call('git.saveConflict', { repoPath, path: current.path, content: draft }), {
      success: `Saved ${current.path}`, refresh: false,
    });
    setSaving(false);
    if (result) {
      setConflicts(result);
      toast('info', 'Conflict markers are not resolved yet', 'Review the file, then choose “Mark resolved” to stage it with Git.');
      return true;
    }
    return false;
  };

  const markResolved = async () => {
    if (!current) return;
    if (dirty && markers > 0) {
      toast('warning', 'Save or remove the conflict markers first', 'The working file still contains markers.');
      return;
    }
    if (dirty) {
      const saved = await save();
      if (!saved) return;
    }
    const result = await runOperation('Marking file resolved…', () => call('git.markResolved', { repoPath, path: current.path }), {
      success: `${current.path} staged as resolved`,
      refresh: false,
    });
    if (result) {
      await load();
      onUpdated();
    }
  };

  const continueOperation = async () => {
    if (!snapshot.operation.kind) return;
    const result = await runOperation(`Continuing ${snapshot.operation.kind}…`, () =>
      call('git.continueOperation', { repoPath, kind: snapshot.operation.kind as 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'am' }), {
      success: `${snapshot.operation.kind} continued`,
    });
    setContinueOpen(false);
    if (result) {
      onUpdated();
      await refresh();
    }
  };

  const abort = async () => {
    const result = await runOperation('Aborting operation…', () => call('git.abortOperation', { repoPath, confirmation: 'abort' }), {
      success: 'Operation aborted. Your pre-operation state was restored by Git.',
      refresh: false,
    });
    setAbortOpen(false);
    if (result) onUpdated();
  };

  return (
    <div className="split-body" style={{ flexDirection: 'column' }}>
      <div className="banner danger" style={{ margin: 12 }}>
        <ShieldAlert size={16} />
        <div>
          <strong>{snapshot.operation.description ?? 'Git operation in progress'}</strong>
          <div className="small">
            {conflicts.length} conflicted file{conflicts.length === 1 ? '' : 's'}. Files become resolved only when you explicitly mark them resolved; opening a file never changes Git state.
          </div>
        </div>
        <div className="banner-actions">
          <button className="btn sm" onClick={() => void load()}><RotateCcw size={11} /> Reload</button>
          <button className="btn sm" disabled={conflicts.length > 0 || !snapshot.operation.kind} onClick={() => setContinueOpen(true)} title={conflicts.length > 0 ? 'Resolve every conflict first' : 'Continue the operation'}>
            <Check size={11} /> Continue
          </button>
          <button className="btn sm danger" onClick={() => setAbortOpen(true)}><Undo2 size={11} /> Abort</button>
        </div>
      </div>

      {loading ? <div className="loading-state"><Spinner /> Loading conflicts…</div> : null}
      {!loading && conflicts.length === 0 ? (
        <EmptyState icon={GitMerge} title="No unresolved conflicts" description="Git reports a clean index. If an operation is still in progress, use Continue above (when Git allows it) or Abort." />
      ) : null}

      {!loading && conflicts.length > 0 ? (
        <div className="changes-layout" style={{ flex: 1, minHeight: 0 }}>
          <div className="changes-sidebar" style={{ minWidth: 0 }}>
            <div className="file-groups" style={{ flex: 1 }}>
              <div className="file-group">
                <div className="file-group-header">Unresolved <span className="count">{conflicts.length}</span></div>
                {conflicts.map((conflict) => (
                  <button key={conflict.path} className={cx('file-row', selectedPath === conflict.path && 'selected')} onClick={() => setSelectedPath(conflict.path)}>
                    <span className="file-status U">U</span>
                    <span className="file-name" title={conflict.path}>{conflict.path}</span>
                    <span className="tag red">conflict</span>
                  </button>
                ))}
              </div>
              <div className="small muted" style={{ padding: '4px 8px' }}>
                {snapshot.operation.kind ? `Operation: ${snapshot.operation.kind}` : 'No operation detected'}
              </div>
            </div>
          </div>
          <div className="changes-main">
            {current ? (
              <>
                <div className="diff-toolbar">
                  <span className="diff-file-name">{current.path}</span>
                  <span className="tag amber">{KIND_LABEL[current.kind]}</span>
                  <div className="spacer" />
                  {markers > 0 ? <span className="tag red"><AlertTriangle size={10} />{markers} markers</span> : <span className="tag green"><Check size={10} />no markers</span>}
                  <button className="btn sm" onClick={() => void load()}><RotateCcw size={11} /> Reload</button>
                  <button className="btn sm" onClick={() => void save()} disabled={saving || !dirty} title="Save the working file without marking it resolved">
                    {saving ? <Spinner /> : <Save size={11} />} Save file
                  </button>
                  <button className="btn sm primary" onClick={() => void markResolved()}><Check size={11} /> Mark resolved</button>
                </div>
                <div className="conflict-editor" style={{ maxHeight: '45%' }}>
                  <ConflictPane title="Base (common ancestor)" content={current.base} onUse={null} />
                  <ConflictPane title="Current (ours)" content={current.ours} onUse={() => setDraft(current.ours ?? '')} tone="var(--accent)" />
                  <ConflictPane title="Incoming (theirs)" content={current.theirs} onUse={() => setDraft(current.theirs ?? '')} tone="var(--purple)" />
                </div>
                <div className="conflict-result">
                  <div className="diff-toolbar" style={{ borderTop: 'none' }}>
                    <span className="small"><strong>Result</strong> <span className="muted">— edit the working file, then save</span></span>
                    <div className="spacer" />
                    {current.binary ? <span className="tag red">binary — choose a side above, save, then mark resolved</span> : null}
                    {dirty ? <span className="tag amber">unsaved</span> : <span className="tag">saved</span>}
                  </div>
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    spellCheck={false}
                    aria-label="Resolved file content"
                    placeholder={current.binary ? 'Binary file. Use one side above, then mark resolved if appropriate.' : ''}
                  />
                </div>
              </>
            ) : <EmptyState icon={FileWarning} title="Select a conflicted file" description="Choose a file on the left to inspect the base, current and incoming versions." />}
          </div>
        </div>
      ) : null}

      {abortOpen ? (
        <ConfirmDialog
          title="Abort the in-progress operation?"
          description={<span>Git will attempt to restore the state from before the operation. This discards the conflict resolution work in progress.</span>}
          confirmLabel="Abort operation"
          danger
          onClose={() => setAbortOpen(false)}
          onConfirm={abort}
          consequences={[
            'Conflicted working-tree edits made during the operation will be discarded.',
            `Git runs ${snapshot.operation.kind ?? 'operation'} --abort.`,
            'The abort can fail if conflicting local changes were made outside the operation; Git++ will report the real error.',
          ]}
        />
      ) : null}

      {continueOpen ? (
        <ConfirmDialog
          title={`Continue ${snapshot.operation.kind ?? 'operation'}?`}
          description={<span>All conflicts are staged. Continue only if the resolved result is what you want to record.</span>}
          confirmLabel="Continue"
          onClose={() => setContinueOpen(false)}
          onConfirm={continueOperation}
          consequences={[
            snapshot.operation.kind === 'rebase' ? 'Git will replay the remaining commits and may stop again on further conflicts.' : 'Git will create or complete the commit for this operation.',
            'Git++ verifies that no unresolved paths remain before asking Git to continue.',
          ]}
        />
      ) : null}
    </div>
  );
}

function ConflictPane({ title, content, onUse, tone }: { title: string; content: string | null; onUse: (() => void) | null; tone?: string }): React.JSX.Element {
  return (
    <div className="conflict-pane">
      <header>
        <span style={tone ? { color: tone } : undefined}>{title}</span>
        <div className="spacer" />
        {onUse ? <button className="btn sm" onClick={onUse}>Use this</button> : null}
      </header>
      <pre>{content ?? '(not present in this conflict)'}</pre>
    </div>
  );
}
