import React, { useEffect, useState } from 'react';
import {
  ArrowDown, ArrowUp, CloudDownload, CloudUpload, Link2, Pencil, Plus, RefreshCw, Trash2, Wifi,
} from 'lucide-react';
import type { RemoteInfo } from '../../shared/types';
import { call, errorDetail, errorMessage } from '../lib/api';
import { useApp } from '../state/AppState';
import { ConfirmDialog, EmptyState, Field, Modal, Spinner } from '../components/ui';

export function RemotesWorkspace(): React.JSX.Element {
  const { snapshot, runOperation, toast, refresh } = useApp();
  const repoPath = snapshot?.info.path ?? '';
  const [remotes, setRemotes] = useState<RemoteInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<'add' | 'edit' | 'remove' | 'force-push' | null>(null);
  const [target, setTarget] = useState<RemoteInfo | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [output, setOutput] = useState<{ title: string; body: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async (silent = false) => {
    if (!repoPath) return;
    if (!silent) setLoading(true);
    try {
      setRemotes(await call('git.remotes', { repoPath }));
    } catch (error) {
      toast('error', 'Could not load remotes', errorDetail(error) ?? errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [repoPath, snapshot?.refreshedAt]);

  const add = async () => {
    if (!name.trim() || !url.trim()) return;
    const result = await runOperation('Adding remote…', () => call('git.addRemote', { repoPath, name: name.trim(), url: url.trim() }), {
      success: `Remote ${name.trim()} added`,
    });
    if (result) { setDialog(null); setName(''); setUrl(''); await load(true); }
  };

  const edit = async () => {
    if (!target || !url.trim()) return;
    const result = await runOperation('Updating remote URL…', () => call('git.editRemote', { repoPath, name: target.name, url: url.trim() }), {
      success: `Remote ${target.name} updated`,
    });
    if (result) { setDialog(null); await load(true); }
  };

  const remove = async () => {
    if (!target) return;
    const result = await runOperation('Removing remote…', () => call('git.removeRemote', { repoPath, name: target.name }), {
      success: `Remote ${target.name} removed locally`,
    });
    setDialog(null);
    if (result) await load(true);
  };

  const network = async (kind: 'fetch' | 'pull' | 'push', remote?: RemoteInfo, force = false) => {
    if (!snapshot) return;
    const label = kind === 'fetch' ? 'Fetching…' : kind === 'pull' ? 'Pulling…' : force ? 'Force-pushing with lease…' : 'Pushing…';
    setBusy(label);
    try {
      const result = kind === 'fetch'
        ? await call('git.fetch', { repoPath, ...(remote ? { remote: remote.name } : {}) })
        : kind === 'pull'
          ? await call('git.pull', { repoPath, ...(remote ? { remote: remote.name } : {}), ...(snapshot.info.head.branch ? { branch: snapshot.info.head.branch } : {}) })
          : await call('git.push', { repoPath, ...(remote ? { remote: remote.name } : {}), ...(snapshot.info.head.branch ? { branch: snapshot.info.head.branch } : {}), ...(force ? { forceWithLease: true } : {}) });
      setBusy(null);
      setOutput({ title: `${kind === 'fetch' ? 'Fetch' : kind === 'pull' ? 'Pull' : 'Push'} completed`, body: result.output || 'Git reported no output, but the operation succeeded.' });
      await refresh();
      await load(true);
      if (kind === 'push') toast('success', 'Push completed', `${result.remote}/${result.branch ?? 'current branch'}`);
      else toast('success', kind === 'fetch' ? 'Fetch completed' : 'Pull completed');
    } catch (error) {
      setBusy(null);
      toast('error', `${kind === 'fetch' ? 'Fetch' : kind === 'pull' ? 'Pull' : 'Push'} failed`, errorDetail(error) ?? errorMessage(error));
    }
  };

  if (!snapshot) {
    return <div className="workspace"><EmptyState icon={Wifi} title="No repository open" description="Open a repository to manage remotes and synchronize with real network operations." /></div>;
  }

  const head = snapshot.info.head;
  const origin = remotes.find((remote) => remote.name === 'origin') ?? remotes[0] ?? null;
  const branch = head.branch;

  return (
    <div className="workspace">
      <div className="workspace-header">
        <div className="workspace-heading">
          <h1>Remotes <span className="tag">{remotes.length}</span></h1>
          <p>Fetch, pull and push are real Git network operations. Authentication is handled by your Git credential helper.</p>
        </div>
        <div className="workspace-actions">
          <button className="btn" onClick={() => { setName(''); setUrl(''); setDialog('add'); }}><Plus size={13} /> Add remote</button>
          <button className="btn" onClick={() => void load()}><RefreshCw size={13} /> Refresh</button>
        </div>
      </div>
      <div className="workspace-body">
        <div className="grid-2" style={{ marginBottom: 'var(--space-4)' }}>
          <div className="panel">
            <div className="panel-header"><h2>Synchronize</h2>{branch ? <span className="tag accent">{branch}</span> : <span className="tag amber">detached HEAD</span>}</div>
            <div className="panel-body stack" style={{ gap: 12 }}>
              <div className="row" style={{ gap: 8 }}>
                {head.ahead > 0 ? <span className="tag green"><ArrowUp size={9} />{head.ahead} to push</span> : null}
                {head.behind > 0 ? <span className="tag amber"><ArrowDown size={9} />{head.behind} to pull</span> : null}
                {head.upstream ? <span className="tag">upstream {head.upstream}</span> : <span className="tag amber">no upstream</span>}
              </div>
              <div className="btn-group">
                <button className="btn" disabled={Boolean(busy) || remotes.length === 0} onClick={() => void network('fetch', origin ?? undefined)}>{busy === 'Fetching…' ? <Spinner /> : <CloudDownload size={13} />} Fetch</button>
                <button className="btn" disabled={Boolean(busy) || remotes.length === 0} onClick={() => void network('pull', origin ?? undefined)} title="Fast-forward only to avoid silent merge commits">{busy === 'Pulling…' ? <Spinner /> : <CloudDownload size={13} />} Pull (ff-only)</button>
                <button className="btn primary" disabled={Boolean(busy) || remotes.length === 0 || !branch} onClick={() => void network('push', origin ?? undefined)}>{busy === 'Pushing…' ? <Spinner /> : <CloudUpload size={13} />} Push</button>
                <button className="btn" disabled={Boolean(busy) || !branch} onClick={() => setDialog('force-push')} title="Rewrite the remote branch only if it still matches your last fetch">Force push with lease</button>
              </div>
              {!head.upstream && branch ? <div className="banner info">No upstream configured. Git push will fail unless you enable upstream tracking when pushing. Use Branches → Set upstream.</div> : null}
              <div className="small muted">Pull uses <span className="inline-code">--ff-only</span> so it never creates an unexpected merge. If the branches diverged, merge or rebase deliberately.</div>
            </div>
          </div>
          <div className="panel">
            <div className="panel-header"><h2>Remote branches</h2></div>
            <div className="panel-body">
              {remotes.length === 0 ? <div className="small muted">No remotes configured. Add one to fetch, pull or push.</div> : null}
              {remotes.map((remote) => (
                <div key={remote.name} className="row" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', gap: 8 }}>
                  <Wifi size={13} style={{ color: 'var(--cyan)' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="small" style={{ fontWeight: 500 }}>{remote.name} <span className="tag">{remote.branches} refs</span></div>
                    <div className="mono small dim truncate" title={remote.fetchUrl}>{remote.fetchUrl}</div>
                  </div>
                  <button className="btn ghost icon" onClick={() => { setTarget(remote); setUrl(remote.fetchUrl); setDialog('edit'); }} title="Edit URL"><Pencil size={12} /></button>
                  <button className="btn ghost icon" onClick={() => { setTarget(remote); setDialog('remove'); }} title="Remove remote"><Trash2 size={12} /></button>
                  <button className="btn ghost icon" onClick={() => void network('fetch', remote)} title="Fetch this remote"><CloudDownload size={12} /></button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {loading ? <div className="loading-state"><Spinner /> Reading remotes…</div> : null}
        {!loading && remotes.length === 0 ? (
          <EmptyState icon={Link2} title="No remotes configured" description="A remote is required to fetch, pull, push or open pull requests. Add an HTTPS or SSH URL. Credentials are handled by Git, not stored by Git++." actions={<button className="btn primary" onClick={() => { setName('origin'); setUrl(''); setDialog('add'); }}><Plus size={13} /> Add a remote</button>} />
        ) : null}

        {remotes.length > 0 ? (
          <div className="panel">
            <div className="panel-header"><h2>Configured remotes</h2></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Name</th><th>Fetch URL</th><th>Push URL</th><th>Refs</th><th /></tr></thead>
                <tbody>
                  {remotes.map((remote) => (
                    <tr key={remote.name}>
                      <td className="mono">{remote.name}</td>
                      <td className="mono truncate" style={{ maxWidth: 380 }} title={remote.fetchUrl}>{remote.fetchUrl}</td>
                      <td className="mono truncate" style={{ maxWidth: 300 }} title={remote.pushUrl}>{remote.pushUrl}</td>
                      <td>{remote.branches}</td>
                      <td><div className="row-actions" style={{ opacity: 1 }}>
                        <button className="btn ghost icon" onClick={() => { setTarget(remote); setUrl(remote.fetchUrl); setDialog('edit'); }} title="Edit URL"><Pencil size={12} /></button>
                        <button className="btn ghost icon" onClick={() => { setTarget(remote); setDialog('remove'); }} title="Remove remote"><Trash2 size={12} /></button>
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {busy ? <div className="op-row" style={{ marginTop: 12 }}><Spinner /><span>{busy}</span><div className="spacer" /><span className="small dim">Network operations can take a while; output is bounded.</span></div> : null}
        <div style={{ height: 24 }} />
      </div>

      {dialog === 'add' ? (
        <Modal title="Add remote" onClose={() => setDialog(null)} width="narrow" footer={<><button className="btn ghost" onClick={() => setDialog(null)}>Cancel</button><button className="btn primary" disabled={!name.trim() || !url.trim()} onClick={() => void add()}>Add remote</button></>}>
          <Field label="Remote name" help="Conventionally origin."><input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="origin" spellCheck={false} autoFocus /></Field>
          <Field label="Remote URL" help="HTTPS or SSH. Git++ never stores your Git credentials."><input className="input" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://github.com/owner/repo.git" spellCheck={false} /></Field>
        </Modal>
      ) : null}

      {dialog === 'edit' && target ? (
        <Modal title={`Edit ${target.name}`} onClose={() => setDialog(null)} width="narrow" footer={<><button className="btn ghost" onClick={() => setDialog(null)}>Cancel</button><button className="btn primary" disabled={!url.trim()} onClick={() => void edit()}>Save URL</button></>}>
          <Field label="Remote URL"><input className="input" value={url} onChange={(event) => setUrl(event.target.value)} spellCheck={false} autoFocus /></Field>
          <div className="banner info">This changes the URL in <span className="inline-code">.git/config</span>, not the remote repository.</div>
        </Modal>
      ) : null}

      {dialog === 'remove' && target ? (
        <ConfirmDialog title={`Remove remote ${target.name}?`} description="This removes the remote configuration and its remote-tracking refs from this clone. The remote repository is not touched." confirmLabel="Remove remote" danger onClose={() => setDialog(null)} onConfirm={remove}
          consequences={[`Remote: ${target.name} (${target.fetchUrl}).`, 'Remote-tracking branches for this remote are removed locally.', 'Any existing branch upstream pointing at this remote stops resolving.']} />
      ) : null}

      {dialog === 'force-push' ? (
        <ConfirmDialog
          title="Force-push with lease?"
          description="This can rewrite the remote branch. Git++ uses --force-with-lease, which refuses if the remote moved since your last fetch."
          confirmLabel="Force-push"
          danger
          confirmPhrase={branch ?? 'push'}
          onClose={() => setDialog(null)}
          onConfirm={async () => { setDialog(null); await network('push', origin ?? undefined, true); }}
          consequences={[
            `Remote branch: ${origin?.name ?? 'origin'}/${branch ?? '?'}.`,
            'Commits that exist only on the remote can become unreachable.',
            'Anyone else working on this branch must reconcile their clone manually.',
            'The lease check protects against overwriting commits pushed after your last fetch; it is not a guarantee that the rewrite is safe.',
          ]}
        />
      ) : null}

      {output ? (
        <Modal title={output.title} description="Actual combined stdout/stderr from Git." onClose={() => setOutput(null)} width="wide" footer={<button className="btn" onClick={() => setOutput(null)}>Close</button>}>
          <pre className="run-output" style={{ maxHeight: '50vh' }}>{output.body}</pre>
        </Modal>
      ) : null}
    </div>
  );
}
