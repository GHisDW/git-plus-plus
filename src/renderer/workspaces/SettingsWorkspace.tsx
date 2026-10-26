import React, { useEffect, useState } from 'react';
import {
  AlertTriangle, Bell, BrainCircuit, Check, ChevronRight, Cpu, FolderOpen, Github, KeyRound, Keyboard,
  Monitor, Moon, Palette, Plus, RefreshCw, RotateCcw, Shield, Sun, Terminal, Trash2, User, Wand2, X,
} from 'lucide-react';
import type { AiSettings, ConfigEntry } from '../../shared/types';
import { call, errorDetail, errorMessage } from '../lib/api';
import { useApp } from '../state/AppState';
import { cx } from '../lib/utils';
import { ConfirmDialog, Field, Modal, Segmented, Spinner } from '../components/ui';

type Section = 'appearance' | 'git' | 'diff' | 'identity' | 'preflight' | 'notifications' | 'shortcuts' | 'github' | 'ai' | 'repositories' | 'privacy';

const SECTIONS: Array<{ id: Section; label: string; icon: typeof Monitor }> = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'git', label: 'Git executable', icon: Terminal },
  { id: 'diff', label: 'Diff & editor', icon: Monitor },
  { id: 'identity', label: 'Identity & config', icon: User },
  { id: 'preflight', label: 'Preflight defaults', icon: Shield },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'github', label: 'GitHub', icon: Github },
  { id: 'ai', label: 'AI assistance', icon: BrainCircuit },
  { id: 'repositories', label: 'Repositories', icon: FolderOpen },
  { id: 'privacy', label: 'Privacy & data', icon: Shield },
];

export function SettingsWorkspace(): React.JSX.Element {
  const { settings, info, updateSettings, recents, reloadRecents, removeRecent, pinRecent, openRepository, toast, snapshot } = useApp();
  const repoPath = snapshot?.info.path ?? '';
  const [section, setSection] = useState<Section>('appearance');
  const [gitPath, setGitPath] = useState(settings.gitPath);
  const [gitCheck, setGitCheck] = useState<string | null>(null);
  const [checkingGit, setCheckingGit] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [token, setToken] = useState('');
  const [savingToken, setSavingToken] = useState(false);
  const [ai, setAi] = useState<AiSettings>(settings.ai);
  const [aiKey, setAiKey] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiTest, setAiTest] = useState<string | null>(null);
  const [config, setConfig] = useState<ConfigEntry[]>([]);
  const [configLoading, setConfigLoading] = useState(false);
  const [configModal, setConfigModal] = useState<{ mode: 'add' | 'edit'; entry?: ConfigEntry } | null>(null);
  const [configKey, setConfigKey] = useState('');
  const [configValue, setConfigValue] = useState('');
  const [configScope, setConfigScope] = useState<'local' | 'global'>('local');
  const [identityName, setIdentityName] = useState('');
  const [identityEmail, setIdentityEmail] = useState('');
  const [savingIdentity, setSavingIdentity] = useState(false);

  useEffect(() => { setGitPath(settings.gitPath); }, [settings.gitPath]);
  useEffect(() => { setAi(settings.ai); }, [settings.ai]);

  useEffect(() => {
    const handler = (event: Event) => {
      if ((event as CustomEvent<string>).detail === 'open-ai-settings') setSection('ai');
    };
    window.addEventListener('gitpp:action', handler);
    return () => window.removeEventListener('gitpp:action', handler);
  }, []);

  const loadConfig = async () => {
    if (!repoPath) return;
    setConfigLoading(true);
    try {
      const entries = await call('git.config', { repoPath });
      setConfig(entries);
      setIdentityName(entries.find((entry) => entry.key === 'user.name')?.value ?? '');
      setIdentityEmail(entries.find((entry) => entry.key === 'user.email')?.value ?? '');
    } catch (error) {
      toast('error', 'Could not read Git configuration', errorDetail(error) ?? errorMessage(error));
    } finally {
      setConfigLoading(false);
    }
  };

  useEffect(() => {
    if (section === 'identity') void loadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, repoPath]);

  const checkGit = async () => {
    setCheckingGit(true);
    setGitCheck(null);
    try {
      const detected = await call('git.detect', {});
      setGitCheck(detected.available ? `Git ${detected.version} found at ${detected.path}` : 'Git is not available. Install it or fix the path.');
      if (detected.available) await updateSettings({ gitPath: gitPath.trim() || 'git' });
    } catch (error) {
      setGitCheck(errorMessage(error));
    } finally {
      setCheckingGit(false);
    }
  };

  const saveToken = async () => {
    if (token.trim().length < 8) return;
    setSavingToken(true);
    try {
      await call('settings.setGithubToken', { token: token.trim() });
      setToken('');
      await updateSettings({ github: { hasToken: true } });
      toast('success', 'GitHub token stored securely');
    } catch (error) {
      toast('error', 'Could not store the token', errorDetail(error) ?? errorMessage(error));
    } finally {
      setSavingToken(false);
    }
  };

  const clearToken = async () => {
    try {
      await call('settings.clearGithubToken', {});
      await updateSettings({ github: { hasToken: false } });
      toast('info', 'GitHub token removed');
    } catch (error) {
      toast('error', 'Could not remove the token', errorMessage(error));
    }
  };

  const saveAi = async () => {
    if (ai.enabled && !ai.consent) { toast('warning', 'Consent required', 'Acknowledge the data-sharing notice before enabling AI.'); return; }
    if (await updateSettings({ ai })) toast('success', 'AI settings saved');
  };

  const storeAiKey = async () => {
    if (aiKey.length < 8) return;
    setAiBusy(true);
    try {
      await call('settings.setAiKey', { key: aiKey });
      setAiKey('');
      const next = { ...ai, hasKey: true };
      setAi(next);
      await updateSettings({ ai: next });
      toast('success', 'AI key stored', 'Encrypted with operating-system credential storage.');
    } catch (error) {
      toast('error', 'Could not store the AI key', errorDetail(error) ?? errorMessage(error));
    } finally {
      setAiBusy(false);
    }
  };

  const testAi = async () => {
    setAiBusy(true);
    setAiTest(null);
    try {
      const result = await call('ai.test', {});
      setAiTest(result.message);
    } catch (error) {
      setAiTest(errorDetail(error) ?? errorMessage(error));
    } finally {
      setAiBusy(false);
    }
  };

  const saveIdentity = async () => {
    setSavingIdentity(true);
    try {
      if (identityName.trim()) await call('git.configSet', { repoPath, key: 'user.name', value: identityName.trim(), scope: 'local' });
      if (identityEmail.trim()) await call('git.configSet', { repoPath, key: 'user.email', value: identityEmail.trim(), scope: 'local' });
      toast('success', 'Git identity updated locally', 'Stored in .git/config for this repository.');
      await loadConfig();
    } catch (error) {
      toast('error', 'Could not update identity', errorDetail(error) ?? errorMessage(error));
    } finally {
      setSavingIdentity(false);
    }
  };

  const saveConfigEntry = async () => {
    if (!configKey.trim() || !repoPath) return;
    try {
      const entries = await call('git.configSet', { repoPath, key: configKey.trim(), value: configValue, scope: configScope });
      setConfig(entries);
      setConfigModal(null);
      toast('success', 'Git configuration updated', `${configKey} (${configScope})`);
    } catch (error) {
      toast('error', 'Could not update Git configuration', errorDetail(error) ?? errorMessage(error));
    }
  };

  const unsetConfig = async (entry: ConfigEntry) => {
    try {
      setConfig(await call('git.configUnset', { repoPath, key: entry.key, scope: entry.scope === 'local' ? 'local' : 'global' }));
      toast('info', 'Configuration key removed', `${entry.key} (${entry.scope})`);
    } catch (error) {
      toast('error', 'Could not remove the key', errorDetail(error) ?? errorMessage(error));
    }
  };

  return (
    <div className="workspace">
      <div className="workspace-header">
        <div className="workspace-heading">
          <h1>Settings</h1>
          <p>Preferences are stored as validated JSON in the app data folder. Credentials use the operating system vault.</p>
        </div>
        <div className="workspace-actions"><button className="btn danger" onClick={() => setResetOpen(true)}><RotateCcw size={13} /> Reset to defaults</button></div>
      </div>
      <div className="workspace-body">
        <div className="settings-layout">
          <nav className="settings-nav" aria-label="Settings sections">
            {SECTIONS.map((entry) => {
              const Icon = entry.icon;
              return <button key={entry.id} className={cx(section === entry.id && 'active')} onClick={() => setSection(entry.id)}><Icon size={14} />{entry.label}</button>;
            })}
          </nav>

          <div className="settings-section">

            {section === 'appearance' ? (
              <div className="panel">
                <div className="panel-header"><h2>Appearance</h2></div>
                <div className="panel-body">
                  <div className="settings-row">
                    <div className="settings-info"><strong>Theme</strong><span>System follows your light/dark preference. Both themes have dedicated design tokens.</span></div>
                    <div className="settings-control"><Segmented value={settings.theme} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'system', label: 'System' }]} onChange={(theme) => void updateSettings({ theme })} /></div>
                  </div>
                  <div className="settings-row">
                    <div className="settings-info"><strong>Editor font size</strong><span>Applies to Markdown Studio.</span></div>
                    <div className="settings-control"><input className="input" type="number" min={8} max={32} value={settings.editor.fontSize} onChange={(event) => void updateSettings({ editor: { fontSize: Number(event.target.value) } })} /></div>
                  </div>
                  <div className="settings-row">
                    <div className="settings-info"><strong>Tab size</strong><span>Stored editor preference. Markdown is saved exactly as typed.</span></div>
                    <div className="settings-control"><input className="input" type="number" min={1} max={8} value={settings.editor.tabSize} onChange={(event) => void updateSettings({ editor: { tabSize: Number(event.target.value) } })} /></div>
                  </div>
                  <div className="banner info" style={{ marginTop: 12 }}><Sun size={14} /><Moon size={14} /><span>Theme changes apply immediately and persist across restarts. Reduced-motion OS settings are respected.</span></div>
                </div>
              </div>
            ) : null}

            {section === 'git' ? (
              <div className="panel">
                <div className="panel-header"><h2>Git executable</h2><span className={cx('tag', info?.git.available ? 'green' : 'red')}>{info?.git.available ? `git ${info.git.version}` : 'not available'}</span></div>
                <div className="panel-body stack">
                  <Field label="Git executable path" help="Absolute path or a name on PATH. Validated with `git --version` before saving.">
                    <div className="row" style={{ gap: 6 }}>
                      <input className="input mono" value={gitPath} onChange={(event) => setGitPath(event.target.value)} spellCheck={false} />
                      <button className="btn" onClick={() => void checkGit()} disabled={checkingGit}>{checkingGit ? <Spinner /> : <Check size={12} />} Test & save</button>
                    </div>
                  </Field>
                  {gitCheck ? <div className={cx('banner', gitCheck.startsWith('Git ') ? 'info' : 'danger')} style={{ padding: '6px 10px' }}>{gitCheck}</div> : null}
                  <Field label="Default repository directory" help="Starting folder for Open and Clone where possible.">
                    <div className="row" style={{ gap: 6 }}>
                      <input className="input mono" value={settings.defaultRepoDir} onChange={(event) => void updateSettings({ defaultRepoDir: event.target.value })} placeholder="C:\\Users\\you\\source" spellCheck={false} />
                      <button className="btn" onClick={async () => { const result = await call('dialog.openDirectory', { title: 'Default repository folder' }); if (result.path) await updateSettings({ defaultRepoDir: result.path }); }}>Browse</button>
                    </div>
                  </Field>
                  <div className="small muted">Git++ does not bundle or download Git. Every operation uses your installed executable with an argument array (no shell), a timeout, bounded output and redacted credentials.</div>
                  <div className="banner info"><Cpu size={14} /><span>Platform: {info?.platform ?? 'unknown'} · Electron {info?.electron ?? '—'} · Chrome {info?.chrome ?? '—'} · Node {info?.node ?? '—'}</span></div>
                </div>
              </div>
            ) : null}

            {section === 'diff' ? (
              <div className="panel">
                <div className="panel-header"><h2>Diff & editor defaults</h2></div>
                <div className="panel-body">
                  <div className="settings-row"><div className="settings-info"><strong>Default diff layout</strong><span>Unified is denser; side-by-side is easier for rewrites.</span></div><div className="settings-control"><Segmented value={settings.diff.mode} options={[{ value: 'unified', label: 'Unified' }, { value: 'split', label: 'Side by side' }]} onChange={(mode) => void updateSettings({ diff: { mode } })} /></div></div>
                  <div className="settings-row"><div className="settings-info"><strong>Context lines</strong><span>Unchanged lines included around each hunk.</span></div><div className="settings-control"><input className="input" type="number" min={0} max={50} value={settings.diff.context} onChange={(event) => void updateSettings({ diff: { context: Number(event.target.value) } })} /></div></div>
                  <div className="settings-row"><div className="settings-info"><strong>Ignore whitespace</strong><span>Passes --ignore-all-space. Only the view filters changes.</span></div><div className="settings-control"><label className="checkbox-row"><input type="checkbox" checked={settings.diff.ignoreWhitespace} onChange={(event) => void updateSettings({ diff: { ignoreWhitespace: event.target.checked } })} /> Enabled</label></div></div>
                  <div className="settings-row"><div className="settings-info"><strong>Wrap long lines</strong><span>Off by default to keep diff alignment.</span></div><div className="settings-control"><label className="checkbox-row"><input type="checkbox" checked={settings.diff.wrap} onChange={(event) => void updateSettings({ diff: { wrap: event.target.checked } })} /> Enabled</label></div></div>
                </div>
              </div>
            ) : null}

            {section === 'identity' ? (
              <div className="stack">
                <div className="panel">
                  <div className="panel-header"><h2>Commit identity</h2><div className="panel-actions"><button className="btn ghost sm" onClick={() => void loadConfig()} disabled={!repoPath}><RefreshCw size={11} /> Reload</button></div></div>
                  <div className="panel-body stack">
                    {!repoPath ? <div className="banner warn"><AlertTriangle size={14} /> Open a repository to edit its local Git configuration.</div> : null}
                    <div className="grid-2">
                      <Field label="user.name (local)"><input className="input" value={identityName} onChange={(event) => setIdentityName(event.target.value)} placeholder="Your Name" disabled={!repoPath} /></Field>
                      <Field label="user.email (local)"><input className="input" value={identityEmail} onChange={(event) => setIdentityEmail(event.target.value)} placeholder="you@example.com" disabled={!repoPath} /></Field>
                    </div>
                    <div><button className="btn primary" onClick={() => void saveIdentity()} disabled={!repoPath || savingIdentity}>{savingIdentity ? <Spinner /> : <Check size={12} />} Save identity for this repository</button></div>
                    <div className="small muted">Git++ does not invent an identity. If these are unset globally too, commits fail with Git’s real error.</div>
                  </div>
                </div>
                <div className="panel">
                  <div className="panel-header"><h2>Git configuration</h2><span className="tag">{config.length}</span><div className="panel-actions"><button className="btn sm" onClick={() => { setConfigModal({ mode: 'add' }); setConfigKey(''); setConfigValue(''); setConfigScope('local'); }} disabled={!repoPath}><Plus size={11} /> Add key</button></div></div>
                  <div className="panel-body flush">
                    {configLoading ? <div className="loading-state"><Spinner /> Reading configuration…</div> : null}
                    {!configLoading && repoPath ? (
                      <div className="table-wrap" style={{ maxHeight: 340 }}>
                        <table className="table">
                          <thead><tr><th>Key</th><th>Value</th><th>Scope</th><th /></tr></thead>
                          <tbody>
                            {config.map((entry) => (
                              <tr key={`${entry.scope}-${entry.key}`}>
                                <td className="mono">{entry.key}</td>
                                <td className="mono truncate" style={{ maxWidth: 300 }}>{entry.value}</td>
                                <td><span className="tag">{entry.scope}</span></td>
                                <td><div className="row-actions" style={{ opacity: 1 }}>
                                  <button className="btn ghost icon" onClick={() => { setConfigModal({ mode: 'edit', entry }); setConfigKey(entry.key); setConfigValue(entry.value); setConfigScope(entry.scope === 'local' ? 'local' : 'global'); }} title="Edit"><Keyboard size={11} /></button>
                                  <button className="btn ghost icon" onClick={() => void unsetConfig(entry)} title="Unset"><X size={11} /></button>
                                </div></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                    {!configLoading && !repoPath ? <div className="small muted" style={{ padding: 12 }}>Open a repository first.</div> : null}
                  </div>
                </div>
              </div>
            ) : null}

            {section === 'preflight' ? (
              <div className="panel">
                <div className="panel-header"><h2>Preflight defaults</h2></div>
                <div className="panel-body">
                  <div className="settings-row"><div className="settings-info"><strong>Default timeout</strong><span>Applied to newly detected checks. Each check can override it.</span></div><div className="settings-control"><input className="input" type="number" min={10} max={3600} value={Math.round(settings.preflight.defaultTimeoutMs / 1000)} onChange={(event) => void updateSettings({ preflight: { defaultTimeoutMs: Number(event.target.value) * 1000 } })} /></div></div>
                  <div className="settings-row"><div className="settings-info"><strong>Trust commands for new repositories</strong><span>Not recommended. Command checks execute project code.</span></div><div className="settings-control"><label className="checkbox-row"><input type="checkbox" checked={settings.preflight.defaultTrustCommands} onChange={(event) => void updateSettings({ preflight: { defaultTrustCommands: event.target.checked } })} /> Trust by default</label></div></div>
                  <div className="banner warn" style={{ marginTop: 12 }}><AlertTriangle size={14} /> Preflight never runs automatically when a repository is opened. Results become stale when the repository changes.</div>
                </div>
              </div>
            ) : null}

            {section === 'notifications' ? (
              <div className="panel">
                <div className="panel-header"><h2>Notifications</h2></div>
                <div className="panel-body">
                  <div className="settings-row"><div className="settings-info"><strong>Enable notifications</strong><span>In-app toasts for operation results and warnings.</span></div><div className="settings-control"><label className="checkbox-row"><input type="checkbox" checked={settings.notifications.enabled} onChange={(event) => void updateSettings({ notifications: { enabled: event.target.checked } })} /> Enabled</label></div></div>
                  <div className="settings-row"><div className="settings-info"><strong>Operation toasts</strong><span>Success toasts for completed operations. Errors are always shown.</span></div><div className="settings-control"><label className="checkbox-row"><input type="checkbox" checked={settings.notifications.operationToasts} onChange={(event) => void updateSettings({ notifications: { operationToasts: event.target.checked } })} /> Enabled</label></div></div>
                </div>
              </div>
            ) : null}

            {section === 'shortcuts' ? (
              <div className="panel">
                <div className="panel-header"><h2>Keyboard shortcuts</h2><span className="tag">global</span></div>
                <div className="panel-body stack">
                  <div className="grid-2">
                    {(['commandPalette', 'refresh', 'commit', 'openRepo', 'search'] as const).map((key) => (
                      <Field key={key} label={{ commandPalette: 'Command palette', refresh: 'Refresh repository', commit: 'Commit', openRepo: 'Open repository', search: 'Search' }[key]}>
                        <input className="input mono" value={settings.shortcuts[key]} onChange={(event) => void updateSettings({ shortcuts: { [key]: event.target.value } })} spellCheck={false} />
                      </Field>
                    ))}
                  </div>
                  <div className="small muted">Format: Ctrl+K, Ctrl+Shift+P, Alt+F. Escape closes overlays. Ctrl+1/2/3 switch Changes, History and Branches.</div>
                </div>
              </div>
            ) : null}

            {section === 'github' ? (
              <div className="panel">
                <div className="panel-header"><h2>GitHub integration</h2><span className={cx('tag', settings.github.hasToken ? 'green' : 'amber')}>{settings.github.hasToken ? 'token stored' : 'not connected'}</span></div>
                <div className="panel-body stack">
                  <Field label="API base URL" help="Change only for GitHub Enterprise. Default: https://api.github.com"><input className="input mono" value={settings.github.apiBase} onChange={(event) => void updateSettings({ github: { apiBase: event.target.value } })} spellCheck={false} /></Field>
                  {!settings.github.hasToken ? (
                    <>
                      <Field label="Personal access token" help="Classic tokens need repo; fine-grained tokens need contents, pull requests, issues and actions permissions."><input className="input mono" type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="ghp_…" autoComplete="off" /></Field>
                      <div><button className="btn primary" onClick={() => void saveToken()} disabled={savingToken || token.trim().length < 8}>{savingToken ? <Spinner /> : <KeyRound size={12} />} Store token securely</button></div>
                    </>
                  ) : (
                    <div className="banner info"><Check size={14} /><span>A token is stored in operating-system credential storage. It is never written to settings.json or logs.</span><div className="banner-actions"><button className="btn sm danger" onClick={() => void clearToken()}>Remove token</button></div></div>
                  )}
                  <div className="small muted">GitHub is optional. Without a token, local Git features remain fully available.</div>
                  <button className="btn" onClick={() => void call('app.openExternal', { url: 'https://github.com/settings/tokens' })} style={{ alignSelf: 'flex-start' }}>Open GitHub token settings <ChevronRight size={12} /></button>
                </div>
              </div>
            ) : null}

            {section === 'ai' ? (
              <div className="panel">
                <div className="panel-header"><h2>AI assistance</h2><span className={cx('tag', ai.enabled && ai.consent ? 'green' : 'amber')}>{ai.enabled ? (ai.consent ? 'enabled' : 'consent required') : 'off'}</span></div>
                <div className="panel-body stack">
                  <div className="banner warn"><AlertTriangle size={14} /><span><strong>Opt-in only.</strong> Git++ never sends repository content automatically. Pressing an AI action sends the current diff or error text to the provider you configure.</span></div>
                  <div className="grid-2">
                    <Field label="Provider base URL" help="OpenAI-compatible /chat/completions endpoint. HTTPS required; HTTP only for localhost."><input className="input mono" value={ai.baseUrl} onChange={(event) => setAi({ ...ai, baseUrl: event.target.value })} spellCheck={false} /></Field>
                    <Field label="Model"><input className="input mono" value={ai.model} onChange={(event) => setAi({ ...ai, model: event.target.value })} spellCheck={false} /></Field>
                  </div>
                  <label className="checkbox-row"><input type="checkbox" checked={ai.consent} onChange={(event) => setAi({ ...ai, consent: event.target.checked })} /> I understand that pressing an AI action sends selected repository content to this provider.</label>
                  <label className="checkbox-row"><input type="checkbox" checked={ai.enabled} onChange={(event) => setAi({ ...ai, enabled: event.target.checked })} /> Enable AI features in Changes and History</label>
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn primary" onClick={() => void saveAi()}>Save AI settings</button>
                    {ai.hasKey ? <button className="btn danger" onClick={async () => { await call('settings.clearAiKey', {}); const next = { ...ai, hasKey: false }; setAi(next); await updateSettings({ ai: next }); toast('info', 'AI key removed'); }}>Remove key</button> : null}
                  </div>
                  <div className="divider" />
                  <Field label="API key" help="Stored with operating-system encryption. Never shown again after saving."><div className="row" style={{ gap: 6 }}><input className="input mono" type="password" value={aiKey} onChange={(event) => setAiKey(event.target.value)} placeholder="sk-…" autoComplete="off" /><button className="btn" onClick={() => void storeAiKey()} disabled={aiBusy || aiKey.length < 8}>{aiBusy ? <Spinner /> : <KeyRound size={12} />} Store</button></div></Field>
                  <div className="row" style={{ gap: 8 }}><button className="btn" onClick={() => void testAi()} disabled={aiBusy || !ai.hasKey}><Wand2 size={12} /> Test provider</button>{aiTest ? <span className="small muted">{aiTest}</span> : null}</div>
                  <div className="small muted">AI suggestions are never applied automatically. You always review and confirm commit messages.</div>
                </div>
              </div>
            ) : null}

            {section === 'repositories' ? (
              <div className="panel">
                <div className="panel-header"><h2>Recent repositories</h2><span className="tag">{recents.length}</span><div className="panel-actions"><button className="btn ghost sm" onClick={() => void reloadRecents()}><RefreshCw size={11} /> Refresh</button></div></div>
                <div className="panel-body flush">
                  {recents.length === 0 ? <div className="small muted" style={{ padding: 14 }}>No recent repositories.</div> : null}
                  {recents.map((repo) => (
                    <div key={repo.path} className="list-item">
                      <FolderOpen size={14} style={{ marginTop: 2 }} />
                      <div className="item-main">
                        <div className="item-title">{repo.name} {repo.pinned ? <span className="tag accent">pinned</span> : null}</div>
                        <div className="item-sub"><span className="mono">{repo.path}</span></div>
                      </div>
                      <div className="item-actions" style={{ opacity: 1 }}>
                        <button className="btn sm" onClick={() => void openRepository(repo.path)}>Open</button>
                        <button className="btn ghost icon" onClick={() => void pinRecent(repo.path, !repo.pinned)} title={repo.pinned ? 'Unpin' : 'Pin'}><Check size={11} /></button>
                        <button className="btn ghost icon" onClick={() => void removeRecent(repo.path)} title="Remove from recents (does not delete the folder)"><Trash2 size={11} /></button>
                      </div>
                    </div>
                  ))}
                  <div className="banner info" style={{ margin: 12 }}><Trash2 size={14} /> Removing an entry only edits Git++’s recent list. The repository folder is never deleted.</div>
                </div>
              </div>
            ) : null}

            {section === 'privacy' ? (
              <div className="panel">
                <div className="panel-header"><h2>Privacy & data</h2></div>
                <div className="panel-body">
                  <div className="settings-row"><div className="settings-info"><strong>Telemetry</strong><span>Git++ sends no analytics, crash reports or usage data. This cannot be enabled.</span></div><div className="settings-control"><span className="tag green">off</span></div></div>
                  <div className="settings-row"><div className="settings-info"><strong>Log level</strong><span>Affects local diagnostics only. Credentials are redacted from captured output.</span></div><div className="settings-control"><select className="input" value={settings.privacy.logLevel} onChange={(event) => void updateSettings({ privacy: { logLevel: event.target.value as 'info' | 'debug' | 'error' } })}><option value="error">Error</option><option value="info">Info</option><option value="debug">Debug</option></select></div></div>
                  <div className="settings-row"><div className="settings-info"><strong>Data folder</strong><span>Settings, recent list, Preflight configuration and encrypted credentials.</span></div><div className="settings-control"><button className="btn sm" onClick={() => void call('app.showItemInFolder', { path: info?.dataDir ?? '' })}>Reveal</button></div></div>
                  <div className="settings-row"><div className="settings-info"><strong>Version</strong><span>{info?.name} {info?.version}</span></div><div className="settings-control"><span className="small dim truncate">{info?.dataDir}</span></div></div>
                  <div className="banner info" style={{ marginTop: 12 }}><Shield size={14} /> Repository content is treated as untrusted input. Markdown previews sanitize HTML, external links are validated, and repository commands require explicit authorization.</div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
        <div style={{ height: 30 }} />
      </div>


      {resetOpen ? (
        <ConfirmDialog title="Reset all settings?" description="Restores preferences to their defaults. Recent repositories, stored GitHub tokens and AI keys are not deleted." confirmLabel="Reset settings" danger onClose={() => setResetOpen(false)} onConfirm={async () => { try { await call('settings.reset', {}); const next = await call('settings.get', {}); await updateSettings(next); setResetOpen(false); toast('success', 'Settings restored to defaults'); window.location.reload(); } catch (error) { toast('error', 'Could not reset settings', errorMessage(error)); } }} consequences={['Theme, diff defaults, editor, notifications and shortcut preferences return to defaults.', 'Per-repository Preflight configuration is kept.', 'Tokens and API keys stored in the OS vault are kept until you remove them explicitly.']} />
      ) : null}

      {configModal ? (
        <Modal title={configModal.mode === 'add' ? 'Add Git configuration' : 'Edit Git configuration'} onClose={() => setConfigModal(null)} width="narrow" footer={<><button className="btn ghost" onClick={() => setConfigModal(null)}>Cancel</button><button className="btn primary" disabled={!configKey.trim()} onClick={() => void saveConfigEntry()}>Save</button></>}>
          <Field label="Key"><input className="input mono" value={configKey} onChange={(event) => setConfigKey(event.target.value)} placeholder="core.autocrlf" spellCheck={false} /></Field>
          <Field label="Value"><input className="input mono" value={configValue} onChange={(event) => setConfigValue(event.target.value)} spellCheck={false} /></Field>
          <Field label="Scope"><select className="input" value={configScope} onChange={(event) => setConfigScope(event.target.value as 'local' | 'global')}><option value="local">Local (this repository)</option><option value="global">Global (all repositories for this user)</option></select></Field>
          {configScope === 'global' ? <div className="banner warn"><AlertTriangle size={14} /> Global configuration affects every Git repository for your user account.</div> : null}
        </Modal>
      ) : null}
    </div>
  );
}
