import React, { useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle, Check, CheckCircle2, Circle, CircleSlash, Clock, Eye, Loader2, Play, Plus, RefreshCw,
  RotateCcw, ShieldAlert, ShieldCheck, Square, Trash2, XCircle, PauseCircle,
} from 'lucide-react';
import type { PreflightCheckConfig, PreflightConfig, PreflightRun } from '../../shared/types';
import { call, errorDetail, errorMessage } from '../lib/api';
import { useApp } from '../state/AppState';
import { cx, plural } from '../lib/utils';
import { formatDateTime, formatDuration, relativeTime } from '../../shared/format';
import { ConfirmDialog, EmptyState, Modal, Spinner } from '../components/ui';

const STATUS_ICON: Record<string, LucideIcon> = {
  queued: Circle,
  running: Loader2,
  passed: CheckCircle2,
  failed: XCircle,
  skipped: CircleSlash,
  'timed-out': Clock,
  cancelled: PauseCircle,
};

const EMPTY_CHECK = (): PreflightCheckConfig => ({
  id: `custom-${Date.now().toString(36)}`,
  name: 'Custom check',
  type: 'command',
  command: '',
  args: [],
  required: false,
  timeoutMs: 120000,
  enabled: false,
  description: 'Describe what this check verifies.',
});

export function PreflightWorkspace(): React.JSX.Element {
  const { snapshot, runOperation, toast } = useApp();
  const repoPath = snapshot?.info.path ?? '';
  const [config, setConfig] = useState<PreflightConfig | null>(null);
  const [runs, setRuns] = useState<PreflightRun[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<PreflightRun | null>(null);
  const [selectedCheck, setSelectedCheck] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [configOpen, setConfigOpen] = useState(false);
  const [draft, setDraft] = useState<PreflightConfig | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [trustOpen, setTrustOpen] = useState(false);
  const [outputOpen, setOutputOpen] = useState(false);

  const load = async (silent = false) => {
    if (!repoPath) return;
    if (!silent) setLoading(true);
    try {
      const [nextConfig, nextRuns] = await Promise.all([
        call('preflight.getConfig', { repoPath }),
        call('preflight.runs', { repoPath }),
      ]);
      setConfig(nextConfig);
      setRuns(nextRuns);
      setActiveRun((current) => (current ? nextRuns.find((run) => run.id === current.id) ?? current : nextRuns[0] ?? null));
      setActiveId((current) => current ?? nextRuns[0]?.id ?? null);
    } catch (error) {
      toast('error', 'Could not load Preflight configuration', errorDetail(error) ?? errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [repoPath, snapshot?.refreshedAt]);

  useEffect(() => {
    if (!activeRun || activeRun.status !== 'running') return undefined;
    const timer = window.setInterval(async () => {
      try {
        const next = await call('preflight.getRun', { repoPath, runId: activeRun.id });
        setActiveRun(next);
        setRuns((current) => current.map((run) => (run.id === next.id ? next : run)));
        if (next.status !== 'running') {
          setStarting(null);
          if (next.status === 'passed') toast('success', 'Preflight passed', `${next.results.filter((result) => result.status === 'passed').length} checks passed.`);
          else if (next.status === 'failed') toast('warning', 'Preflight failed', 'Open the check output for the real exit code and messages.');
        }
      } catch (error) {
        setStarting(null);
        toast('error', 'Lost track of the Preflight run', errorMessage(error));
      }
    }, 700);
    return () => window.clearInterval(timer);
  }, [activeRun, repoPath, toast]);

  useEffect(() => {
    const handler = (event: Event) => {
      if ((event as CustomEvent<string>).detail === 'run-preflight') void start();
    };
    window.addEventListener('gitpp:action', handler);
    return () => window.removeEventListener('gitpp:action', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, repoPath]);

  const recent = useMemo(() => runs.slice(0, 6), [runs]);
  const currentRun = activeRun ?? runs.find((run) => run.id === activeId) ?? null;
  const result = currentRun?.results.find((entry) => entry.checkId === selectedCheck) ?? currentRun?.results[0] ?? null;

  const start = async (checkIds?: string[]) => {
    if (!config) return;
    const selected = config.checks.filter((check) => check.enabled && (!checkIds || checkIds.includes(check.id)));
    if (selected.length === 0) { toast('warning', 'No checks are enabled', 'Open Configure and enable at least one check.'); return; }
    if (!config.trustCommands && selected.some((check) => check.type === 'command')) {
      toast('warning', 'Command checks will be skipped', 'Repository command execution is not authorized for this repository. Status, conflict and secret-scan checks still run.');
    }
    setStarting(checkIds?.[0] ?? 'all');
    try {
      const run = await call('preflight.start', { repoPath, ...(checkIds ? { checkIds } : {}) });
      setActiveRun(run);
      setActiveId(run.id);
      setRuns((current) => [run, ...current.filter((entry) => entry.id !== run.id)]);
      setSelectedCheck(run.results[0]?.checkId ?? null);
    } catch (error) {
      setStarting(null);
      toast('error', 'Could not start Preflight', errorDetail(error) ?? errorMessage(error));
    }
  };

  const cancel = async () => {
    if (!currentRun) return;
    try {
      const run = await call('preflight.cancel', { repoPath, runId: currentRun.id });
      setActiveRun(run);
      setRuns((current) => current.map((entry) => (entry.id === run.id ? run : entry)));
    } catch (error) {
      toast('error', 'Could not cancel the run', errorMessage(error));
    }
  };

  const openConfig = () => {
    if (!config) return;
    setDraft(structuredClone(config));
    setConfigOpen(true);
  };

  const saveConfig = async () => {
    if (!draft) return;
    const saved = await runOperation('Saving Preflight configuration…', () => call('preflight.setConfig', {
      repoPath,
      trustCommands: draft.trustCommands,
      blockCommitOnFailure: draft.blockCommitOnFailure,
      checks: draft.checks,
    }), { success: 'Preflight configuration saved', refresh: false });
    if (saved) { setConfig(saved); setConfigOpen(false); }
  };

  const detectChecks = async () => {
    if (!draft) return;
    try {
      const detected = await call('preflight.detect', { repoPath });
      setDraft({ ...draft, checks: detected });
      toast('info', 'Detected project checks', 'Review commands before enabling or trusting them.');
    } catch (error) {
      toast('error', 'Could not detect project checks', errorMessage(error));
    }
  };

  if (!snapshot) {
    return <div className="workspace"><EmptyState icon={ShieldCheck} title="No repository open" description="Open a repository to configure and run real preflight checks." /></div>;
  }

  const commandEnabled = config?.checks.some((check) => check.enabled && check.type === 'command') ?? false;

  return (
    <div className="workspace">
      <div className="workspace-header">
        <div className="workspace-heading">
          <h1>Preflight Lab <span className="tag">{config?.checks.filter((check) => check.enabled).length ?? 0} checks enabled</span></h1>
          <p>Run real checks against this working tree. Results become stale when the repository changes.</p>
        </div>
        <div className="workspace-actions">
          <button className="btn" onClick={() => void load()}><RefreshCw size={13} /> Refresh</button>
          <button className="btn" onClick={openConfig}>Configure</button>
          {currentRun?.status === 'running' ? <button className="btn danger" onClick={() => void cancel()}><Square size={12} /> Cancel run</button> : <button className="btn primary" onClick={() => void start()} disabled={starting !== null}>{starting ? <Spinner /> : <Play size={13} />} Run enabled checks</button>}
        </div>
      </div>
      <div className="workspace-body flush">
        {loading ? <div className="loading-state"><Spinner /> Loading Preflight…</div> : null}
        {!loading && config ? (
          <div className="preflight-layout">
            <div className="check-list">
              <div className="panel-header" style={{ position: 'sticky', top: 0, zIndex: 1 }}><h2>Checks</h2><span className="tag">{config.checks.filter((check) => check.enabled).length}/{config.checks.length}</span></div>
              {config.checks.map((check) => {
                const checkResult = currentRun?.results.find((entry) => entry.checkId === check.id) ?? null;
                const Icon = checkResult ? STATUS_ICON[checkResult.status] ?? Circle : Circle;
                return (
                  <div className={cx('check-row')} key={check.id} style={selectedCheck === check.id ? { background: 'var(--accent-soft)' } : undefined} onClick={() => { setSelectedCheck(check.id); setOutputOpen(false); }} role="button" tabIndex={0}>
                    <span className={cx('check-icon', checkResult ? `status-${checkResult.status}` : check.enabled ? '' : 'dim')}>
                      {checkResult?.status === 'running' ? <Loader2 size={14} className="spinner" style={{ border: 'none', width: 14, height: 14 }} /> : <Icon size={14} />}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="check-title">
                        {check.name}
                        {check.required ? <span className="tag amber">required</span> : <span className="tag">optional</span>}
                        {!check.enabled ? <span className="tag">disabled</span> : null}
                        {check.type === 'command' && !config.trustCommands ? <span className="tag red">needs trust</span> : null}
                      </div>
                      <div className="check-desc">{check.description}</div>
                      <div className="row" style={{ marginTop: 4, gap: 6 }}>
                        {checkResult ? <span className={cx('check-status-label', `status-${checkResult.status}`)}>{checkResult.status}</span> : <span className="small dim">not run</span>}
                        {checkResult && checkResult.durationMs > 0 ? <span className="small dim">{formatDuration(checkResult.durationMs)}</span> : null}
                        {check.command ? <span className="small mono dim truncate">{check.command} {check.args.join(' ')}</span> : null}
                      </div>
                    </div>
                    {check.enabled ? <button className="btn ghost icon" title="Run only this check" onClick={(event) => { event.stopPropagation(); void start([check.id]); }} disabled={currentRun?.status === 'running'}><Play size={12} /></button> : null}
                  </div>
                );
              })}
              {config.checks.length === 0 ? <div className="small muted" style={{ padding: 12 }}>No checks configured. Open Configure to add some.</div> : null}
              <div style={{ padding: 12 }} className="small muted">
                Git++ never runs checks when a repository is opened. You must start a run explicitly.
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'auto' }}>
              <div className="workspace" style={{ padding: 16, gap: 12, overflow: 'visible', height: 'auto' }}>
                {!currentRun ? (
                  <div className="stack">
                    <div className="banner info"><ShieldCheck size={16} /><span><strong>Ready when you are.</strong> This project suggests {config.checks.length} checks. Review them, authorize commands if you trust this repository, then run the suite.</span></div>
                    <div className="grid-2">
                      <div className="panel"><div className="panel-header"><h2>What runs without authorization</h2></div><div className="panel-body small muted">Status, conflict detection and the staged-diff secret scan are implemented inside Git++ and use read-only Git commands.</div></div>
                      <div className="panel"><div className="panel-header"><h2>Repository commands</h2></div><div className="panel-body small muted">Type checks, tests and builds execute project code with your user permissions. A worktree is not a sandbox. Only enable them for repositories you trust.</div></div>
                    </div>
                    <div className="row" style={{ gap: 8 }}>
                      <button className="btn primary" onClick={() => void start()}><Play size={13} /> Run suggested checks</button>
                      <button className="btn" onClick={openConfig}>Review configuration</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="panel">
                      <div className="panel-header">
                        <h2>Run {currentRun.status === 'running' ? 'in progress' : currentRun.status}</h2>
                        <span className={cx('tag', currentRun.status === 'passed' ? 'green' : currentRun.status === 'failed' ? 'red' : 'accent')}>{currentRun.status}</span>
                        {currentRun.stale ? <span className="tag amber">stale</span> : null}
                        <div className="panel-actions"><span className="small dim">{formatDateTime(currentRun.startedAt)}</span></div>
                      </div>
                      <div className="panel-body">
                        <div className="row" style={{ gap: 16, flexWrap: 'wrap', marginBottom: 10 }}>
                          <span className="small muted">Branch <span className="mono">{currentRun.branch ?? 'detached'}</span></span>
                          <span className="small muted">HEAD <span className="mono">{currentRun.headSha?.slice(0, 10) ?? 'none'}</span></span>
                          <span className="small muted">{currentRun.results.filter((entry) => entry.status === 'passed').length} passed · {currentRun.results.filter((entry) => entry.status === 'failed').length} failed · {currentRun.results.filter((entry) => entry.status === 'skipped').length} skipped</span>
                          {currentRun.finishedAt ? <span className="small muted">finished {relativeTime(currentRun.finishedAt)}</span> : null}
                        </div>
                        {currentRun.stale ? <div className="banner warn" style={{ marginBottom: 10 }}><AlertTriangle size={14} /> The repository changed after these results were produced. The results are stale; rerun before relying on them.</div> : null}
                        {!config.trustCommands && commandEnabled ? <div className="banner warn" style={{ marginBottom: 10 }}><ShieldAlert size={14} /> Command execution is not authorized. Command checks were skipped and are not counted as passed.</div> : null}
                        <div className="btn-group">
                          <button className="btn sm" onClick={() => setOutputOpen(true)} disabled={!result}><Eye size={11} /> View output</button>
                          <button className="btn sm" onClick={openConfig}>Adjust checks</button>
                          {currentRun.status === 'running' ? <button className="btn sm danger" onClick={() => void cancel()}><Square size={11} /> Cancel</button> : <button className="btn sm" onClick={() => void start()}><RotateCcw size={11} /> Run again</button>}
                        </div>
                      </div>
                    </div>
                    <div className="panel">
                      <div className="panel-header"><h2>Results</h2></div>
                      <div className="panel-body flush">
                        {currentRun.results.map((entry) => (
                          <button key={entry.checkId} className="list-item" style={{ width: '100%', textAlign: 'left', background: result?.checkId === entry.checkId ? 'var(--accent-soft)' : undefined }} onClick={() => setSelectedCheck(entry.checkId)}>
                            <span className={cx('check-status-label', `status-${entry.status}`)} style={{ marginTop: 2 }}>
                              {entry.status === 'running' ? <Loader2 size={14} className="spinner" style={{ border: 'none' }} /> : entry.status === 'passed' ? <Check size={14} /> : entry.status === 'failed' ? <XCircle size={14} /> : <Circle size={14} />}
                            </span>
                            <div className="item-main">
                              <div className="item-title">{entry.name} <span className={cx('check-status-label', `status-${entry.status}`)}>{entry.status}</span></div>
                              <div className="item-sub"><span>{entry.summary}</span>{entry.durationMs > 0 ? <span>{formatDuration(entry.durationMs)}</span> : null}{entry.exitCode !== null ? <span className="mono">exit {entry.exitCode}</span> : null}</div>
                            </div>
                            <button className="btn ghost icon" onClick={(event) => { event.stopPropagation(); setSelectedCheck(entry.checkId); setOutputOpen(true); }} title="Show output"><Eye size={12} /></button>
                          </button>
                        ))}
                      </div>
                    </div>
                    {recent.length > 1 ? (
                      <div className="panel">
                        <div className="panel-header"><h2>Recent runs</h2><span className="small dim">in this session</span></div>
                        <div className="panel-body" style={{ padding: 4 }}>
                          {recent.map((run) => (
                            <button key={run.id} className="row" style={{ width: '100%', padding: '6px 8px', textAlign: 'left', background: run.id === currentRun.id ? 'var(--accent-soft)' : undefined, borderRadius: 4 }} onClick={() => { setActiveRun(run); setActiveId(run.id); }}>
                              <span className={cx('tag', run.status === 'passed' ? 'green' : run.status === 'failed' ? 'red' : 'accent')}>{run.status}</span>
                              <span className="small" style={{ flex: 1 }}>{formatDateTime(run.startedAt)}</span>
                              <span className="small dim">{run.results.length} checks</span>
                              {run.stale ? <span className="tag amber">stale</span> : null}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {outputOpen && result ? (
        <Modal title={`${result.name} · ${result.status}`} description={result.commandLine ?? 'Git++ internal check'} onClose={() => setOutputOpen(false)} width="wide" footer={<button className="btn" onClick={() => setOutputOpen(false)}>Close</button>}>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <span className={cx('tag', result.status === 'passed' ? 'green' : result.status === 'failed' ? 'red' : 'amber')}>{result.status}</span>
            <span className="small muted">exit code <span className="mono">{result.exitCode ?? '—'}</span></span>
            <span className="small muted">duration <span className="mono">{formatDuration(result.durationMs)}</span></span>
            {result.exitCode === null && result.status === 'skipped' ? <span className="tag amber">not executed</span> : null}
          </div>
          <pre className="run-output" style={{ maxHeight: '46vh' }}>{result.output || '(no output captured)'}</pre>
          {result.outputTruncated ? <div className="banner warn">Output was truncated to keep the app responsive.</div> : null}
        </Modal>
      ) : null}

      {configOpen && draft ? (
        <Modal title="Configure Preflight" description="Checks are stored for this repository only. Nothing runs automatically." onClose={() => setConfigOpen(false)} width="wide" footer={<><span className="modal-note">{draft.checks.length} checks</span><button className="btn ghost" onClick={() => setConfigOpen(false)}>Cancel</button><button className="btn" onClick={() => void detectChecks()}>Reload detected</button><button className="btn primary" onClick={() => void saveConfig()}>Save configuration</button></>}>
          <div className="config-note"><ShieldAlert size={14} /><span><strong>Command checks execute real programs.</strong> They run with your account’s permissions in this repository. Paths and additions are not a sandbox. Only authorize repositories and commands you trust.</span></div>
          <label className="checkbox-row">
            <input type="checkbox" checked={draft.trustCommands} onChange={(event) => { if (event.target.checked) setTrustOpen(true); else setDraft({ ...draft, trustCommands: false }); }} />
            <span>Allow command checks in this repository <span className="mono">(required for tests, builds and custom commands)</span></span>
          </label>
          <label className="checkbox-row"><input type="checkbox" checked={draft.blockCommitOnFailure} onChange={(event) => setDraft({ ...draft, blockCommitOnFailure: event.target.checked })} /> Block commits in Git++ when the latest required checks failed</label>
          <div className="divider" />
          <div className="config-editor">
            {draft.checks.map((check, index) => (
              <div className="check-config" key={check.id}>
                <div className="check-config-head">
                  <input type="checkbox" checked={check.enabled} onChange={(event) => updateCheck(setDraft, index, { enabled: event.target.checked })} aria-label={`Enable ${check.name}`} />
                  <input className="input" style={{ flex: 1 }} value={check.name} onChange={(event) => updateCheck(setDraft, index, { name: event.target.value })} aria-label="Check name" />
                  <span className="tag">{check.type}</span>
                  <button className="btn ghost icon" onClick={() => setDraft({ ...draft, checks: draft.checks.filter((entry) => entry.id !== check.id) })} aria-label="Remove check"><Trash2 size={12} /></button>
                </div>
                <label className="checkbox-row small"><input type="checkbox" checked={check.required} onChange={(event) => updateCheck(setDraft, index, { required: event.target.checked })} /> Required</label>
                <div className="field"><label>Timeout (seconds)</label><input className="input" type="number" min={1} max={3600} value={Math.round(check.timeoutMs / 1000)} onChange={(event) => updateCheck(setDraft, index, { timeoutMs: Math.max(1000, Number(event.target.value) * 1000) })} /></div>
                {check.type === 'command' || check.type === 'custom' ? (
                  <>
                    <div className="field"><label>Command (no shell)</label><input className="input mono" value={check.command ?? ''} onChange={(event) => updateCheck(setDraft, index, { command: event.target.value })} placeholder="pnpm" spellCheck={false} /></div>
                    <div className="field"><label>Arguments (one per line)</label><textarea className="textarea" rows={2} value={check.args.join('\n')} onChange={(event) => updateCheck(setDraft, index, { args: event.target.value.split('\n').map((line) => line.trim()).filter(Boolean) })} spellCheck={false} /></div>
                  </>
                ) : null}
                <div className="field full"><label>Report label</label><input className="input" value={check.description} onChange={(event) => updateCheck(setDraft, index, { description: event.target.value })} /></div>
              </div>
            ))}
            <button className="btn" onClick={() => setDraft({ ...draft, checks: [...draft.checks, EMPTY_CHECK()] })}><Plus size={13} /> Add custom check</button>
          </div>
        </Modal>
      ) : null}

      {trustOpen ? (
        <ConfirmDialog
          title="Authorize repository command execution?"
          description="Git++ will be allowed to run the commands configured for this repository, with your user permissions."
          confirmLabel="I trust these commands"
          danger
          onClose={() => setTrustOpen(false)}
          onConfirm={() => { setDraft((current) => current ? { ...current, trustCommands: true } : current); setTrustOpen(false); }}
          consequences={[
            'A script in the repository can read files, make network requests, and modify anything your user account can access.',
            'Running in a worktree does not isolate the process or make untrusted code safe.',
            'Only authorize commands after reviewing exactly what they execute.',
            'Authorization is saved per repository and can be revoked here at any time.',
          ]}
        />
      ) : null}
    </div>
  );
}

function updateCheck(setter: React.Dispatch<React.SetStateAction<PreflightConfig | null>>, index: number, patch: Partial<PreflightCheckConfig>): void {
  setter((current) => {
    if (!current) return current;
    const checks = current.checks.map((check, checkIndex) => (checkIndex === index ? { ...check, ...patch } : check));
    return { ...current, checks };
  });
}

void plural;
