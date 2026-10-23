import type { Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  gitPath: 'git',
  defaultRepoDir: '',
  diff: { mode: 'unified', context: 3, ignoreWhitespace: false, wrap: false },
  editor: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 13, tabSize: 2 },
  notifications: { enabled: true, operationToasts: true },
  privacy: { sendDiagnostics: false, logLevel: 'info' },
  ai: { enabled: false, baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', hasKey: false, consent: false },
  preflight: { defaultTimeoutMs: 180_000, defaultTrustCommands: false },
  shortcuts: { commandPalette: 'Ctrl+K', refresh: 'Ctrl+R', commit: 'Ctrl+Enter', openRepo: 'Ctrl+O', search: 'Ctrl+F' },
  github: { hasToken: false, apiBase: 'https://api.github.com' },
};
