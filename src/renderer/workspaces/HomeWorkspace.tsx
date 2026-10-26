import React, { useEffect, useState } from 'react';
import {
  AlertTriangle, ArrowRight, ArrowUpRight, Boxes, CloudDownload, FileCode2, FolderGit2, FolderPlus,
  GitBranch, GitCommitHorizontal, History, Pin, PinOff, RefreshCw, Rocket, ShieldCheck, Sparkles, X,
} from 'lucide-react';
import type { CommitSummary, PreflightRun, WorktreeInfo } from '../../shared/types';
import { useApp } from '../state/AppState';
import { call } from '../lib/api';
import { relativeTime } from '../../shared/format';
import { cx } from '../lib/utils';
import { Logo, Spinner } from '../components/ui';

export function HomeWorkspace(): React.JSX.Element {
  const { snapshot, info, recents, openRepository, initRepository, setWorkspace, refresh, pinRecent, removeRecent, openRepository: open } = useApp();
  const [commits, setCommits] = useState<CommitSummary[]>([]);
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);
  const [run, setRun] = useState<PreflightRun | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!snapshot) return undefined;
    let active = true;
    setLoading(true);
    void (async () => {
      const repoPath = snapshot.info.path;
      const [log, trees, runs] = await Promise.all([
        call('git.log', { repoPath, limit: 6 }).catch(() => ({ commits: [], hasMore: false, headSha: null })),
        call('git.worktrees', { repoPath }).catch(() => []),
        call('preflight.runs', { repoPath }).catch(() => []),
      ]);
      if (!active) return;
      setCommits(log.commits);
      setWorktrees(trees);
      setRun(runs[0] ?? null);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [snapshot?.info.path, snapshot?.refreshedAt]);

  if (!info?.git.available) {
    return (
      <div className="workspace">
        <div className="workspace-body">
          <div className="hero">
            <div className="hero-main">
              <span className="hero-eyebrow">Setup required</span>
              <div className="row" style={{ gap: 12 }}><Logo size={40} /><h2>Git is not available</h2></div>
              <p>Git++ drives the real Git command line. Install Git, make sure it is on your PATH, then reopen the app or set its location in Settings.</p>
              <div className="hero-actions">
                <button className="btn primary" onClick={() => setWorkspace('settings')}>Open settings</button>
                <button className="btn" onClick={() => void call('app.openExternal', { url: 'https://git-scm.com/downloads' })}>Download Git <ArrowUpRight size={12} /></button>
                <button className="btn" onClick={() => void refresh()}><RefreshCw size={13} /> Re-check</button>
              </div>
            </div>
            <div className="hero-side">
              <div className="panel"><div className="panel-header"><h2>Why Git++ needs Git</h2></div><div className="panel-body small muted">
                Git++ is a client, not a reimplementation. Every status, diff, commit, branch and worktree operation is performed by your installed Git executable, so your repository behaves exactly as it does in a terminal.
              </div></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="workspace">
        <div className="workspace-body">
          <div className="hero">
            <div className="hero-main">
              <span className="hero-eyebrow">Git, but plus plus</span>
              <h2>Work with Git, clearly.</h2>
              <p>Open a repository to see real status, stage exactly what you mean, review genuine diffs, run safe preflight checks, and work on several branches at once with Git worktrees.</p>
              <div className="hero-actions">
                <button className="btn primary" onClick={() => void openRepository()}><FolderGit2 size={14} /> Open repository</button>
                <button className="btn" onClick={() => window.dispatchEvent(new CustomEvent('gitpp:action', { detail: 'clone-repository' }))}><CloudDownload size={14} /> Clone repository</button>
                <button className="btn" onClick={() => void initRepository()}><FolderPlus size={14} /> Initialize repository</button>
              </div>
              <div className="row small dim" style={{ marginTop: 4 }}><ShieldCheck size={12} /> Local-first. No account required. No telemetry.</div>
            </div>
            <div className="hero-side">
              <div className="panel">
                <div className="panel-header"><h2>Recent repositories</h2><span className="tag">{recents.length}</span></div>
                <div className="panel-body flush">
                  {recents.length === 0 ? <div className="small muted" style={{ padding: 16 }}>Repositories you open will appear here. You can pin the ones you use every day.</div> : null}
                  {recents.slice(0, 6).map((repo) => (
                    <div className="repo-card" key={repo.path}>
                      <div className="row" style={{ gap: 4 }}>
                        <button style={{ flex: 1, textAlign: 'left', minWidth: 0 }} onClick={() => void open(repo.path)}>
                          <div className="repo-title">{repo.pinned ? <Pin size={11} /> : <FolderGit2 size={12} />} {repo.name}</div>
                          <div className="repo-path">{repo.path}</div>
                          <div className="repo-meta">last opened {relativeTime(repo.lastOpenedAt)}</div>
                        </button>
                        <button className="btn ghost icon" title={repo.pinned ? 'Unpin' : 'Pin'} onClick={() => void pinRecent(repo.path, !repo.pinned)}>{repo.pinned ? <PinOff size={12} /> : <Pin size={12} />}</button>
                        <button className="btn ghost icon" title="Remove from recents (does not delete the folder)" onClick={() => void removeRecent(repo.path)}><X size={12} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="panel"><div className="panel-header"><h2>What makes it “++”</h2></div><div className="panel-body" style={{ display: 'grid', gap: 10 }}>
                <Feature icon={ShieldCheck} title="Preflight Lab" text="Run real checks against the actual working tree and see results become stale when the repository changes." />
                <Feature icon={Boxes} title="Parallel Universes" text="Create real Git worktrees and work on separate branches simultaneously." />
                <Feature icon={FileCode2} title="Markdown Studio" text="Edit repository documents with a safe live preview and external-change protection." />
              </div></div>
            </div>
          </div>
          <div className="grid-3">
            <div className="panel"><div className="panel-header"><h2>Start from the command line?</h2></div><div className="panel-body small muted">Git++ uses your configured Git executable. Authentication, credential helpers, hooks and signing behave exactly as they do in your terminal.</div></div>
            <div className="panel"><div className="panel-header"><h2>Safe by default</h2></div><div className="panel-body small muted">No implicit staging, no forced pushes, no automatic deletion of branches or worktrees, and explicit confirmation for destructive operations.</div></div>
            <div className="panel"><div className="panel-header"><h2>Your data stays local</h2></div><div className="panel-body small muted">Repository content is never sent anywhere unless you configure AI and explicitly ask for it. GitHub access is optional.</div></div>
          </div>
        </div>
      </div>
    );
  }

  const identityMissing = !snapshot.info.identity.name || !snapshot.info.identity.email;
  const warnings: Array<{ tone: 'warn' | 'danger'; text: string; action?: () => void; actionLabel?: string }> = [];
  if (snapshot.stats.conflicted > 0) warnings.push({ tone: 'danger', text: `${snapshot.stats.conflicted} conflicted file(s). Resolve them before committing.`, action: () => setWorkspace('changes'), actionLabel: 'Resolve' });
  if (identityMissing) warnings.push({ tone: 'warn', text: 'Git identity is incomplete. Commits will fail until user.name and user.email are configured.', action: () => setWorkspace('settings'), actionLabel: 'Fix identity' });
  if (snapshot.info.head.detached) warnings.push({ tone: 'warn', text: 'HEAD is detached. Commits will not belong to a branch until you create or switch one.', action: () => setWorkspace('branches'), actionLabel: 'Branches' });
  if (snapshot.info.isShallow) warnings.push({ tone: 'warn', text: 'This is a shallow clone. History and some comparisons will be incomplete.' });
  if (snapshot.info.head.unborn) warnings.push({ tone: 'warn', text: 'This repository has no commits yet. Stage files and create the first commit.' });

  return (
    <div className="workspace">
      <div className="workspace-header">
        <div className="workspace-heading">
          <h1>{snapshot.info.name} <span className="tag accent"><GitBranch size={10} />{snapshot.info.head.detached ? 'detached' : snapshot.info.head.branch ?? 'unborn'}</span></h1>
          <p title={snapshot.info.path}>{snapshot.info.path} · refreshed {relativeTime(snapshot.refreshedAt)}</p>
        </div>
        <div className="workspace-actions">
          <button className="btn" onClick={() => void refresh()}><RefreshCw size={13} /> Refresh</button>
          <button className="btn primary" onClick={() => setWorkspace('changes')}><GitCommitHorizontal size={13} /> Commit changes</button>
        </div>
      </div>
      <div className="workspace-body">
        {warnings.length > 0 ? (
          <div className="stack" style={{ gap: 8, marginBottom: 'var(--space-4)' }}>
            {warnings.map((warning) => (
              <div className={cx('banner', warning.tone)} key={warning.text}>
                <AlertTriangle size={14} />
                <span>{warning.text}</span>
                {warning.action ? <div className="banner-actions"><button className="btn sm" onClick={warning.action}>{warning.actionLabel}</button></div> : null}
              </div>
            ))}
          </div>
        ) : null}

        <div className="stat-grid" style={{ marginBottom: 'var(--space-4)' }}>
          <Stat label="Staged" value={snapshot.stats.staged} tone={snapshot.stats.staged > 0 ? 'green' : undefined} sub="ready to commit" />
          <Stat label="Unstaged" value={snapshot.stats.unstaged} tone={snapshot.stats.unstaged > 0 ? 'amber' : undefined} sub="working tree" />
          <Stat label="Untracked" value={snapshot.stats.untracked} tone={snapshot.stats.untracked > 0 ? 'amber' : undefined} sub="not in Git yet" />
          <Stat label="Conflicts" value={snapshot.stats.conflicted} tone={snapshot.stats.conflicted > 0 ? 'red' : 'green'} sub={snapshot.stats.conflicted > 0 ? 'needs attention' : 'none'} />
        </div>

        <div className="grid-2" style={{ marginBottom: 'var(--space-4)' }}>
          <div className="panel">
            <div className="panel-header"><h2>Recent commits</h2><div className="panel-actions"><button className="btn ghost sm" onClick={() => setWorkspace('history')}>History <ArrowRight size={11} /></button></div></div>
            <div className="panel-body">
              {loading && commits.length === 0 ? <Spinner /> : null}
              {!loading && commits.length === 0 ? <div className="small muted">No commits yet.</div> : null}
              {commits.map((commit) => (
                <button key={commit.sha} className="commit-mini" style={{ width: '100%', textAlign: 'left' }} onClick={() => setWorkspace('history')}>
                  <span className="sha">{commit.shortSha}</span>
                  <span className="subject">{commit.subject}</span>
                  <span className="when">{relativeTime(commit.date)}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="panel">
            <div className="panel-header"><h2>Quick actions</h2></div>
            <div className="panel-body">
              <div className="quick-grid">
                <Quick icon={GitCommitHorizontal} label="Review changes" onClick={() => setWorkspace('changes')} />
                <Quick icon={History} label="Explore history" onClick={() => setWorkspace('history')} />
                <Quick icon={GitBranch} label="Manage branches" onClick={() => setWorkspace('branches')} />
                <Quick icon={Boxes} label="New worktree" onClick={() => setWorkspace('worktrees')} />
                <Quick icon={ShieldCheck} label="Run preflight" onClick={() => setWorkspace('preflight')} />
                <Quick icon={FileCode2} label="Markdown Studio" onClick={() => setWorkspace('markdown')} />
                <Quick icon={CloudDownload} label="Fetch remote" onClick={() => setWorkspace('remotes')} />
                <Quick icon={Rocket} label="Prepare release" onClick={() => setWorkspace('release')} />
                <Quick icon={Sparkles} label="GitHub" onClick={() => setWorkspace('github')} />
              </div>
            </div>
          </div>
        </div>

        <div className="grid-2">
          <div className="panel">
            <div className="panel-header"><h2>Parallel universes</h2><div className="panel-actions"><button className="btn ghost sm" onClick={() => setWorkspace('worktrees')}>Manage <ArrowRight size={11} /></button></div></div>
            <div className="panel-body">
              {worktrees.length === 0 ? <div className="small muted">No worktrees. Create one to work on another branch without touching this working tree.</div> : null}
              {worktrees.map((worktree) => (
                <div className="row" key={worktree.path} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <Boxes size={13} style={{ color: 'var(--purple)' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="small truncate">{worktree.branch ?? 'detached HEAD'} {worktree.isMain ? <span className="tag">main tree</span> : null}</div>
                    <div className="mono small dim truncate">{worktree.path}</div>
                  </div>
                  <span className={cx('tag', worktree.dirty ? 'amber' : 'green')}>{worktree.dirty ? 'changes' : 'clean'}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="panel">
            <div className="panel-header"><h2>Last preflight</h2><div className="panel-actions"><button className="btn ghost sm" onClick={() => setWorkspace('preflight')}>Open lab <ArrowRight size={11} /></button></div></div>
            <div className="panel-body">
              {!run ? <div className="small muted">No checks have run in this session. Preflight never runs automatically.</div> : (
                <div className="stack" style={{ gap: 8 }}>
                  <div className="row"><span className={cx('tag', run.status === 'passed' ? 'green' : run.status === 'failed' ? 'red' : 'amber')}>{run.status}</span><span className="small muted">{relativeTime(run.startedAt)} · {run.results.length} checks</span></div>
                  {run.results.slice(0, 4).map((result) => (
                    <div className="row small" key={result.checkId} style={{ justifyContent: 'space-between' }}>
                      <span className="truncate">{result.name}</span>
                      <span className={cx('check-status-label', `status-${result.status}`)}>{result.status}</span>
                    </div>
                  ))}
                  {run.stale ? <div className="banner warn" style={{ padding: '5px 8px' }}><AlertTriangle size={12} /> Repository changed since this run.</div> : null}
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ height: 'var(--space-6)' }} />
      </div>
    </div>
  );
}

function Feature({ icon: Icon, title, text }: { icon: typeof ShieldCheck; title: string; text: string }): React.JSX.Element {
  return (
    <div className="row" style={{ alignItems: 'flex-start', gap: 9 }}>
      <span style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}><Icon size={14} /></span>
      <div><div className="small" style={{ fontWeight: 500 }}>{title}</div><div className="small muted">{text}</div></div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: number; sub: string; tone?: 'green' | 'amber' | 'red' }): React.JSX.Element {
  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <span className={cx('stat-value', tone)}>{value}</span>
      <span className="stat-sub">{sub}</span>
    </div>
  );
}

function Quick({ icon: Icon, label, onClick }: { icon: typeof ShieldCheck; label: string; onClick: () => void }): React.JSX.Element {
  return <button className="quick-action" onClick={onClick}><Icon size={14} />{label}</button>;
}

