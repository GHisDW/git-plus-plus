import React from 'react';
import {
  ArrowDown, ArrowUp, Boxes, ChevronDown, Command, FolderGit2, GitBranch, Maximize2, Minimize2, Moon,
  PanelLeftClose, Plus, RefreshCw, Search, Settings as SettingsIcon, Sun, X, GitCommitHorizontal, AlertTriangle,
} from 'lucide-react';
import { useApp } from '../state/AppState';
import { BrandWordmark, Logo } from './ui';
import { cx } from '../lib/utils';
import { WORKSPACES } from '../lib/navigation';

export function TitleBar(): React.JSX.Element {
  const { snapshot, settings, updateSettings, setPaletteOpen, openRepository } = useApp();
  const bridgeWindow = window.gitpp?.window;
  const [maximized, setMaximized] = React.useState(false);

  React.useEffect(() => {
    if (!bridgeWindow) return undefined;
    void bridgeWindow.isMaximized?.().then((result) => setMaximized(result?.maximized ?? false));
    return bridgeWindow.onMaximized?.(setMaximized);
  }, [bridgeWindow]);

  const toggleTheme = () => {
    const next = settings.theme === 'dark' ? 'light' : 'dark';
    void updateSettings({ theme: next });
  };

  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <span className="brand-mark"><Logo size={22} /></span>
        <BrandWordmark />
      </div>
      {snapshot ? (
        <button className="titlebar-repo" onClick={() => openRepository()} title="Open another repository">
          <FolderGit2 size={13} />
          <span className="repo-name">{snapshot.info.name}</span>
          <span className="branch-chip">
            {snapshot.info.head.detached ? 'detached' : snapshot.info.head.branch ?? 'unborn'}
          </span>
          <ChevronDown size={12} />
        </button>
      ) : null}
      <div className="titlebar-spacer" />
      <button className="titlebar-action" onClick={() => setPaletteOpen(true)} title="Command palette (Ctrl+K)">
        <Search size={13} />
        <span>Commands</span>
        <span className="kbd">{settings.shortcuts.commandPalette}</span>
      </button>
      <button className="titlebar-action" onClick={toggleTheme} title={settings.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
        {settings.theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
      </button>
      {bridgeWindow?.minimize ? (
        <div className="window-controls">
          <button onClick={() => void bridgeWindow.minimize()} aria-label="Minimize"><Minimize2 size={14} /></button>
          <button onClick={() => void bridgeWindow.maximize().then((result) => setMaximized(result.maximized))} aria-label={maximized ? 'Restore' : 'Maximize'}>
            <Maximize2 size={12} />
          </button>
          <button className="close" onClick={() => void bridgeWindow.close()} aria-label="Close"><X size={15} /></button>
        </div>
      ) : null}
    </header>
  );
}

export function Sidebar(): React.JSX.Element {
  const { workspace, setWorkspace, snapshot, recents, openRepository, initRepository, settings, refresh, busyLabel } = useApp();
  const workspaceItems = WORKSPACES.filter((entry) => entry.group === 'workspace');
  const toolItems = WORKSPACES.filter((entry) => entry.group === 'tools');
  const conflicts = snapshot?.stats.conflicted ?? 0;
  const changes = (snapshot?.stats.staged ?? 0) + (snapshot?.stats.unstaged ?? 0) + (snapshot?.stats.untracked ?? 0);

  const badgeFor = (id: string): React.ReactNode => {
    if (id === 'changes' && changes > 0) return <span className={cx('nav-badge', conflicts > 0 && 'alert')}>{conflicts > 0 ? `${conflicts} !` : changes}</span>;
    if (id === 'worktrees') return <span className="nav-badge"><Boxes size={9} /></span>;
    return null;
  };

  return (
    <aside className="sidebar">
      {snapshot ? (
        <div className="sidebar-repo">
          <div className="sidebar-repo-name">
            <FolderGit2 size={13} />
            <span className="truncate">{snapshot.info.name}</span>
          </div>
          <div className="sidebar-repo-meta">
            <GitBranch size={10} style={{ verticalAlign: -1 }} />{' '}
            {snapshot.info.head.detached ? 'detached HEAD' : snapshot.info.head.branch ?? 'unborn branch'}
          </div>
          <div className="row" style={{ marginTop: 6, gap: 6 }}>
            {snapshot.info.head.ahead > 0 ? <span className="tag accent"><ArrowUp size={9} />{snapshot.info.head.ahead}</span> : null}
            {snapshot.info.head.behind > 0 ? <span className="tag amber"><ArrowDown size={9} />{snapshot.info.head.behind}</span> : null}
            {conflicts > 0 ? <span className="tag red"><AlertTriangle size={9} />{conflicts} conflict{conflicts === 1 ? '' : 's'}</span> : null}
            {snapshot.info.identity.name === null || snapshot.info.identity.email === null ? (
              <span className="tag amber" title="Git commits will fail until user.name and user.email are configured">identity</span>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="sidebar-repo">
          <div className="sidebar-repo-name"><GitBranch size={13} /> No repository</div>
          <div className="sidebar-repo-meta">Open one to begin</div>
          <button className="btn sm primary" style={{ marginTop: 8, width: '100%' }} onClick={() => void openRepository()}>
            <Plus size={12} /> Open repository
          </button>
        </div>
      )}

      <div className="sidebar-section-label">Workspace</div>
      <nav className="nav-list" aria-label="Workspace">
        {workspaceItems.map((entry) => {
          const Icon = entry.icon;
          return (
            <button
              key={entry.id}
              className={cx('nav-item', workspace === entry.id && 'active')}
              onClick={() => setWorkspace(entry.id)}
              title={`${entry.description}${entry.shortcut ? ` (${entry.shortcut})` : ''}`}
            >
              <Icon size={15} strokeWidth={1.9} />
              <span className="nav-label">{entry.label}</span>
              {badgeFor(entry.id)}
            </button>
          );
        })}
      </nav>
      <div className="sidebar-section-label">Tools</div>
      <nav className="nav-list" aria-label="Tools">
        {toolItems.map((entry) => {
          const Icon = entry.icon;
          return (
            <button
              key={entry.id}
              className={cx('nav-item', workspace === entry.id && 'active')}
              onClick={() => setWorkspace(entry.id)}
              title={entry.description}
            >
              <Icon size={15} strokeWidth={1.9} />
              <span className="nav-label">{entry.label}</span>
              {entry.id === 'github' && !settings.github.hasToken ? <span className="nav-badge">setup</span> : null}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-spacer" />
      {snapshot ? (
        <div className="sidebar-footer">
          <button className="sidebar-foot-button" onClick={() => void refresh()} disabled={Boolean(busyLabel)}>
            <RefreshCw size={13} className={cx(busyLabel === 'Refreshing…' && 'spinner')} /> Refresh status
          </button>
          <button className="sidebar-foot-button" onClick={() => void openRepository()}>
            <FolderGit2 size={13} /> Switch repository
          </button>
          <button className="sidebar-foot-button" onClick={() => setWorkspace('settings')}>
            <SettingsIcon size={13} /> Settings
          </button>
        </div>
      ) : (
        <div className="sidebar-footer">
          <button className="sidebar-foot-button" onClick={() => void initRepository()}>
            <GitCommitHorizontal size={13} /> Initialize repository
          </button>
          <button className="sidebar-foot-button" onClick={() => setWorkspace('settings')}>
            <SettingsIcon size={13} /> Settings
          </button>
          {recents.length > 0 ? <div className="sidebar-repo-meta" style={{ padding: '4px 10px' }}>{recents.length} recent repositories</div> : null}
        </div>
      )}
    </aside>
  );
}

export function StatusBar(): React.JSX.Element {
  const { snapshot, info, settings, busyLabel } = useApp();
  const gitOk = info?.git.available ?? false;
  return (
    <footer className="statusbar">
      <span className="item" title={info?.git.path ?? 'git'}>
        <span className={cx('status-dot', gitOk ? 'good' : 'bad')} />
        {gitOk ? `git ${info?.git.version ?? ''}` : 'git not found'}
      </span>
      {snapshot ? (
        <>
          <span className="item">
            <GitBranch size={11} />
            {snapshot.info.head.detached ? `detached @ ${snapshot.info.head.oid?.slice(0, 7) ?? '?'}` : snapshot.info.head.branch ?? 'unborn'}
          </span>
          <span className="item">{snapshot.stats.staged} staged · {snapshot.stats.unstaged} unstaged · {snapshot.stats.untracked} untracked</span>
          {snapshot.stats.conflicted > 0 ? <span className="item" style={{ color: 'var(--red)' }}><AlertTriangle size={11} /> {snapshot.stats.conflicted} conflicts</span> : null}
        </>
      ) : (
        <span className="item">No repository open</span>
      )}
      <span className="spacer" />
      {busyLabel ? <span className="item">{busyLabel}</span> : null}
      {snapshot ? <span className="item" title={snapshot.info.path}>{snapshot.info.path}</span> : null}
      <span className="item"><Command size={11} /> {settings.shortcuts.commandPalette}</span>
    </footer>
  );
}

void PanelLeftClose;
