import {
  Archive, BookMarked, Boxes, CircleDot, FileCode2, GitBranch, GitCompareArrows, Github, History,
  Home, Rocket, Settings as SettingsIcon, ShieldCheck, SlidersHorizontal, Sparkles,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type WorkspaceId =
  | 'home'
  | 'changes'
  | 'history'
  | 'branches'
  | 'remotes'
  | 'worktrees'
  | 'stashes'
  | 'preflight'
  | 'markdown'
  | 'ignore'
  | 'github'
  | 'release'
  | 'settings';

export interface WorkspaceDefinition {
  id: WorkspaceId;
  label: string;
  icon: LucideIcon;
  description: string;
  group: 'workspace' | 'tools';
  shortcut?: string;
}

export const WORKSPACES: WorkspaceDefinition[] = [
  { id: 'home', label: 'Home', icon: Home, description: 'Repository overview and recent activity', group: 'workspace' },
  { id: 'changes', label: 'Changes', icon: GitCompareArrows, description: 'Working tree, staging, diffs and commits', group: 'workspace', shortcut: 'Ctrl+1' },
  { id: 'history', label: 'History', icon: History, description: 'Commit graph, archaeology and comparisons', group: 'workspace', shortcut: 'Ctrl+2' },
  { id: 'branches', label: 'Branches', icon: GitBranch, description: 'Local and remote branches, merge and rebase', group: 'workspace', shortcut: 'Ctrl+3' },
  { id: 'remotes', label: 'Remotes', icon: CircleDot, description: 'Fetch, pull, push and remote configuration', group: 'workspace' },
  { id: 'worktrees', label: 'Parallel Universes', icon: Boxes, description: 'Work on several branches at the same time', group: 'workspace' },
  { id: 'stashes', label: 'Stashes', icon: Archive, description: 'Saved working states', group: 'workspace' },
  { id: 'preflight', label: 'Preflight Lab', icon: ShieldCheck, description: 'Real checks before you commit or release', group: 'tools' },
  { id: 'markdown', label: 'Markdown Studio', icon: FileCode2, description: 'Edit and preview repository documents', group: 'tools' },
  { id: 'ignore', label: 'Ignore Studio', icon: SlidersHorizontal, description: 'Edit .gitignore with templates and checks', group: 'tools' },
  { id: 'github', label: 'GitHub', icon: Github, description: 'Pull requests, issues, releases and workflows', group: 'tools' },
  { id: 'release', label: 'Release Manager', icon: Rocket, description: 'Prepare release notes and tags from real history', group: 'tools' },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, description: 'Preferences, integrations and privacy', group: 'tools' },
];

export const WORKSPACE_MAP = new Map(WORKSPACES.map((workspace) => [workspace.id, workspace]));

export const NAV_ICONS = { BookMarked, Sparkles };
