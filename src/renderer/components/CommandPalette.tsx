import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive, ArrowRightLeft, ArrowUpRight, Boxes, FileCode2, FolderGit2, FolderPlus, GitBranch, GitCommitHorizontal,
  GitCompareArrows, Github, History, Home, Rocket, Search, Settings as SettingsIcon, ShieldCheck, Sun, Moon,
  RefreshCw, Trash2, SlidersHorizontal, Terminal, FilePlus2, CloudDownload, CloudUpload,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useApp } from '../state/AppState';
import { call, errorMessage } from '../lib/api';
import { cx } from '../lib/utils';
import { WORKSPACES, type WorkspaceId } from '../lib/navigation';

interface Command {
  id: string;
  label: string;
  group: string;
  icon: LucideIcon;
  hint?: string;
  keywords?: string;
  requiresRepo?: boolean;
  run: () => void | Promise<void>;
}

function dispatch(action: string): void {
  window.dispatchEvent(new CustomEvent('gitpp:action', { detail: action }));
}

export function CommandPalette(): React.JSX.Element | null {
  const {
    paletteOpen, setPaletteOpen, setWorkspace, snapshot, openRepository, initRepository, refresh,
    recents, settings, updateSettings, runOperation, closeRepository, toast,
  } = useApp();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (paletteOpen) {
      setQuery('');
      setSelected(0);
      window.setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [paletteOpen]);

  const navigate = (id: WorkspaceId) => setWorkspace(id);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      { id: 'open', label: 'Open repository…', group: 'Repository', icon: FolderGit2, hint: settings.shortcuts.openRepo, keywords: 'folder project', run: () => void openRepository() },
      { id: 'init', label: 'Initialize repository…', group: 'Repository', icon: FolderPlus, run: () => void initRepository() },
      { id: 'clone', label: 'Clone repository…', group: 'Repository', icon: CloudDownload, requiresRepo: false, run: () => dispatch('clone-repository') },
      { id: 'refresh', label: 'Refresh repository status', group: 'Repository', icon: RefreshCw, hint: settings.shortcuts.refresh, requiresRepo: true, run: () => void refresh() },
      { id: 'close', label: 'Close repository', group: 'Repository', icon: FolderGit2, requiresRepo: true, run: () => { closeRepository(); toast('info', 'Repository closed', 'The folder on disk was not modified.'); } },
      { id: 'commit', label: 'Commit staged changes', group: 'Git', icon: GitCommitHorizontal, hint: settings.shortcuts.commit, requiresRepo: true, run: () => { navigate('changes'); dispatch('focus-commit'); } },
      { id: 'branch', label: 'Create or switch branch', group: 'Git', icon: GitBranch, requiresRepo: true, run: () => { navigate('branches'); dispatch('new-branch'); } },
      { id: 'stash', label: 'Stash working changes', group: 'Git', icon: Archive, requiresRepo: true, run: () => { navigate('stashes'); dispatch('new-stash'); } },
      { id: 'fetch', label: 'Fetch from remote', group: 'Git', icon: CloudDownload, requiresRepo: true, run: () => void runOperation('Fetching…', () => call('git.fetch', { repoPath: snapshot?.info.path ?? '' }), { success: 'Fetch completed' }) },
      { id: 'pull', label: 'Pull (fast-forward only)', group: 'Git', icon: CloudDownload, requiresRepo: true, run: () => void runOperation('Pulling…', () => call('git.pull', { repoPath: snapshot?.info.path ?? '' }), { success: 'Pull completed' }) },
      { id: 'push', label: 'Push current branch', group: 'Git', icon: CloudUpload, requiresRepo: true, run: () => void runOperation('Pushing…', () => call('git.push', { repoPath: snapshot?.info.path ?? '' }), { success: 'Push completed' }) },
      { id: 'worktree', label: 'Create a worktree', group: 'Workspaces', icon: Boxes, requiresRepo: true, run: () => { navigate('worktrees'); dispatch('new-worktree'); } },
      { id: 'preflight', label: 'Run Preflight checks', group: 'Workspaces', icon: ShieldCheck, requiresRepo: true, run: () => { navigate('preflight'); dispatch('run-preflight'); } },
      { id: 'markdown', label: 'New Markdown document', group: 'Workspaces', icon: FilePlus2, requiresRepo: true, run: () => { navigate('markdown'); dispatch('new-markdown'); } },
      { id: 'ignore', label: 'Open .gitignore Studio', group: 'Workspaces', icon: SlidersHorizontal, requiresRepo: true, run: () => navigate('ignore') },
      { id: 'release', label: 'Prepare a release', group: 'Workspaces', icon: Rocket, requiresRepo: true, run: () => navigate('release') },
      { id: 'github', label: 'Open GitHub workspace', group: 'Workspaces', icon: Github, requiresRepo: true, run: () => navigate('github') },
      { id: 'theme', label: settings.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', group: 'Application', icon: settings.theme === 'dark' ? Sun : Moon, run: () => void updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' }) },
      { id: 'settings', label: 'Open settings', group: 'Application', icon: SettingsIcon, run: () => navigate('settings') },
      { id: 'ai', label: 'Configure AI assistance', group: 'Application', icon: Terminal, run: () => { navigate('settings'); dispatch('open-ai-settings'); } },
    ];
    for (const workspace of WORKSPACES) {
      if (!list.some((command) => command.id === `nav-${workspace.id}`)) {
        list.push({
          id: `nav-${workspace.id}`,
          label: `Go to ${workspace.label}`,
          group: 'Navigate',
          icon: workspace.icon,
          hint: workspace.shortcut,
          keywords: workspace.description,
          run: () => navigate(workspace.id),
        });
      }
    }
    return list;
  }, [openRepository, initRepository, refresh, closeRepository, toast, snapshot, settings, updateSettings, setWorkspace]);

  const items = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const commandItems = commands
      .filter((command) => {
        if (command.requiresRepo && !snapshot) return false;
        if (!normalized) return true;
        return `${command.label} ${command.group} ${command.keywords ?? ''}`.toLowerCase().includes(normalized);
      })
      .map((command) => ({ kind: 'command' as const, command }));
    const repoItems = recents
      .filter((repo) => !normalized || `${repo.name} ${repo.path}`.toLowerCase().includes(normalized))
      .slice(0, 6)
      .map((repo) => ({ kind: 'repo' as const, repo }));
    return [...commandItems, ...repoItems];
  }, [commands, query, recents, snapshot]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    if (!paletteOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPaletteOpen(false);
      else if (event.key === 'ArrowDown') { event.preventDefault(); setSelected((current) => Math.min(current + 1, items.length - 1)); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); setSelected((current) => Math.max(current - 1, 0)); }
      else if (event.key === 'Enter') {
        event.preventDefault();
        const item = items[selected];
        if (!item) return;
        setPaletteOpen(false);
        if (item.kind === 'command') void item.command.run();
        else void openRepository(item.repo.path);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, items, selected, setPaletteOpen, openRepository]);

  if (!paletteOpen) return null;

  let lastGroup = '';
  return (
    <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPaletteOpen(false); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-input-row">
          <Search size={16} style={{ color: 'var(--text-muted)' }} />
          <input
            ref={inputRef}
            className="palette-input"
            placeholder="Search commands, workspaces or recent repositories…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            spellCheck={false}
          />
          <span className="kbd">Esc</span>
        </div>
        <div className="palette-list">
          {items.length === 0 ? <div className="palette-empty">No matching commands.</div> : null}
          {items.map((item, index) => {
            const group = item.kind === 'repo' ? 'Recent repositories' : lastGroup !== item.command.group ? item.command.group : '';
            if (item.kind === 'command') lastGroup = item.command.group;
            return (
              <React.Fragment key={item.kind === 'command' ? item.command.id : item.repo.path}>
                {group ? <div className="palette-group-label">{group}</div> : null}
                <button
                  className={cx('palette-item', index === selected && 'selected')}
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => {
                    setPaletteOpen(false);
                    if (item.kind === 'command') void item.command.run();
                    else void openRepository(item.repo.path);
                  }}
                >
                  <PaletteItemIcon item={item} />
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.kind === 'command' ? item.command.label : item.repo.name}
                    {item.kind === 'repo' ? <span className="palette-hint mono" style={{ marginLeft: 8 }}>{item.repo.path}</span> : null}
                  </span>
                  {item.kind === 'command' && item.command.hint ? <span className="palette-hint"><span className="kbd">{item.command.hint}</span></span> : null}
                  {item.kind === 'repo' ? <ArrowUpRight size={13} /> : null}
                </button>
              </React.Fragment>
            );
          })}
        </div>
        <div className="palette-footer">
          <span>↑↓ navigate</span><span>↵ run</span><span>Esc close</span>
          <span style={{ marginLeft: 'auto' }}>Actions use the same real Git operations as the interface.</span>
        </div>
      </div>
    </div>
  );
}

function PaletteItemIcon({ item }: { item: { kind: 'command'; command: Command } | { kind: 'repo'; repo: { name: string } } }): React.JSX.Element {
  if (item.kind === 'command') {
    const Icon = item.command.icon;
    return <Icon size={14} />;
  }
  return <History size={14} />;
}

void Archive; void ArrowRightLeft; void FileCode2; void GitCompareArrows; void Home; void Trash2; void errorMessage;
