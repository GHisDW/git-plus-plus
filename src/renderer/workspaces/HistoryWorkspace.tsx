import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownUp, Calendar, ChevronDown, Cherry, GitCommitHorizontal, GitCompare,
  GitMerge, History, RotateCcw, Search, Sparkles, Tag, User, FileText, Loader2,
} from 'lucide-react';
import type { BranchComparison, BranchInfo, CommitDetails, FileHistoryEntry, LogResult, TextFile } from '../../shared/types';
import { call, errorDetail, errorMessage } from '../lib/api';
import { useApp } from '../state/AppState';
import { cx, copyToClipboard } from '../lib/utils';
import { formatDateTime, relativeTime } from '../../shared/format';
import { CommitGraph } from '../components/CommitGraph';
import { DiffViewer } from '../components/DiffViewer';
import { ConfirmDialog, CopyButton, EmptyState, Field, LoadingState, Modal, Spinner } from '../components/ui';

type CommitAction = 'merge' | 'rebase' | 'cherry-pick' | 'revert';

export function HistoryWorkspace(): React.JSX.Element {
  const { snapshot, settings, updateSettings, runOperation, toast, setWorkspace } = useApp();
  const repoPath = snapshot?.info.path ?? '';
  const [log, setLog] = useState<LogResult | null>(null);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [refFilter, setRefFilter] = useState('');
  const [limit, setLimit] = useState(150);
  const [selected, setSelected] = useState<string | null>(null);
  const [details, setDetails] = useState<CommitDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffFile, setDiffFile] = useState<string | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareBase, setCompareBase] = useState('');
  const [compareHead, setCompareHead] = useState('');
  const [comparison, setComparison] = useState<BranchComparison | null>(null);
  const [compareBusy, setCompareBusy] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [tagName, setTagName] = useState('');
  const [tagMessage, setTagMessage] = useState('');
  const [action, setAction] = useState<CommitAction | null>(null);
  const [fileHistory, setFileHistory] = useState<{ path: string; entries: FileHistoryEntry[] } | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [version, setVersion] = useState<TextFile | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 320);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!repoPath) return;
    void call('git.branches', { repoPath }).then(setBranches).catch(() => setBranches([]));
  }, [repoPath, snapshot?.refreshedAt]);

  const loadLog = useCallback(async () => {
    if (!repoPath) return;
    setLoading(true);
    try {
      const result = await call('git.log', {
        repoPath,
        limit,
        all: refFilter === '',
        ...(refFilter ? { ref: refFilter } : {}),
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
      });
      setLog(result);
      setSelected((current) => (current && result.commits.some((commit) => commit.sha === current) ? current : result.commits[0]?.sha ?? null));
    } catch (error) {
      toast('error', 'Could not load history', errorDetail(error) ?? errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [repoPath, limit, refFilter, debouncedSearch, toast]);

  useEffect(() => { void loadLog(); }, [loadLog, snapshot?.refreshedAt]);

  const loadCommit = useCallback(async (sha: string) => {
    if (!repoPath) return;
    setDetailsLoading(true);
    try {
      setDetails(await call('git.commitDetails', { repoPath, sha }));
    } catch (error) {
      toast('error', 'Could not load commit', errorDetail(error) ?? errorMessage(error));
      setDetails(null);
    } finally {
      setDetailsLoading(false);
    }
  }, [repoPath, toast]);

  useEffect(() => {
    if (!selected) { setDetails(null); return; }
    void loadCommit(selected);
  }, [selected, loadCommit]);

  const current = useMemo(() => log?.commits.find((commit) => commit.sha === selected) ?? null, [log, selected]);
  const aiReady = settings.ai.enabled && settings.ai.consent && settings.ai.hasKey;

  const executeAction = async () => {
    if (!action || !current || !snapshot) return;
    const sha = current.sha;
    const labels: Record<CommitAction, string> = {
      merge: `Merging ${current.shortSha}…`,
      rebase: `Rebasing onto ${current.shortSha}…`,
      'cherry-pick': `Cherry-picking ${current.shortSha}…`,
      revert: `Reverting ${current.shortSha}…`,
    };
    const calls: Record<CommitAction, () => Promise<unknown>> = {
      merge: () => call('git.merge', { repoPath, ref: sha }),
      rebase: () => call('git.rebase', { repoPath, onto: sha }),
      'cherry-pick': () => call('git.cherryPick', { repoPath, sha }),
      revert: () => call('git.revert', { repoPath, sha }),
    };
    const kind = action;
    setAction(null);
    const result = await runOperation<unknown>(labels[kind], calls[kind]);
    if (result) {
      await loadLog();
      if (typeof result === 'object' && result && 'conflicts' in result && Array.isArray((result as { conflicts: string[] }).conflicts) && (result as { conflicts: string[] }).conflicts.length > 0) {
        toast('warning', 'Conflicts detected', 'The operation needs your attention. Open Changes to resolve each conflicted file.');
        setWorkspace('changes');
      }
    }
  };

  const createTag = async () => {
    if (!current || !tagName.trim()) return;
    const result = await runOperation('Creating tag…', () => call('git.createTag', {
      repoPath,
      name: tagName.trim(),
      target: current.sha,
      ...(tagMessage.trim() ? { message: tagMessage.trim() } : {}),
    }), { success: `Tag ${tagName.trim()} created` });
    if (result) {
      setTagOpen(false);
      setTagName('');
      setTagMessage('');
      await loadLog();
    }
  };

  const compare = async () => {
    if (!compareBase.trim() || !compareHead.trim()) return;
    setCompareBusy(true);
    try {
      setComparison(await call('git.compareBranches', { repoPath, base: compareBase.trim(), head: compareHead.trim() }));
    } catch (error) {
      toast('error', 'Comparison failed', errorDetail(error) ?? errorMessage(error));
      setComparison(null);
    } finally {
      setCompareBusy(false);
    }
  };

  const openFileHistory = async (path: string) => {
    setHistoryBusy(true);
    setFileHistory({ path, entries: [] });
    try {
      const entries = await call('git.fileHistory', { repoPath, path, limit: 60 });
      setFileHistory({ path, entries });
    } catch (error) {
      toast('error', 'Could not load file history', errorDetail(error) ?? errorMessage(error));
      setFileHistory(null);
    } finally {
      setHistoryBusy(false);
    }
  };

  const openVersion = async (path: string, rev: string) => {
    try {
      setVersion(await call('git.showFile', { repoPath, rev, path }));
    } catch (error) {
      toast('error', 'Could not read file version', errorDetail(error) ?? errorMessage(error));
    }
  };

  const summarize = async () => {
    if (!details) return;
    setAiOpen(true);
    setAiBusy(true);
    setAiText(null);
    try {
      const response = await call('ai.explain', { repoPath, task: 'summarize-commit', input: `${details.commit.subject}\n\n${details.diff.text}`.slice(0, 24_000) });
      setAiText(response.text);
    } catch (error) {
      setAiText(`Could not summarize this commit.\n\n${errorDetail(error) ?? errorMessage(error)}`);
    } finally {
      setAiBusy(false);
    }
  };

  if (!snapshot) {
    return <div className="workspace"><EmptyState icon={History} title="No repository open" description="Open a repository to explore its real commit graph, file history and comparisons." /></div>;
  }

  return (
    <div className="workspace">
      <div className="workspace-header">
        <div className="workspace-heading">
          <h1>History <span className="tag">{log?.commits.length ?? 0} shown</span></h1>
          <p>{refFilter ? `History of ${refFilter}` : 'All local and remote branches'} · parents and merges come from Git</p>
        </div>
        <div className="workspace-actions">
          <button className="btn" onClick={() => { setCompareBase(current?.sha ?? 'HEAD'); setCompareHead(snapshot.info.head.branch ?? 'HEAD'); setCompareOpen(true); setComparison(null); }}><GitCompare size={13} /> Compare</button>
          <button className="btn ghost icon" onClick={() => void loadLog()} title="Reload history"><RotateCcw size={13} /></button>
        </div>
      </div>
      <div className="workspace-body flush">
        <div className="history-layout">
          <div className="history-list">
            <div className="history-toolbar">
              <div className="row" style={{ flex: 1, minWidth: 200 }}>
                <Search size={13} style={{ color: 'var(--text-muted)' }} />
                <input className="input" style={{ border: 'none', background: 'transparent', padding: '4px 0' }} placeholder="Search commit messages…" value={search} onChange={(event) => setSearch(event.target.value)} />
              </div>
              <select className="input" style={{ width: 'auto' }} value={refFilter} onChange={(event) => setRefFilter(event.target.value)} aria-label="Branch filter">
                <option value="">All branches</option>
                <option value="HEAD">Current branch (HEAD)</option>
                {branches.filter((branch) => !branch.isRemote).map((branch) => <option key={branch.fullName} value={branch.name}>{branch.name}</option>)}
                {branches.filter((branch) => branch.isRemote).slice(0, 20).map((branch) => <option key={branch.fullName} value={branch.name}>{branch.name}</option>)}
              </select>
              {debouncedSearch ? <span className="tag accent">grep: {debouncedSearch}</span> : null}
            </div>
            {loading ? <LoadingState label="Reading commit history…" /> : null}
            {!loading && (log?.commits.length ?? 0) === 0 ? (
              <EmptyState icon={History} title={debouncedSearch ? 'No matching commits' : 'No commits yet'} description={debouncedSearch ? 'Try a different message search, or switch the branch filter.' : 'Create the first commit from the Changes workspace.'} />
            ) : null}
            {!loading && log && log.commits.length > 0 ? (
              <>
                <CommitGraph commits={log.commits} selected={selected} onSelect={(commit) => setSelected(commit.sha)} />
                {log.hasMore ? (
                  <div style={{ padding: 12, textAlign: 'center' }}>
                    <button className="btn" onClick={() => setLimit((value) => value + 150)}><ChevronDown size={13} /> Load more commits</button>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>

          <div className="history-detail">
            {detailsLoading ? <div className="loading-state"><Spinner /> Loading commit…</div> : null}
            {!detailsLoading && !current ? <EmptyState icon={GitCommitHorizontal} title="Select a commit" description="Choose a commit in the graph to inspect its message, parents and changed files." /> : null}
            {!detailsLoading && current && details ? (
              <div className="history-detail-scroll">
                <div className="row" style={{ gap: 8 }}>
                  <span className="tag accent"><GitCommitHorizontal size={10} />{current.shortSha}</span>
                  <CopyButton value={current.sha} label="Copy full hash" />
                  {current.refs.map((ref) => <span key={ref} className={cx('tag', ref.includes('HEAD') ? 'green' : ref.startsWith('tag:') ? 'amber' : 'purple')}>{ref}</span>)}
                </div>
                <h3>{current.subject || '(no commit message)'}</h3>
                {details.commit.body ? <pre className="mono-block" style={{ margin: 0 }}>{details.commit.body}</pre> : null}
                <dl className="commit-meta-grid">
                  <dt><User size={10} /> author</dt><dd>{current.author} &lt;{current.authorEmail}&gt;</dd>
                  <dt><Calendar size={10} /> date</dt><dd>{formatDateTime(current.date)} · {relativeTime(current.date)}</dd>
                  <dt>parents</dt><dd>{current.parents.length === 0 ? 'root commit' : current.parents.map((sha) => sha.slice(0, 10)).join(', ')}</dd>
                  <dt>files</dt><dd>{details.files.length} changed</dd>
                </dl>

                <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
                  <button className="btn sm" onClick={() => { setDiffFile(null); setDiffOpen(true); }}><FileText size={11} /> Full diff</button>
                  <button className="btn sm" onClick={() => setTagOpen(true)}><Tag size={11} /> Tag</button>
                  <button className="btn sm" onClick={() => setAction('cherry-pick')}><Cherry size={11} /> Cherry-pick</button>
                  <button className="btn sm" onClick={() => setAction('revert')}><RotateCcw size={11} /> Revert</button>
                  <button className="btn sm" onClick={() => setAction('merge')}><GitMerge size={11} /> Merge into current</button>
                  <button className="btn sm" onClick={() => setAction('rebase')}><ArrowDownUp size={11} /> Rebase onto</button>
                  {aiReady ? <button className="btn sm" onClick={() => void summarize()}><Sparkles size={11} /> Summarize</button> : null}
                </div>

                <div>
                  <div className="section-title">Changed files <span className="muted" style={{ textTransform: 'none', letterSpacing: 0 }}>({details.files.length})</span></div>
                  <div className="panel">
                    <div className="panel-body" style={{ padding: 4 }}>
                      {details.files.length === 0 ? <div className="small muted" style={{ padding: 8 }}>Git reports no file changes (this can happen for merge commits).</div> : null}
                      {details.files.map((file) => (
                        <div key={`${file.path}-${file.status}`} className="file-summary-row">
                          <span className={cx('file-status', file.status === 'added' ? 'A' : file.status === 'deleted' ? 'D' : 'M')}>{file.status === 'added' ? 'A' : file.status === 'deleted' ? 'D' : 'M'}</span>
                          <button className="path" style={{ textAlign: 'left' }} onClick={() => { setDiffFile(file.path); setDiffOpen(true); }}>{file.path}</button>
                          <span className="small" style={{ color: 'var(--green)' }}>+{file.additions}</span>
                          <span className="small" style={{ color: 'var(--red)' }}>−{file.deletions}</span>
                          <button className="btn ghost icon" title="File history" onClick={() => void openFileHistory(file.path)}><History size={11} /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="small dim">Only Git metadata is shown. Git++ does not infer why a commit was made.</div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {diffOpen && details ? (
        <Modal title={`Changes in ${details.commit.shortSha}`} description={details.commit.subject} onClose={() => setDiffOpen(false)} width="wide" footer={<button className="btn" onClick={() => setDiffOpen(false)}>Close</button>}>
          <div style={{ height: '60vh', display: 'flex' }}>
            <DiffViewer
              diff={details.diff}
              mode={settings.diff.mode}
              wrap={settings.diff.wrap}
              ignoreWhitespace={settings.diff.ignoreWhitespace}
              onModeChange={(mode) => void updateSettings({ diff: { mode } })}
              onWrapChange={(wrap) => void updateSettings({ diff: { wrap } })}
              onIgnoreWhitespaceChange={(ignoreWhitespace) => void updateSettings({ diff: { ignoreWhitespace } })}
              initialFile={diffFile}
              hunkDirection={null}
              emptyTitle="No textual changes"
              emptyDescription="The commit only changed binary files or modes."
            />
          </div>
        </Modal>
      ) : null}

      {compareOpen ? (
        <Modal title="Compare references" description="Uses `git rev-list` and `git diff` on real repository data." onClose={() => setCompareOpen(false)} width="wide" footer={<><button className="btn ghost" onClick={() => setCompareOpen(false)}>Close</button><button className="btn primary" onClick={() => void compare()} disabled={compareBusy}>{compareBusy ? <Spinner /> : null} Compare</button></>}>
          <div className="grid-2">
            <Field label="Base" help="The older / comparison point. Accepts a branch, tag or commit hash."><input className="input" value={compareBase} onChange={(event) => setCompareBase(event.target.value)} spellCheck={false} /></Field>
            <Field label="Head" help="The newer side. Accepts a branch, tag or commit hash."><input className="input" value={compareHead} onChange={(event) => setCompareHead(event.target.value)} spellCheck={false} /></Field>
          </div>
          {comparison ? (
            <div className="stack" style={{ gap: 10 }}>
              <div className="row" style={{ gap: 8 }}>
                <span className="tag green">{comparison.ahead} ahead</span>
                <span className="tag amber">{comparison.behind} behind</span>
                <span className="tag">{comparison.files.length} changed files</span>
              </div>
              <div className="panel" style={{ maxHeight: 220, overflow: 'auto' }}>
                {comparison.commits.map((commit) => (
                  <div className="row" key={commit.sha} style={{ padding: '5px 10px', borderBottom: '1px solid var(--border)', gap: 8 }}>
                    <span className="mono small" style={{ color: 'var(--accent)' }}>{commit.shortSha}</span>
                    <span className="small truncate" style={{ flex: 1 }}>{commit.subject}</span>
                  </div>
                ))}
                {comparison.commits.length === 0 ? <div className="small muted" style={{ padding: 10 }}>No commits in {comparison.head} that are not already in {comparison.base}.</div> : null}
              </div>
              <div className="small muted">Changed paths: {comparison.files.slice(0, 40).map((file) => file.path).join(', ')}{comparison.files.length > 40 ? '…' : ''}</div>
            </div>
          ) : null}
        </Modal>
      ) : null}

      {tagOpen && current ? (
        <Modal title={`Tag commit ${current.shortSha}`} onClose={() => setTagOpen(false)} width="narrow" footer={<><button className="btn ghost" onClick={() => setTagOpen(false)}>Cancel</button><button className="btn primary" disabled={!tagName.trim()} onClick={() => void createTag()}>Create tag</button></>}>
          <Field label="Tag name" help="A lightweight tag is created unless you provide a message (then Git creates an annotated tag)."><input className="input" value={tagName} onChange={(event) => setTagName(event.target.value)} placeholder="v1.2.0" spellCheck={false} /></Field>
          <Field label="Annotation (optional)"><textarea className="textarea" value={tagMessage} onChange={(event) => setTagMessage(event.target.value)} rows={3} /></Field>
          <div className="banner info">Tags are local until you push them explicitly. Git++ will not push a tag automatically.</div>
        </Modal>
      ) : null}

      {action && current ? (
        <ConfirmDialog
          title={`${action === 'merge' ? 'Merge' : action === 'rebase' ? 'Rebase onto' : action === 'cherry-pick' ? 'Cherry-pick' : 'Revert'} ${current.shortSha}?`}
          description={<span>{action === 'merge' ? `Merge ${current.shortSha} into ${snapshot.info.head.branch ?? 'the current HEAD'}.` : action === 'rebase' ? `Rebase ${snapshot.info.head.branch ?? 'the current branch'} onto ${current.shortSha}.` : action === 'cherry-pick' ? `Apply the changes introduced by ${current.shortSha} as a new commit on ${snapshot.info.head.branch ?? 'HEAD'}.` : `Create a new commit that undoes the changes introduced by ${current.shortSha}.`}</span>}
          confirmLabel={action === 'merge' ? 'Merge' : action === 'rebase' ? 'Rebase' : action === 'cherry-pick' ? 'Cherry-pick' : 'Revert'}
          danger={action === 'rebase'}
          onClose={() => setAction(null)}
          onConfirm={executeAction}
          consequences={action === 'rebase' ? [
            `Commits on ${snapshot.info.head.branch ?? 'the current branch'} that are not in ${current.shortSha} will be replayed, creating new commit hashes.`,
            'Local history is rewritten for this branch.',
            'Conflicts may stop the rebase; Git++ will show the real state and never auto-resolve.',
          ] : action === 'merge' ? [
            `A merge commit may be created on ${snapshot.info.head.branch ?? 'HEAD'}.`,
            'Uncommitted changes may block the merge; Git will report them.',
            'Your existing commits are not rewritten.',
          ] : action === 'cherry-pick' ? [
            'The commit is copied as a new commit; the original commit is unchanged.',
            'Conflicts may require resolution before the operation completes.',
          ] : [
            'A new revert commit is created; existing history is preserved.',
            'Reverting a merge commit may require choosing a mainline, which Git++ does not attempt automatically.',
          ]}
        />
      ) : null}

      {fileHistory ? (
        <Modal title={`File history · ${fileHistory.path}`} description="`git log --follow` for this path." onClose={() => setFileHistory(null)} width="wide" footer={<button className="btn" onClick={() => setFileHistory(null)}>Close</button>}>
          {historyBusy ? <div className="loading-state"><Spinner /> Reading file history…</div> : null}
          {!historyBusy && fileHistory.entries.length === 0 ? <div className="small muted">No history found for this file. It may be new or untracked.</div> : null}
          {fileHistory.entries.map((entry) => (
            <div className="row" key={`${entry.sha}-${entry.changeType}`} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
              <span className="tag">{entry.changeType}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="small truncate">{entry.subject}</div>
                <div className="small dim">{entry.shortSha} · {entry.author} · {relativeTime(entry.date)}</div>
              </div>
              <button className="btn sm" onClick={() => { setDetails(null); setSelected(entry.sha); setFileHistory(null); }}>Inspect</button>
              <button className="btn sm" onClick={() => void openVersion(fileHistory.path, entry.sha)}>View file</button>
            </div>
          ))}
        </Modal>
      ) : null}

      {version ? (
        <Modal title={`${version.path} at revision`} onClose={() => setVersion(null)} width="wide" footer={<button className="btn" onClick={() => setVersion(null)}>Close</button>}>
          <div className="small muted">Read-only historical version fetched with <span className="inline-code">git show</span>. {version.truncated ? 'Truncated.' : ''}</div>
          <pre className="mono-block" style={{ maxHeight: '50vh' }}>{version.content}</pre>
          <div><CopyButton value={version.content} label="Copy file contents" /><button className="btn sm" onClick={async () => { if (await copyToClipboard(version.content)) toast('success', 'Copied file contents'); }}>Copy</button></div>
        </Modal>
      ) : null}

      {aiOpen ? (
        <Modal title="AI commit summary" description="Generated from the commit message and diff you explicitly sent." onClose={() => setAiOpen(false)} width="wide" footer={<button className="btn" onClick={() => setAiOpen(false)}>Close</button>}>
          {aiBusy ? <div className="loading-state"><Loader2 size={14} className="spinner" /> Asking {settings.ai.model}…</div> : <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{aiText}</div>}
          <div className="banner warn">Review before using in release notes. AI output is not written to the repository automatically.</div>
        </Modal>
      ) : null}
    </div>
  );
}

