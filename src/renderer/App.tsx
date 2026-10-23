import React, { useEffect, useState } from 'react';
import { AlertTriangle, CloudDownload, FolderGit2, FolderPlus } from 'lucide-react';
import { useApp } from './state/AppState';
import { TitleBar, Sidebar, StatusBar } from './components/Chrome';
import { CommandPalette } from './components/CommandPalette';
import { Logo, Spinner, Toasts } from './components/ui';
import { HomeWorkspace } from './workspaces/HomeWorkspace';
import { ChangesWorkspace } from './workspaces/ChangesWorkspace';
import { HistoryWorkspace } from './workspaces/HistoryWorkspace';
import { BranchesWorkspace } from './workspaces/BranchesWorkspace';
import { RemotesWorkspace } from './workspaces/RemotesWorkspace';
import { WorktreesWorkspace } from './workspaces/WorktreesWorkspace';
import { StashesWorkspace } from './workspaces/StashesWorkspace';
import { PreflightWorkspace } from './workspaces/PreflightWorkspace';
import { MarkdownWorkspace } from './workspaces/MarkdownWorkspace';
import { IgnoreWorkspace } from './workspaces/IgnoreWorkspace';
import { GithubWorkspace } from './workspaces/GithubWorkspace';
import { ReleaseWorkspace } from './workspaces/ReleaseWorkspace';
import { SettingsWorkspace } from './workspaces/SettingsWorkspace';
import { Field, Modal } from './components/ui';
import { call } from './lib/api';
import { joinPath } from './lib/utils';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="workspace">
          <div className="workspace-body">
            <div className="banner danger">
              <AlertTriangle size={16} />
              <div>
                <strong>The interface hit an unexpected error.</strong>
                <div className="small">{this.state.error.message}</div>
                <div className="row" style={{ marginTop: 8, gap: 6 }}>
                  <button className="btn sm" onClick={() => window.location.reload()}>Reload interface</button>
                  <button className="btn sm ghost" onClick={() => this.setState({ error: null })}>Try to continue</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function shortcutMatches(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.toLowerCase().split('+').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return false;
  const key = parts[parts.length - 1] ?? '';
  const wantsCtrl = parts.includes('ctrl') || parts.includes('control') || parts.includes('cmd') || parts.includes('meta');
  const wantsShift = parts.includes('shift');
  const wantsAlt = parts.includes('alt');
  if (wantsCtrl !== (event.ctrlKey || event.metaKey)) return false;
  if (wantsShift !== event.shiftKey) return false;
  if (wantsAlt !== event.altKey) return false;
  const eventKey = event.key.toLowerCase();
  if (key === 'space') return eventKey === ' ';
  return eventKey === key;
}

function WorkspaceRouter(): React.JSX.Element {
  const { workspace } = useApp();
  switch (workspace) {
    case 'changes': return <ChangesWorkspace />;
    case 'history': return <HistoryWorkspace />;
    case 'branches': return <BranchesWorkspace />;
    case 'remotes': return <RemotesWorkspace />;
    case 'worktrees': return <WorktreesWorkspace />;
    case 'stashes': return <StashesWorkspace />;
    case 'preflight': return <PreflightWorkspace />;
    case 'markdown': return <MarkdownWorkspace />;
    case 'ignore': return <IgnoreWorkspace />;
    case 'github': return <GithubWorkspace />;
    case 'release': return <ReleaseWorkspace />;
    case 'settings': return <SettingsWorkspace />;
    default: return <HomeWorkspace />;
  }
}

function CloneDialog({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element | null {
  const { cloneRepository, info } = useApp();
  const [url, setUrl] = useState('');
  const [destination, setDestination] = useState('');
  const [branch, setBranch] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const choose = async () => {
    try {
      const result = await call('dialog.openDirectory', { title: 'Choose a folder for the clone' });
      if (result.path) {
        const name = url.trim().replace(/\.git$/, '').split(/[/:]/).filter(Boolean).pop() ?? 'repository';
        setDestination(joinPath(result.path, name));
      }
    } catch {
      // The picker is optional; the user can type a path.
    }
  };

  const clone = async () => {
    if (!url.trim() || !destination.trim()) return;
    setBusy(true);
    const success = await cloneRepository(url.trim(), destination.trim(), branch.trim() || undefined);
    setBusy(false);
    if (success) {
      setUrl('');
      setDestination('');
      setBranch('');
      onClose();
    }
  };

  return (
    <Modal
      title="Clone a repository"
      description="Runs a real `git clone`. Authentication is handled by your Git credential helper."
      onClose={onClose}
      footer={<><span className="modal-note">{info?.platform === 'win32' ? 'Windows paths are supported.' : ''}</span><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !url.trim() || !destination.trim()} onClick={() => void clone()}>{busy ? <Spinner /> : <CloudDownload size={13} />} Clone</button></>}
    >
      <Field label="Repository URL" help="HTTPS or SSH. Local folder paths are intentionally not accepted here.">
        <input className="input mono" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://github.com/owner/repo.git" spellCheck={false} autoFocus />
      </Field>
      <Field label="Destination folder" help="The target must not exist, or must be empty.">
        <div className="row" style={{ gap: 6 }}>
          <input className="input mono" value={destination} onChange={(event) => setDestination(event.target.value)} placeholder={info?.platform === 'win32' ? 'C:\\Users\\you\\source\\repo' : '/home/you/source/repo'} spellCheck={false} />
          <button className="btn" onClick={() => void choose()}><FolderPlus size={12} /> Browse</button>
        </div>
      </Field>
      <Field label="Branch (optional)" help="Leave empty to use the remote default branch.">
        <input className="input mono" value={branch} onChange={(event) => setBranch(event.target.value)} spellCheck={false} />
      </Field>
      <div className="banner info"><FolderGit2 size={14} /> Cloning can take a while for large repositories. Output is bounded, and failures are shown with Git’s real error.</div>
    </Modal>
  );
}


export function App(): React.JSX.Element {
  const { ready, bootError, settings, setPaletteOpen, openRepository, refresh, setWorkspace, snapshot, closeRepository } = useApp();
  const [cloneOpen, setCloneOpen] = useState(false);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (typeof detail === 'string' && detail === 'clone-repository') setCloneOpen(true);
    };
    window.addEventListener('gitpp:action', handler);
    return () => window.removeEventListener('gitpp:action', handler);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setPaletteOpen(false); return; }
      if (shortcutMatches(event, settings.shortcuts.commandPalette)) { event.preventDefault(); setPaletteOpen(true); return; }
      if (shortcutMatches(event, settings.shortcuts.openRepo)) { event.preventDefault(); void openRepository(); return; }
      if (shortcutMatches(event, settings.shortcuts.refresh)) { event.preventDefault(); void refresh(); return; }
      if (shortcutMatches(event, settings.shortcuts.commit)) {
        event.preventDefault();
        setWorkspace('changes');
        window.setTimeout(() => window.dispatchEvent(new CustomEvent('gitpp:action', { detail: 'focus-commit' })), 60);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) {
        if (event.key === '1') { event.preventDefault(); setWorkspace('changes'); }
        else if (event.key === '2') { event.preventDefault(); setWorkspace('history'); }
        else if (event.key === '3') { event.preventDefault(); setWorkspace('branches'); }
        else if (event.key === ',') { event.preventDefault(); setWorkspace('settings'); }
        else if (event.key.toLowerCase() === 'w' && snapshot) { event.preventDefault(); closeRepository(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settings.shortcuts, setPaletteOpen, openRepository, refresh, setWorkspace, snapshot, closeRepository]);

  if (!ready) {
    return (
      <div className="app-shell" style={{ gridTemplateRows: '1fr' }}>
        <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <Logo size={56} />
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600 }}>Git<span style={{ color: 'var(--accent)' }}>++</span></div>
            <div className="small muted">Starting the real Git engine…</div>
            <Spinner />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <TitleBar />
      <div className="workspace-shell">
        <Sidebar />
        <main className="main-area">
          {bootError ? (
            <div style={{ padding: 20 }}>
              <div className="banner danger"><AlertTriangle size={16} /><div><strong>Git++ could not finish starting.</strong><div className="small">{bootError}</div><button className="btn sm" style={{ marginTop: 8 }} onClick={() => window.location.reload()}>Retry</button></div></div>
            </div>
          ) : null}
          <ErrorBoundary><WorkspaceRouter /></ErrorBoundary>
        </main>
      </div>
      <StatusBar />
      <CommandPalette />
      <CloneDialog open={cloneOpen} onClose={() => setCloneOpen(false)} />
      <Toasts />
    </div>
  );
}
