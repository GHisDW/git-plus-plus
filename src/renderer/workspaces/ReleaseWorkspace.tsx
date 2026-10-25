import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2, ChevronRight, Download, RefreshCw, Rocket, ShieldCheck, Tag, XCircle,
} from 'lucide-react';
import type { CommitSummary, GithubStatus, PreflightRun, RemoteInfo, TagInfo } from '../../shared/types';
import { call, errorDetail, errorMessage } from '../lib/api';
import { useApp } from '../state/AppState';
import { plural } from '../lib/utils';
import { formatDateTime, relativeTime } from '../../shared/format';
import { ConfirmDialog, CopyButton, EmptyState, Field, Spinner } from '../components/ui';

function nextVersion(tags: TagInfo[]): string {
  const versions = tags
    .map((tag) => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag.name))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => [Number(match[1]), Number(match[2]), Number(match[3])] as const)
    .sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2]);
  const latest = versions[0];
  if (!latest) return 'v1.0.0';
  return `v${latest[0]}.${latest[1]}.${latest[2] + 1}`;
}

function generateNotes(commits: CommitSummary[], version: string): string {
  const groups: Record<string, CommitSummary[]> = { feat: [], fix: [], perf: [], docs: [], refactor: [], test: [], chore: [], other: [] };
  for (const commit of commits) {
    const match = /^(feat|fix|perf|docs|refactor|test|chore)(?:\([^)]+\))?!?:/i.exec(commit.subject);
    const key = match?.[1]?.toLowerCase() ?? 'other';
    (groups[key] ?? groups.other)?.push(commit);
  }
  const labels: Record<string, string> = { feat: 'Features', fix: 'Fixes', perf: 'Performance', docs: 'Documentation', refactor: 'Refactoring', test: 'Tests', chore: 'Maintenance', other: 'Other changes' };
  const lines = [`# ${version}`, ''];
  for (const key of ['feat', 'fix', 'perf', 'docs', 'refactor', 'test', 'chore', 'other']) {
    const entries = groups[key];
    if (!entries || entries.length === 0) continue;
    lines.push(`## ${labels[key]}`, '');
    for (const commit of entries) {
      lines.push(`- ${commit.subject.replace(/^\w+(\([^)]*\))?!?:\s*/, '')} (${commit.shortSha}, ${commit.author})`);
    }
    lines.push('');
  }
  if (commits.length === 0) lines.push('No commits since the selected reference.', '');
  return lines.join('\n').trim() + '\n';
}

export function ReleaseWorkspace(): React.JSX.Element {
  const { snapshot, runOperation, toast, setWorkspace, settings } = useApp();
  const repoPath = snapshot?.info.path ?? '';
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [remotes, setRemotes] = useState<RemoteInfo[]>([]);
  const [runs, setRuns] = useState<PreflightRun[]>([]);
  const [github, setGithub] = useState<GithubStatus | null>(null);
  const [commits, setCommits] = useState<CommitSummary[]>([]);
  const [base, setBase] = useState('');
  const [loading, setLoading] = useState(true);
  const [tagName, setTagName] = useState('v1.0.0');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [notesTouched, setNotesTouched] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [draft, setDraft] = useState(false);
  const [prerelease, setPrerelease] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!repoPath) return;
    if (!silent) setLoading(true);
    try {
      const [nextTags, nextRemotes, nextRuns, nextGithub] = await Promise.all([
        call('git.tags', { repoPath }),
        call('git.remotes', { repoPath }),
        call('preflight.runs', { repoPath }).catch(() => []),
        call('github.status', { repoPath }).catch(() => null),
      ]);
      setTags(nextTags);
      setRemotes(nextRemotes);
      setRuns(nextRuns);
      setGithub(nextGithub);
      setBase((current) => current || nextTags[0]?.name || '');
      setTagName((current) => (current === 'v1.0.0' ? nextVersion(nextTags) : current));
      setTitle((current) => current || `${snapshot?.info.name ?? 'Release'} ${nextVersion(nextTags)}`);
    } catch (error) {
      toast('error', 'Could not load release data', errorDetail(error) ?? errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [repoPath, snapshot?.info.name, toast]);

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [repoPath]);

  useEffect(() => {
    if (!repoPath) return undefined;
    let active = true;
    void call('git.log', { repoPath, limit: 200, ref: base ? `${base}..HEAD` : 'HEAD' })
      .then((result) => { if (active) setCommits(result.commits); })
      .catch(() => { if (active) setCommits([]); });
    return () => { active = false; };
  }, [repoPath, base, snapshot?.refreshedAt]);

  const generated = useMemo(() => generateNotes(commits, tagName || 'Release'), [commits, tagName]);

  useEffect(() => {
    if (!notesTouched) setNotes(generated);
  }, [generated, notesTouched]);

  const tagExists = tags.some((tag) => tag.name === tagName.trim());
  const tagPrefixValid = /^[\w][\w./-]{0,254}$/.test(tagName.trim());
  const clean = (snapshot?.files.length ?? 0) === 0;
  const latestRun = runs[0] ?? null;
  const preflightOk = Boolean(latestRun && latestRun.status === 'passed' && !latestRun.stale);
  const preflightNotRun = !latestRun;
  const remote = remotes[0] ?? null;

  const checklist = [
    { label: 'Tag name is valid', ok: tagPrefixValid, detail: tagName },
    { label: 'Tag does not already exist', ok: !tagExists && tagPrefixValid, detail: tagExists ? 'choose another version' : 'available' },
    { label: 'Working tree is clean', ok: clean, detail: clean ? 'no changes' : `${snapshot?.files.length ?? 0} changed paths` },
    { label: 'Preflight checks passed', ok: preflightOk, detail: preflightNotRun ? 'not run in this session' : latestRun?.stale ? 'results are stale' : latestRun?.status ?? 'unknown' },
    { label: 'Remote configured', ok: Boolean(remote), detail: remote?.name ?? 'no remote' },
    { label: 'GitHub connected (for publishing)', ok: Boolean(github?.authenticated), detail: github?.authenticated ? `@${github.login}` : 'optional, required to publish a GitHub release' },
  ];

  const createTag = async () => {
    const result = await runOperation('Creating tag…', () => call('git.createTag', {
      repoPath,
      name: tagName.trim(),
      target: 'HEAD',
      message: `${title || tagName}\n\n${notes}`.slice(0, 9000),
    }), { success: `Tag ${tagName.trim()} created locally` });
    setTagOpen(false);
    if (result) await load(true);
  };

  const pushTag = async () => {
    setBusy('Pushing tag…');
    try {
      const result = await call('git.pushTag', { repoPath, tag: tagName.trim(), ...(remote ? { remote: remote.name } : {}) });
      toast('success', 'Tag pushed', result.output);
      setPushOpen(false);
      await load(true);
    } catch (error) {
      toast('error', 'Could not push the tag', errorDetail(error) ?? errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const publish = async () => {
    setBusy('Publishing release…');
    try {
      const release = await call('github.createRelease', {
        repoPath,
        tag: tagName.trim(),
        name: title.trim() || tagName.trim(),
        body: notes,
        draft,
        prerelease,
      });
      toast('success', `GitHub release ${draft ? 'draft ' : ''}created`, `${release.tagName} · ${release.url}`);
      setPublishOpen(false);
    } catch (error) {
      toast('error', 'Could not publish the release', errorDetail(error) ?? errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const download = () => {
    const blob = new Blob([notes], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${tagName || 'release'}-notes.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (!snapshot) {
    return <div className="workspace"><EmptyState icon={Rocket} title="No repository open" description="Open a repository to prepare a release from its real history." /></div>;
  }

  return (
    <div className="workspace">
      <div className="workspace-header">
        <div className="workspace-heading">
          <h1>Release Manager <span className="tag">{commits.length} commits since {base || 'the beginning'}</span></h1>
          <p>Prepare locally first. Tags, pushes and GitHub releases happen only after explicit confirmation.</p>
        </div>
        <div className="workspace-actions">
          <button className="btn" onClick={() => void load()}><RefreshCw size={13} /> Refresh</button>
          <button className="btn" onClick={() => void download()}><Download size={13} /> Export notes</button>
          <button className="btn primary" onClick={() => setTagOpen(true)} disabled={!tagPrefixValid || tagExists}><Tag size={13} /> Create tag</button>
        </div>
      </div>
      <div className="workspace-body">
        {loading ? <div className="loading-state"><Spinner /> Reviewing release state…</div> : null}
        {!loading ? (
          <div className="release-layout">
            <div className="stack">
              <div className="panel">
                <div className="panel-header"><h2>Release notes draft</h2><div className="panel-actions"><CopyButton value={notes} label="Copy notes" /><button className="btn ghost sm" onClick={() => { setNotesTouched(false); setNotes(generated); }}>Regenerate</button></div></div>
                <div className="panel-body stack" style={{ gap: 12 }}>
                  <div className="grid-2">
                    <Field label="Tag / version" help="Validated with Git ref rules."><input className="input mono" value={tagName} onChange={(event) => setTagName(event.target.value)} spellCheck={false} /></Field>
                    <Field label="Release title"><input className="input" value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
                  </div>
                  <Field label="Compared against" help="Commits after this reference are listed in the notes.">
                    <select className="input" value={base} onChange={(event) => { setBase(event.target.value); setNotesTouched(false); }}>
                      <option value="">Beginning of history</option>
                      {tags.map((tag) => <option key={tag.name} value={tag.name}>{tag.name}{tag.date ? ` · ${formatDateTime(tag.date)}` : ''}</option>)}
                    </select>
                  </Field>
                  <Field label="Notes (Markdown)" help="Generated from real commit messages; edit freely. Nothing is written to the repository until you create the tag.">
                    <textarea className="textarea release-notes" rows={16} value={notes} onChange={(event) => { setNotes(event.target.value); setNotesTouched(true); }} />
                  </Field>
                </div>
              </div>

              <div className="panel">
                <div className="panel-header"><h2>Commits in this release</h2><span className="tag">{commits.length}</span></div>
                <div className="panel-body" style={{ maxHeight: 320, overflow: 'auto', padding: 4 }}>
                  {commits.length === 0 ? <div className="small muted" style={{ padding: 10 }}>No commits found after the selected reference. Choose a different base or commit some work first.</div> : null}
                  {commits.map((commit) => (
                    <button key={commit.sha} className="row" style={{ width: '100%', padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)' }} onClick={() => setWorkspace('history')}>
                      <span className="tag">{commit.shortSha}</span>
                      <span className="small truncate" style={{ flex: 1 }}>{commit.subject}</span>
                      <span className="small dim">{commit.author}</span>
                      <span className="small dim">{relativeTime(commit.date)}</span>
                      <ChevronRight size={12} />
                    </button>
                  ))}
                </div>
              </div>

              <div className="panel">
                <div className="panel-header"><h2>Tags</h2><span className="tag">{tags.length}</span></div>
                <div className="panel-body" style={{ padding: 4 }}>
                  {tags.length === 0 ? <div className="small muted" style={{ padding: 10 }}>No tags yet.</div> : null}
                  {tags.slice(0, 10).map((tag) => (
                    <div key={tag.name} className="row" style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', gap: 8 }}>
                      <Tag size={12} style={{ color: 'var(--amber)' }} />
                      <span className="mono small">{tag.name}</span>
                      <span className="tag">{tag.annotated ? 'annotated' : 'lightweight'}</span>
                      <span className="small truncate" style={{ flex: 1 }}>{tag.message}</span>
                      <span className="small dim">{tag.date ? formatDateTime(tag.date) : ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="stack">
              <div className="panel">
                <div className="panel-header"><h2>Release checklist</h2><span className="tag">{checklist.filter((item) => item.ok).length}/{checklist.length}</span></div>
                <div className="panel-body">
                  <div className="checklist">
                    {checklist.map((item) => (
                      <div className="checklist-item" key={item.label}>
                        {item.ok ? <CheckCircle2 size={14} style={{ color: 'var(--green)' }} /> : <XCircle size={14} style={{ color: 'var(--amber)' }} />}
                        <span style={{ flex: 1 }}>{item.label}</span>
                        <span className="small dim">{item.detail}</span>
                      </div>
                    ))}
                  </div>
                  {!preflightOk ? <div className="banner warn" style={{ marginTop: 10 }}><ShieldCheck size={14} /><div><div>Preflight has not confirmed this revision.</div><button className="btn sm" style={{ marginTop: 6 }} onClick={() => setWorkspace('preflight')}>Open Preflight Lab</button></div></div> : null}
                </div>
              </div>

              <div className="panel">
                <div className="panel-header"><h2>Release steps</h2></div>
                <div className="panel-body stack" style={{ gap: 10 }}>
                  <div className="op-row"><span className="tag">1</span><div style={{ flex: 1 }}><div className="op-label">Create the annotated tag locally</div><div className="small muted">No remote is touched.</div></div><button className="btn sm" onClick={() => setTagOpen(true)} disabled={!tagPrefixValid || tagExists}>Create</button></div>
                  <div className="op-row"><span className="tag">2</span><div style={{ flex: 1 }}><div className="op-label">Push the tag to {remote?.name ?? 'a remote'}</div><div className="small muted">Publishes the tag ref. Requires a remote.</div></div><button className="btn sm" onClick={() => setPushOpen(true)} disabled={!remote || !tagExists}>Push tag</button></div>
                  <div className="op-row"><span className="tag">3</span><div style={{ flex: 1 }}><div className="op-label">Publish a GitHub release</div><div className="small muted">{github?.authenticated ? `Connected as @${github.login}` : 'Requires GitHub authentication.'}</div></div><button className="btn sm" onClick={() => setPublishOpen(true)} disabled={!github?.authenticated || !tagExists}>Publish…</button></div>
                  <div className="small muted">Git++ never publishes because checks passed. Every step above is a separate, explicit action.</div>
                </div>
              </div>

              <div className="panel">
                <div className="panel-header"><h2>Release context</h2></div>
                <div className="panel-body small muted stack" style={{ gap: 6 }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}><span>Branch</span><span className="mono">{snapshot.info.head.branch ?? 'detached HEAD'}</span></div>
                  <div className="row" style={{ justifyContent: 'space-between' }}><span>HEAD</span><span className="mono">{snapshot.info.head.oid?.slice(0, 10) ?? 'none'}</span></div>
                  <div className="row" style={{ justifyContent: 'space-between' }}><span>Remote</span><span className="mono">{remote?.name ?? 'none'}</span></div>
                  <div className="row" style={{ justifyContent: 'space-between' }}><span>GitHub API</span><span className="mono">{settings.github.apiBase}</span></div>
                  <div className="row" style={{ justifyContent: 'space-between' }}><span>Latest preflight</span><span>{latestRun ? `${latestRun.status}${latestRun.stale ? ' (stale)' : ''}` : 'not run'}</span></div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {tagOpen ? (
        <ConfirmDialog
          title={`Create tag ${tagName}?`}
          description="Creates a real annotated tag at HEAD with the release notes as its message. This changes local Git metadata only."
          confirmLabel="Create tag"
          onClose={() => setTagOpen(false)}
          onConfirm={createTag}
          consequences={[`Tag: ${tagName} at ${snapshot.info.head.oid?.slice(0, 10) ?? 'HEAD'}.`, 'No branch history is rewritten.', 'The tag exists only in this clone until you push it.']}
        />
      ) : null}

      {pushOpen ? (
        <ConfirmDialog
          title={`Push tag ${tagName} to ${remote?.name ?? 'remote'}?`}
          description="This sends the tag to the remote repository, where other people can see it."
          confirmLabel="Push tag"
          onClose={() => setPushOpen(false)}
          onConfirm={pushTag}
          busy={busy !== null}
          consequences={[`Remote: ${remote?.name ?? 'none'}.`, `Ref: refs/tags/${tagName}.`, 'The remote repository is modified. Deleting a published tag later requires coordinating with everyone who fetched it.']}
        />
      ) : null}

      {publishOpen ? (
        <ConfirmDialog
          title="Publish a GitHub release?"
          description="Uses the GitHub API to create a release for this tag. This is a public action on GitHub if the repository is public."
          confirmLabel={draft ? 'Save draft release' : 'Publish release'}
          danger={!draft}
          onClose={() => setPublishOpen(false)}
          onConfirm={publish}
          busy={busy !== null}
          consequences={[`Tag: ${tagName}.`, `Repository: ${github?.repository ? `${github.repository.owner}/${github.repository.name}` : 'unknown'}.`, 'GitHub will expose the release notes and source archive.', 'Git++ reports success only after GitHub confirms the release.']}
        >
          <label className="checkbox-row"><input type="checkbox" checked={draft} onChange={(event) => setDraft(event.target.checked)} /> Save as draft instead of publishing immediately</label>
          <label className="checkbox-row"><input type="checkbox" checked={prerelease} onChange={(event) => setPrerelease(event.target.checked)} /> Mark as pre-release</label>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

void plural;
