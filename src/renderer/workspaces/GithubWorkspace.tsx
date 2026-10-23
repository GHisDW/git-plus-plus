import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, ArrowUpRight, Check, CircleDot, CloudUpload, ExternalLink, GitPullRequest, Github, Info,
  ListChecks, Loader2, Lock, MessageSquare, Plus, RefreshCw, Rocket, ShieldAlert, Tag, Trash2, User, Workflow,
} from 'lucide-react';
import type {
  GitHubRepoRef, GithubRelease, GithubStatus, IssueSummary, PullRequestSummary, WorkflowRun,
} from '../../shared/types';
import { call, errorDetail, errorMessage } from '../lib/api';
import { useApp } from '../state/AppState';
import { cx } from '../lib/utils';
import { relativeTime } from '../../shared/format';
import { ConfirmDialog, EmptyState, Field, Modal, Spinner } from '../components/ui';

type Tab = 'pulls' | 'issues' | 'releases' | 'workflows';

export function GithubWorkspace(): React.JSX.Element {
  const { snapshot, settings, toast } = useApp();
  const repoPath = snapshot?.info.path ?? '';
  const [status, setStatus] = useState<GithubStatus | null>(null);
  const [repo, setRepo] = useState<GitHubRepoRef | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('pulls');
  const [pulls, setPulls] = useState<PullRequestSummary[]>([]);
  const [issues, setIssues] = useState<IssueSummary[]>([]);
  const [releases, setReleases] = useState<GithubRelease[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowRun[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [token, setToken] = useState('');
  const [savingToken, setSavingToken] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [prOpen, setPrOpen] = useState(false);
  const [prTitle, setPrTitle] = useState('');
  const [prBody, setPrBody] = useState('');
  const [prBase, setPrBase] = useState('main');
  const [prHead, setPrHead] = useState('');
  const [prDraft, setPrDraft] = useState(false);
  const [prPush, setPrPush] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueTitle, setIssueTitle] = useState('');
  const [issueBody, setIssueBody] = useState('');
  const [creating, setCreating] = useState(false);
  const [selectedPull, setSelectedPull] = useState<PullRequestSummary | null>(null);

  const loadStatus = useCallback(async () => {
    if (!repoPath) return;
    setLoading(true);
    try {
      const next = await call('github.status', { repoPath });
      setStatus(next);
      if (next.authenticated) {
        try { setRepo(await call('github.repo', { repoPath })); } catch { setRepo(null); }
      }
    } catch (error) {
      setStatus({ configured: false, authenticated: false, login: null, name: null, avatarUrl: null, scopes: [], repository: null, error: errorMessage(error), rateLimitRemaining: null, rateLimitReset: null });
    } finally {
      setLoading(false);
    }
  }, [repoPath]);

  useEffect(() => { void loadStatus(); }, [loadStatus, snapshot?.refreshedAt]);

  const loadTab = useCallback(async (which: Tab) => {
    if (!repoPath || !status?.authenticated) return;
    setDataLoading(true);
    setDataError(null);
    try {
      if (which === 'pulls') setPulls(await call('github.pulls', { repoPath }));
      else if (which === 'issues') setIssues(await call('github.issues', { repoPath }));
      else if (which === 'releases') setReleases(await call('github.releases', { repoPath }));
      else setWorkflows(await call('github.workflows', { repoPath }));
    } catch (error) {
      setDataError(errorDetail(error) ?? errorMessage(error));
    } finally {
      setDataLoading(false);
    }
  }, [repoPath, status?.authenticated]);

  useEffect(() => { void loadTab(tab); }, [tab, loadTab]);

  const connect = async () => {
    if (!token.trim()) return;
    setSavingToken(true);
    try {
      await call('settings.setGithubToken', { token: token.trim() });
      setToken('');
      setTokenOpen(false);
      const next = await call('settings.get', {});
      void next;
      await loadStatus();
      toast('success', 'GitHub token stored', 'It is encrypted with your operating system credential storage.');
    } catch (error) {
      toast('error', 'Could not store the token', errorDetail(error) ?? errorMessage(error));
    } finally {
      setSavingToken(false);
    }
  };

  const disconnect = async () => {
    try {
      await call('settings.clearGithubToken', {});
      setDisconnectOpen(false);
      setStatus(null);
      setRepo(null);
      setPulls([]); setIssues([]); setReleases([]); setWorkflows([]);
      await loadStatus();
      toast('info', 'GitHub disconnected', 'The token was deleted from credential storage.');
    } catch (error) {
      toast('error', 'Could not remove the token', errorMessage(error));
    }
  };

  const createPull = async () => {
    if (!prTitle.trim() || !prHead.trim() || !prBase.trim()) return;
    setCreating(true);
    try {
      const result = await call('github.createPr', {
        repoPath,
        title: prTitle.trim(),
        body: prBody,
        head: prHead.trim(),
        base: prBase.trim(),
        draft: prDraft,
        pushFirst: prPush,
      });
      setPrOpen(false);
      setPrTitle(''); setPrBody(''); setPrDraft(false); setPrPush(false);
      toast('success', `Pull request #${result.number} created`, result.url);
      await loadTab('pulls');
    } catch (error) {
      toast('error', 'Could not create the pull request', errorDetail(error) ?? errorMessage(error));
    } finally {
      setCreating(false);
    }
  };

  const createIssue = async () => {
    if (!issueTitle.trim()) return;
    setCreating(true);
    try {
      const result = await call('github.createIssue', { repoPath, title: issueTitle.trim(), body: issueBody });
      setIssueOpen(false);
      setIssueTitle(''); setIssueBody('');
      toast('success', `Issue #${result.number} created`, result.url);
      await loadTab('issues');
    } catch (error) {
      toast('error', 'Could not create the issue', errorDetail(error) ?? errorMessage(error));
    } finally {
      setCreating(false);
    }
  };

  if (!snapshot) {
    return <div className="workspace"><EmptyState icon={Github} title="No repository open" description="Open a repository to connect its GitHub project." /></div>;
  }

  const authenticated = status?.authenticated ?? false;

  return (
    <div className="workspace">
      <div className="workspace-header">
        <div className="workspace-heading">
          <h1>GitHub {status?.repository ? <span className="tag">{status.repository.owner}/{status.repository.name}</span> : null}</h1>
          <p>Optional integration. Local Git keeps working without it. Data is fetched live from the GitHub API.</p>
        </div>
        <div className="workspace-actions">
          <button className="btn" onClick={() => void loadStatus()}><RefreshCw size={13} /> Refresh</button>
          {authenticated ? <>
            <button className="btn" onClick={() => { setPrHead(snapshot.info.head.branch ?? ''); setPrBase(repo?.defaultBranch ?? 'main'); setPrOpen(true); }}><GitPullRequest size={13} /> New pull request</button>
            <button className="btn" onClick={() => { setIssueOpen(true); }}><Plus size={13} /> New issue</button>
          </> : <button className="btn primary" onClick={() => setTokenOpen(true)}><Github size={13} /> Connect GitHub</button>}
        </div>
      </div>
      <div className="workspace-body">
        {loading ? <div className="loading-state"><Spinner /> Contacting GitHub…</div> : null}

        {!loading && !status?.configured ? (
          <div className="hero" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(280px, 1fr)' }}>
            <div className="hero-main">
              <span className="hero-eyebrow">Optional integration</span>
              <h2>Connect GitHub when you need it</h2>
              <p>Git++ can list and create pull requests, issues and releases, and show workflow runs. A personal access token is stored using your operating system’s credential encryption — never in settings.json and never in logs.</p>
              <div className="hero-actions">
                <button className="btn primary" onClick={() => setTokenOpen(true)}><Github size={14} /> Add access token</button>
                <button className="btn" onClick={() => void call('app.openExternal', { url: 'https://github.com/settings/tokens' })}>Create a token <ArrowUpRight size={12} /></button>
              </div>
            </div>
            <div className="hero-side">
              <div className="panel"><div className="panel-header"><h2>Required permissions</h2></div><div className="panel-body small muted stack" style={{ gap: 6 }}>
                <div><span className="tag">repo</span> Repository contents, pull requests, issues and releases.</div>
                <div><span className="tag">workflow</span> Workflow run status (read-only is enough).</div>
                <div>Fine-grained tokens need Contents (read), Pull requests (read/write), Issues (read/write) and Actions (read).</div>
                <div><ShieldAlert size={12} /> Treat a token like a password. Git++ never sends it anywhere except the configured GitHub API.</div>
              </div></div>
              <div className="panel"><div className="panel-header"><h2>No GitHub? No problem.</h2></div><div className="panel-body small muted">Everything in Changes, History, Branches, Remotes, Worktrees, Stashes and Preflight works entirely offline against your local repository.</div></div>
            </div>
          </div>
        ) : null}

        {!loading && status?.configured && !authenticated ? (
          <div className="stack">
            <div className="banner danger"><AlertTriangle size={15} /><div><strong>GitHub authentication failed.</strong><div className="small">{status.error ?? 'The token was rejected.'}</div></div><div className="banner-actions"><button className="btn sm" onClick={() => setTokenOpen(true)}>Replace token</button><button className="btn sm" onClick={() => setDisconnectOpen(true)}>Remove token</button></div></div>
            <div className="small muted">Local Git operations are unaffected.</div>
          </div>
        ) : null}

        {!loading && authenticated && status ? (
          <div className="stack">
            <div className="panel">
              <div className="panel-body" style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                {status.avatarUrl ? <img src={status.avatarUrl} alt="" width={38} height={38} style={{ borderRadius: 8 }} /> : <div className="empty-icon" style={{ width: 38, height: 38, margin: 0 }}><User size={18} /></div>}
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div className="row" style={{ gap: 6 }}><strong>{status.name ?? status.login}</strong> <span className="tag green"><Check size={9} />connected</span>{status.repository && !repo ? <span className="tag amber">repo not accessible</span> : null}</div>
                  <div className="small muted mono">@{status.login} · scopes: {status.scopes.length > 0 ? status.scopes.join(', ') : 'fine-grained / unknown'}</div>
                </div>
                {repo ? <div className="row small" style={{ gap: 8 }}><span className="tag">{repo.private ? <Lock size={9} /> : <CircleDot size={9} />}{repo.private ? 'private' : 'public'}</span><span className="tag">default {repo.defaultBranch}</span><button className="btn sm" onClick={() => void call('app.openExternal', { url: repo.url })}>Open on GitHub <ExternalLink size={10} /></button></div> : null}
                <button className="btn ghost sm" onClick={() => setDisconnectOpen(true)}><Trash2 size={11} /> Disconnect</button>
                {status.rateLimitRemaining !== null ? <span className="small dim">API remaining: {status.rateLimitRemaining}</span> : null}
              </div>
            </div>

            <div className="gh-tabs" style={{ padding: 0, background: 'transparent', borderRadius: 0 }}>
              {(['pulls', 'issues', 'releases', 'workflows'] as Tab[]).map((entry) => (
                <button key={entry} className={cx('gh-tab', tab === entry && 'active')} onClick={() => setTab(entry)}>
                  {entry === 'pulls' ? <GitPullRequest size={13} /> : entry === 'issues' ? <CircleDot size={13} /> : entry === 'releases' ? <Tag size={13} /> : <Workflow size={13} />}
                  {entry === 'pulls' ? 'Pull requests' : entry === 'issues' ? 'Issues' : entry === 'releases' ? 'Releases' : 'Workflows'}
                </button>
              ))}
              <div className="spacer" />
              <button className="btn ghost sm" onClick={() => void loadTab(tab)}><RefreshCw size={11} /> Reload</button>
            </div>

            {dataError ? <div className="banner danger"><AlertTriangle size={15} /><div>{dataError}</div><div className="banner-actions"><button className="btn sm" onClick={() => void loadTab(tab)}>Retry</button></div></div> : null}
            {dataLoading ? <div className="loading-state"><Spinner /> Loading {tab}…</div> : null}

            {!dataLoading && tab === 'pulls' ? (
              <div className="panel">
                <div className="panel-header"><h2>Pull requests</h2><span className="tag">{pulls.length}</span></div>
                <div className="panel-body flush">
                  {pulls.length === 0 ? <div className="small muted" style={{ padding: 16 }}>No pull requests returned by the API.</div> : null}
                  {pulls.map((pull) => (
                    <button key={pull.number} className="list-item" style={{ width: '100%', textAlign: 'left' }} onClick={() => setSelectedPull(pull)}>
                      <GitPullRequest size={15} style={{ color: pull.state === 'open' ? 'var(--green)' : pull.state === 'merged' ? 'var(--purple)' : 'var(--red)', marginTop: 2 }} />
                      <div className="item-main">
                        <div className="item-title"><span className="mono">#{pull.number}</span> {pull.title} {pull.draft ? <span className="tag">draft</span> : null}</div>
                        <div className="item-sub"><span>{pull.author}</span><span>{pull.headRef} → {pull.baseRef}</span><span><MessageSquare size={9} /> {pull.comments}</span><span>updated {relativeTime(pull.updatedAt)}</span></div>
                      </div>
                      <span className={cx('tag', pull.state === 'open' ? 'green' : 'red')}>{pull.state}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {!dataLoading && tab === 'issues' ? (
              <div className="panel">
                <div className="panel-header"><h2>Issues</h2><span className="tag">{issues.length}</span><div className="panel-actions"><button className="btn sm" onClick={() => setIssueOpen(true)}><Plus size={11} /> New issue</button></div></div>
                <div className="panel-body flush">
                  {issues.length === 0 ? <div className="small muted" style={{ padding: 16 }}>No issues returned by the API.</div> : null}
                  {issues.map((issue) => (
                    <div key={issue.number} className="list-item">
                      <CircleDot size={15} style={{ color: issue.state === 'open' ? 'var(--green)' : 'var(--purple)', marginTop: 2 }} />
                      <div className="item-main">
                        <div className="item-title"><span className="mono">#{issue.number}</span> {issue.title}</div>
                        <div className="item-sub"><span>{issue.author}</span><span>{relativeTime(issue.updatedAt)}</span>{issue.labels.map((label) => <span className="tag" key={label}>{label}</span>)}</div>
                      </div>
                      <button className="btn ghost icon" onClick={() => void call('app.openExternal', { url: issue.url })} title="Open on GitHub"><ExternalLink size={12} /></button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {!dataLoading && tab === 'releases' ? (
              <div className="panel">
                <div className="panel-header"><h2>Releases</h2><span className="tag">{releases.length}</span><div className="panel-actions"><button className="btn sm" onClick={() => setTab('releases')}><Rocket size={11} /> Release Manager is a separate workspace</button></div></div>
                <div className="panel-body flush">
                  {releases.length === 0 ? <div className="small muted" style={{ padding: 16 }}>No releases yet.</div> : null}
                  {releases.map((release) => (
                    <div key={release.id} className="list-item">
                      <Tag size={15} style={{ color: 'var(--amber)', marginTop: 2 }} />
                      <div className="item-main">
                        <div className="item-title">{release.name || release.tagName} <span className="tag">{release.tagName}</span>{release.draft ? <span className="tag amber">draft</span> : null}{release.prerelease ? <span className="tag purple">pre-release</span> : null}</div>
                        <div className="item-sub"><span>{release.author}</span><span>{release.publishedAt ? `published ${relativeTime(release.publishedAt)}` : 'unpublished'}</span></div>
                      </div>
                      <button className="btn ghost icon" onClick={() => void call('app.openExternal', { url: release.url })} title="Open release"><ExternalLink size={12} /></button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {!dataLoading && tab === 'workflows' ? (
              <div className="panel">
                <div className="panel-header"><h2>Workflow runs</h2><span className="tag">{workflows.length}</span></div>
                <div className="panel-body flush">
                  {workflows.length === 0 ? <div className="small muted" style={{ padding: 16 }}>No workflow runs returned. This can mean Actions is disabled, the token lacks Actions access, or the repository has no workflows.</div> : null}
                  {workflows.map((run) => (
                    <div key={run.id} className="list-item">
                      <Workflow size={15} style={{ color: run.conclusion === 'success' ? 'var(--green)' : run.conclusion === 'failure' ? 'var(--red)' : 'var(--amber)', marginTop: 2 }} />
                      <div className="item-main">
                        <div className="item-title">{run.name} <span className={cx('tag', run.conclusion === 'success' ? 'green' : run.conclusion === 'failure' ? 'red' : 'amber')}>{run.conclusion ?? run.status}</span></div>
                        <div className="item-sub"><span>{run.branch}</span><span>{run.event}</span><span>{relativeTime(run.createdAt)}</span></div>
                      </div>
                      <button className="btn ghost icon" onClick={() => void call('app.openExternal', { url: run.url })} title="Open run"><ExternalLink size={12} /></button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="small muted"><Info size={11} /> Git++ shows exactly what the GitHub API returned. It does not invent pull requests, issues, releases or workflow results.</div>
          </div>
        ) : null}
      </div>

      {tokenOpen ? (
        <Modal title="Connect GitHub" description="A personal access token is stored with operating-system encryption, never in a plaintext file." onClose={() => setTokenOpen(false)} width="narrow" footer={<><button className="btn ghost" onClick={() => setTokenOpen(false)}>Cancel</button><button className="btn primary" onClick={() => void connect()} disabled={savingToken || token.trim().length < 8}>{savingToken ? <Spinner /> : null} Store token</button></>}>
          <Field label="Personal access token" help="Classic tokens need the repo scope for private repositories. Fine-grained tokens need contents, issues and pull requests permissions.">
            <input className="input mono" type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="ghp_…" autoComplete="off" spellCheck={false} />
          </Field>
          <div className="banner info"><ShieldAlert size={14} /> The token is sent only to the GitHub API base URL configured in Settings ({settings.github.apiBase}).</div>
          <button className="btn ghost sm" onClick={() => void call('app.openExternal', { url: 'https://github.com/settings/tokens' })} style={{ alignSelf: 'flex-start' }}>Open GitHub token settings <ArrowUpRight size={11} /></button>
        </Modal>
      ) : null}

      {disconnectOpen ? (
        <ConfirmDialog title="Disconnect GitHub?" description="The stored personal access token is deleted from operating-system credential storage. Local Git functionality is unaffected." confirmLabel="Disconnect" danger onClose={() => setDisconnectOpen(false)} onConfirm={disconnect} consequences={['The GitHub workspace will stop working until a new token is added.', 'No repositories, issues, pull requests or releases are changed on GitHub.', 'You can create a new token at any time.']} />
      ) : null}

      {prOpen ? (
        <Modal title="Create pull request" description="Requires permission to push the branch and open pull requests. Nothing is published automatically." onClose={() => setPrOpen(false)} width="wide" footer={<><button className="btn ghost" onClick={() => setPrOpen(false)}>Cancel</button><button className="btn primary" disabled={creating || !prTitle.trim() || !prHead.trim() || !prBase.trim()} onClick={() => void createPull()}>{creating ? <Spinner /> : <GitPullRequest size={13} />} Create pull request</button></>}>
          <Field label="Title"><input className="input" value={prTitle} onChange={(event) => setPrTitle(event.target.value)} autoFocus /></Field>
          <div className="grid-2">
            <Field label="Head branch"><input className="input mono" value={prHead} onChange={(event) => setPrHead(event.target.value)} spellCheck={false} /></Field>
            <Field label="Base branch"><input className="input mono" value={prBase} onChange={(event) => setPrBase(event.target.value)} spellCheck={false} /></Field>
          </div>
          <Field label="Description (Markdown)"><textarea className="textarea" rows={6} value={prBody} onChange={(event) => setPrBody(event.target.value)} /></Field>
          <label className="checkbox-row"><input type="checkbox" checked={prDraft} onChange={(event) => setPrDraft(event.target.checked)} /> Create as draft</label>
          <label className="checkbox-row"><input type="checkbox" checked={prPush} onChange={(event) => setPrPush(event.target.checked)} /> Push the head branch to origin first (with upstream tracking)</label>
          {prPush ? <div className="banner warn"><CloudUpload size={14} /> Git++ will run a real <span className="inline-code">git push --set-upstream origin {prHead || 'branch'}</span> before calling the API. This updates the remote repository.</div> : null}
          <div className="banner info"><Info size={14} /> The pull request is created only after GitHub confirms it. If the API returns an error, Git++ shows it instead of claiming success.</div>
        </Modal>
      ) : null}

      {issueOpen ? (
        <Modal title="Create issue" onClose={() => setIssueOpen(false)} width="wide" footer={<><button className="btn ghost" onClick={() => setIssueOpen(false)}>Cancel</button><button className="btn primary" disabled={creating || !issueTitle.trim()} onClick={() => void createIssue()}>{creating ? <Spinner /> : <Plus size={13} />} Create issue</button></>}>
          <Field label="Title"><input className="input" value={issueTitle} onChange={(event) => setIssueTitle(event.target.value)} autoFocus /></Field>
          <Field label="Description (Markdown)"><textarea className="textarea" rows={8} value={issueBody} onChange={(event) => setIssueBody(event.target.value)} /></Field>
        </Modal>
      ) : null}

      {selectedPull ? (
        <Modal title={`#${selectedPull.number} ${selectedPull.title}`} description={`${selectedPull.headRef} → ${selectedPull.baseRef}`} onClose={() => setSelectedPull(null)} footer={<><button className="btn ghost" onClick={() => setSelectedPull(null)}>Close</button><button className="btn primary" onClick={() => void call('app.openExternal', { url: selectedPull.url })}>Open on GitHub <ExternalLink size={12} /></button></>}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className={cx('tag', selectedPull.state === 'open' ? 'green' : 'red')}>{selectedPull.state}</span>
            {selectedPull.draft ? <span className="tag">draft</span> : null}
            <span className="tag"><User size={9} />{selectedPull.author}</span>
            <span className="tag"><MessageSquare size={9} />{selectedPull.comments} comments</span>
            <span className="tag">updated {relativeTime(selectedPull.updatedAt)}</span>
            <span className="tag">mergeable: {selectedPull.mergeable ?? 'unknown'}</span>
          </div>
          <div className="small muted">Git++ lists pull requests from the GitHub API. Full review, comments and checks are available on GitHub; this workspace does not simulate them.</div>
        </Modal>
      ) : null}
      <div style={{ display: 'none' }}><Loader2 size={1} /><ListChecks size={1} /></div>
    </div>
  );
}

