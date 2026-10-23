import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { AppInfo, AppEvent, DeepPartial, RecentRepo, RepoSnapshot, Settings } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/defaults';
import { ApiError, call, errorDetail, errorMessage, getBridge } from '../lib/api';
import type { WorkspaceId } from '../lib/navigation';

export type ToastLevel = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  level: ToastLevel;
  title: string;
  detail?: string;
}

interface AppContextValue {
  ready: boolean;
  bootError: string | null;
  info: AppInfo | null;
  settings: Settings;
  recents: RecentRepo[];
  snapshot: RepoSnapshot | null;
  workspace: WorkspaceId;
  setWorkspace: (workspace: WorkspaceId) => void;
  busyLabel: string | null;
  toasts: Toast[];
  toast: (level: ToastLevel, title: string, detail?: string) => void;
  dismissToast: (id: string) => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  openRepository: (path?: string) => Promise<boolean>;
  initRepository: (path?: string) => Promise<boolean>;
  cloneRepository: (url: string, destination: string, branch?: string) => Promise<boolean>;
  closeRepository: () => void;
  refresh: (quiet?: boolean) => Promise<void>;
  applySnapshot: (snapshot: RepoSnapshot) => void;
  runOperation: <T>(label: string, action: () => Promise<T>, options?: { success?: string | ((result: T) => string); refresh?: boolean; silentError?: boolean }) => Promise<T | null>;
  updateSettings: (patch: DeepPartial<Settings>) => Promise<boolean>;
  reloadRecents: () => Promise<void>;
  removeRecent: (path: string) => Promise<void>;
  pinRecent: (path: string, pinned: boolean) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

function newId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function AppProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [recents, setRecents] = useState<RecentRepo[]>([]);
  const [snapshot, setSnapshot] = useState<RepoSnapshot | null>(null);
  const [workspace, setWorkspaceState] = useState<WorkspaceId>(() => {
    const stored = localStorage.getItem('gitpp.workspace');
    return (stored as WorkspaceId) || 'home';
  });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const booted = useRef(false);
  const snapshotRef = useRef<RepoSnapshot | null>(null);
  const refreshing = useRef(false);
  const lastRefresh = useRef(0);

  const toast = useCallback((level: ToastLevel, title: string, detail?: string) => {
    const id = newId();
    setToasts((current) => [...current.slice(-4), { id, level, title, detail }]);
    if (level !== 'error') {
      window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), level === 'success' ? 4200 : 6500);
    }
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const setWorkspace = useCallback((next: WorkspaceId) => {
    setWorkspaceState(next);
    localStorage.setItem('gitpp.workspace', next);
  }, []);

  const applySnapshot = useCallback((next: RepoSnapshot) => {
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);

  const refresh = useCallback(async (quiet = false) => {
    const current = snapshotRef.current;
    if (!current || refreshing.current) return;
    refreshing.current = true;
    try {
      const next = await call('git.status', { repoPath: current.info.path });
      lastRefresh.current = Date.now();
      applySnapshot(next);
    } catch (error) {
      if (!quiet) {
        toast('error', 'Could not refresh the repository', errorDetail(error) ?? errorMessage(error));
      }
      if (error instanceof ApiError && (error.code === 'NOT_A_REPOSITORY' || error.code === 'NOT_FOUND' || error.code === 'IO_ERROR')) {
        setSnapshot(null);
        snapshotRef.current = null;
      }
    } finally {
      refreshing.current = false;
    }
  }, [applySnapshot, toast]);

  const reloadRecents = useCallback(async () => {
    try {
      setRecents(await call('recent.list', {}));
    } catch {
      // Recents are nice-to-have; a failure here should not block the app.
    }
  }, []);

  const loadRepository = useCallback(
    async (action: () => Promise<RepoSnapshot>, failureTitle: string): Promise<boolean> => {
      setBusyLabel('Opening repository…');
      try {
        const next = await action();
        applySnapshot(next);
        lastRefresh.current = Date.now();
        await reloadRecents();
        setWorkspace('changes');
        toast('success', `Opened ${next.info.name}`, `${next.info.head.branch ?? (next.info.head.detached ? 'detached HEAD' : 'unborn branch')} · ${next.files.length} changed path${next.files.length === 1 ? '' : 's'}`);
        return true;
      } catch (error) {
        toast('error', failureTitle, errorDetail(error) ?? errorMessage(error));
        return false;
      } finally {
        setBusyLabel(null);
      }
    },
    [applySnapshot, reloadRecents, setWorkspace, toast],
  );

  const openRepository = useCallback(
    async (path?: string): Promise<boolean> => {
      let target = path;
      if (!target) {
        try {
          const picked = await call('dialog.openDirectory', { title: 'Open a Git repository' });
          if (!picked.path) return false;
          target = picked.path;
        } catch (error) {
          toast('error', 'Could not open the folder picker', errorMessage(error));
          return false;
        }
      }
      return loadRepository(() => call('git.open', { path: target as string }), 'Could not open the repository');
    },
    [loadRepository, toast],
  );

  const initRepository = useCallback(
    async (path?: string): Promise<boolean> => {
      let target = path;
      if (!target) {
        try {
          const picked = await call('dialog.openDirectory', { title: 'Choose a folder to initialize' });
          if (!picked.path) return false;
          target = picked.path;
        } catch (error) {
          toast('error', 'Could not open the folder picker', errorMessage(error));
          return false;
        }
      }
      return loadRepository(() => call('git.init', { path: target as string }), 'Could not initialize the repository');
    },
    [loadRepository, toast],
  );

  const cloneRepository = useCallback(
    async (url: string, destination: string, branch?: string): Promise<boolean> => {
      return loadRepository(
        () => call('git.clone', { url, path: destination, ...(branch ? { branch } : {}) }),
        'Clone failed',
      );
    },
    [loadRepository],
  );

  const closeRepository = useCallback(() => {
    setSnapshot(null);
    snapshotRef.current = null;
    setWorkspace('home');
  }, [setWorkspace]);

  const runOperation = useCallback(
    async <T,>(
      label: string,
      action: () => Promise<T>,
      options: { success?: string | ((result: T) => string); refresh?: boolean; silentError?: boolean } = {},
    ): Promise<T | null> => {
      setBusyLabel(label);
      try {
        const result = await action();
        if (result && typeof result === 'object' && 'info' in result && 'files' in result) {
          applySnapshot(result as unknown as RepoSnapshot);
        } else if (options.refresh !== false && snapshotRef.current) {
          await refresh(true);
        }
        if (options.success) {
          toast('success', typeof options.success === 'function' ? options.success(result) : options.success);
        }
        return result;
      } catch (error) {
        if (!options.silentError) {
          toast('error', label, errorDetail(error) ?? errorMessage(error));
        }
        return null;
      } finally {
        setBusyLabel(null);
      }
    },
    [applySnapshot, refresh, toast],
  );

  const updateSettings = useCallback(
    async (patch: DeepPartial<Settings>): Promise<boolean> => {
      try {
        const next = await call('settings.update', { patch: patch as Partial<Settings> });
        setSettings(next);
        return true;
      } catch (error) {
        toast('error', 'Could not save settings', errorDetail(error) ?? errorMessage(error));
        return false;
      }
    },
    [toast],
  );

  const removeRecent = useCallback(
    async (path: string) => {
      try {
        setRecents(await call('recent.remove', { path }));
        toast('info', 'Removed from recent repositories', 'The folder on disk was not touched.');
      } catch (error) {
        toast('error', 'Could not update recent repositories', errorMessage(error));
      }
    },
    [toast],
  );

  const pinRecent = useCallback(
    async (path: string, pinned: boolean) => {
      try {
        setRecents(await call('recent.pin', { path, pinned }));
      } catch (error) {
        toast('error', 'Could not update pinned repositories', errorMessage(error));
      }
    },
    [toast],
  );

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void (async () => {
      try {
        const [appInfo, appSettings, recentRepos] = await Promise.all([
          call('app.info', {}),
          call('settings.get', {}),
          call('recent.list', {}),
        ]);
        setInfo(appInfo);
        setSettings(appSettings);
        setRecents(recentRepos);
        if (window.gitpp?.startup) {
          const startup = await window.gitpp.startup();
          for (const warning of startup.warnings) toast('warning', 'Startup notice', warning);
        }
        const candidate = recentRepos[0];
        if (appInfo.git.available && candidate) {
          try {
            const next = await call('git.open', { path: candidate.path });
            applySnapshot(next);
            lastRefresh.current = Date.now();
          } catch (error) {
            toast('warning', `Could not reopen ${candidate.name}`, errorDetail(error) ?? errorMessage(error));
            await reloadRecents();
          }
        }
      } catch (error) {
        setBootError(errorDetail(error) ?? errorMessage(error));
      } finally {
        setReady(true);
      }
    })();
  }, [applySnapshot, reloadRecents, toast]);

  useEffect(() => {
    const bridge = window.gitpp;
    if (!bridge) return undefined;
    const unsubscribe = bridge.onEvent((event: AppEvent) => {
      if (event.type === 'repo-changed') {
        if (snapshotRef.current?.info.path === event.repoPath) void refresh(true);
      } else if (event.type === 'toast') {
        toast(event.level, event.message);
      }
    });
    return unsubscribe;
  }, [refresh, toast]);

  useEffect(() => {
    const onFocus = () => {
      if (Date.now() - lastRefresh.current > 8000) void refresh(true);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  useEffect(() => {
    if (!snapshot) return undefined;
    const timer = window.setInterval(() => {
      if (!document.hidden && !busyLabel) void refresh(true);
    }, 25_000);
    return () => window.clearInterval(timer);
  }, [snapshot, busyLabel, refresh]);

  useEffect(() => {
    const effective = settings.theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : settings.theme;
    document.documentElement.dataset.theme = effective;
    document.documentElement.style.setProperty('--settings-editor-font', `${settings.editor.fontSize}px`);
    document.documentElement.style.setProperty('--settings-editor-family', settings.editor.fontFamily);
  }, [settings]);

  useEffect(() => {
    const bridge = window.gitpp;
    if (!bridge?.onMenuCommand) return undefined;
    return bridge.onMenuCommand((command) => {
      if (command === 'command-palette') setPaletteOpen(true);
      else if (command === 'open-repository') void openRepository();
      else if (command === 'refresh') void refresh();
      else if (command === 'open-settings') setWorkspace('settings');
      else if (command === 'nav-changes') setWorkspace('changes');
      else if (command === 'nav-history') setWorkspace('history');
      else if (command === 'nav-branches') setWorkspace('branches');
    });
  }, [openRepository, refresh, setWorkspace]);

  useEffect(() => {
    try {
      snapshotRef.current = snapshot;
    } catch {
      // ignore
    }
  }, [snapshot]);

  const value = useMemo<AppContextValue>(
    () => ({
      ready,
      bootError,
      info,
      settings,
      recents,
      snapshot,
      workspace,
      setWorkspace,
      busyLabel,
      toasts,
      toast,
      dismissToast,
      paletteOpen,
      setPaletteOpen,
      openRepository,
      initRepository,
      cloneRepository,
      closeRepository,
      refresh,
      applySnapshot,
      runOperation,
      updateSettings,
      reloadRecents,
      removeRecent,
      pinRecent,
    }),
    [
      ready, bootError, info, settings, recents, snapshot, workspace, setWorkspace, busyLabel, toasts, toast,
      dismissToast, paletteOpen, openRepository, initRepository, cloneRepository, closeRepository, refresh,
      applySnapshot, runOperation, updateSettings, reloadRecents, removeRecent, pinRecent,
    ],
  );

  void getBridge;

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}
