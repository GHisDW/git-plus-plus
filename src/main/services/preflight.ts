import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  CheckResult,
  CheckStatus,
  PreflightCheckConfig,
  PreflightConfig,
  PreflightRun,
  RepoSnapshot,
  Settings,
} from '../../shared/types';
import { ERR } from '../../shared/errors';
import { GitError } from '../git/errors';
import type { GitService } from '../git/GitService';
import { runProcess, ProcessError } from '../process';
import { suggestChecks } from '../../shared/templates';

const MAX_RUNS_PER_REPO = 8;
const MAX_OUTPUT = 200_000;

interface RunInternal extends PreflightRun {
  cancelled: boolean;
}

export class PreflightService {
  private configs = new Map<string, PreflightConfig>();
  private runs = new Map<string, RunInternal[]>();
  private controllers = new Map<string, AbortController>();
  private readonly file: string;

  constructor(
    dataDir: string,
    private readonly git: GitService,
    private readonly settings: () => Settings,
    private readonly onProgress: (repoPath: string, runId: string) => void = () => undefined,
  ) {
    this.file = path.join(dataDir, 'preflight.json');
  }

  async load(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8')) as Record<string, PreflightConfig>;
      for (const [key, value] of Object.entries(raw)) {
        if (value && Array.isArray(value.checks)) this.configs.set(key, value);
      }
    } catch {
      this.configs.clear();
    }
  }

  private async persist(): Promise<void> {
    const payload: Record<string, PreflightConfig> = {};
    for (const [key, value] of this.configs) payload[key] = value;
    const temp = `${this.file}.tmp`;
    await fs.writeFile(temp, JSON.stringify(payload, null, 2), 'utf8');
    await fs.rename(temp, this.file);
  }

  private key(repoPath: string): string {
    return path.resolve(repoPath);
  }

  async detect(repoPath: string): Promise<PreflightCheckConfig[]> {
    const root = this.key(repoPath);
    const hasPackageJson = existsSync(path.join(root, 'package.json'));
    let packageManager: string | null = null;
    if (existsSync(path.join(root, 'pnpm-lock.yaml'))) packageManager = 'pnpm';
    else if (existsSync(path.join(root, 'yarn.lock'))) packageManager = 'yarn';
    else if (existsSync(path.join(root, 'bun.lockb'))) packageManager = 'bun';
    else if (hasPackageJson) packageManager = 'npm';

    let scripts: Record<string, string> = {};
    if (hasPackageJson) {
      try {
        const parsed = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
        scripts = parsed.scripts ?? {};
      } catch {
        scripts = {};
      }
    }
    const suggests = suggestChecks(root, {
      hasPackageJson,
      packageManager,
      hasPyproject: existsSync(path.join(root, 'pyproject.toml')) || existsSync(path.join(root, 'pytest.ini')),
      hasCargo: existsSync(path.join(root, 'Cargo.toml')),
      hasGo: existsSync(path.join(root, 'go.mod')),
    });
    for (const check of suggests) {
      if (check.type !== 'command') continue;
      const scriptName = check.args[check.args.length - 1];
      if (check.id === 'tests') check.enabled = Boolean(scripts.test);
      else if (scriptName) check.enabled = Boolean(scripts[scriptName]);
    }
    return suggests;
  }

  async getConfig(repoPath: string): Promise<PreflightConfig> {
    const key = this.key(repoPath);
    const existing = this.configs.get(key);
    if (existing) return structuredClone(existing);
    const checks = await this.detect(key);
    return {
      repoPath: key,
      trustCommands: this.settings().preflight.defaultTrustCommands,
      blockCommitOnFailure: false,
      checks,
      updatedAt: new Date().toISOString(),
    };
  }

  async setConfig(repoPath: string, patch: Pick<PreflightConfig, 'trustCommands' | 'blockCommitOnFailure' | 'checks'>): Promise<PreflightConfig> {
    const key = this.key(repoPath);
    if (!existsSync(key)) throw new GitError(ERR.notFound('Repository folder no longer exists.'));
    const ids = new Set<string>();
    for (const check of patch.checks) {
      if (ids.has(check.id)) throw new GitError(ERR.validation(`Duplicate check id: ${check.id}`));
      ids.add(check.id);
      if (check.type === 'command') {
        if (!check.command || !check.command.trim()) throw new GitError(ERR.validation(`Check "${check.name}" needs a command.`));
        if (check.command.includes('\0')) throw new GitError(ERR.validation('Invalid command.'));
      }
      if (check.timeoutMs < 1000 || check.timeoutMs > 3_600_000) throw new GitError(ERR.validation('Timeouts must be between 1 second and 1 hour.'));
    }
    if (patch.checks.filter((check) => check.enabled).length === 0) {
      throw new GitError(ERR.validation('Enable at least one check.'));
    }
    const config: PreflightConfig = {
      repoPath: key,
      trustCommands: patch.trustCommands,
      blockCommitOnFailure: patch.blockCommitOnFailure,
      checks: patch.checks,
      updatedAt: new Date().toISOString(),
    };
    this.configs.set(key, config);
    await this.persist();
    return structuredClone(config);
  }

  private async fingerprint(snapshot: RepoSnapshot): Promise<string> {
    const payload = JSON.stringify({
      head: snapshot.info.head.oid,
      branch: snapshot.info.head.branch,
      files: snapshot.files.map((file) => [file.path, file.index, file.worktree, file.staged]),
      operation: snapshot.operation.kind,
      conflicts: snapshot.operation.conflicts,
    });
    return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 32);
  }

  async start(repoPath: string, checkIds?: string[]): Promise<PreflightRun> {
    const key = this.key(repoPath);
    const active = (this.runs.get(key) ?? []).find((run) => run.status === 'running');
    if (active) return this.publicRun(active);

    const config = await this.getConfig(key);
    const selected = config.checks.filter((check) => check.enabled && (!checkIds || checkIds.includes(check.id)));
    if (selected.length === 0) throw new GitError(ERR.validation('No enabled checks to run.'));
    const snapshot = await this.git.snapshot(key);
    const fingerprint = await this.fingerprint(snapshot);
    const controller = new AbortController();
    const run: RunInternal = {
      id: crypto.randomUUID(),
      repoPath: key,
      branch: snapshot.info.head.branch,
      headSha: snapshot.info.head.oid,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      status: 'running',
      results: selected.map((check) => ({
        checkId: check.id,
        name: check.name,
        type: check.type,
        commandLine: check.type === 'command' && check.command ? [check.command, ...check.args].join(' ') : null,
        status: 'queued' as CheckStatus,
        exitCode: null,
        durationMs: 0,
        output: '',
        outputTruncated: false,
        summary: 'Queued',
        stateFingerprint: fingerprint,
      })),
      fingerprint,
      stale: false,
      cancelled: false,
    };
    const list = this.runs.get(key) ?? [];
    list.unshift(run);
    this.runs.set(key, list.slice(0, MAX_RUNS_PER_REPO));
    this.controllers.set(run.id, controller);

    void this.execute(run, snapshot, selected, controller);
    return this.publicRun(run);
  }

  private async execute(
    run: RunInternal,
    snapshot: RepoSnapshot,
    checks: PreflightCheckConfig[],
    controller: AbortController,
  ): Promise<void> {
    try {
      for (const check of checks) {
        const result = run.results.find((entry) => entry.checkId === check.id);
        if (!result) continue;
        if (controller.signal.aborted) {
          result.status = 'cancelled';
          result.summary = 'Cancelled before this check started.';
          continue;
        }
        result.status = 'running';
        result.summary = 'Running…';
        this.onProgress(run.repoPath, run.id);
        const started = Date.now();
        try {
          await this.runCheck(check, run, snapshot, result, controller.signal);
        } catch (error) {
          result.status = controller.signal.aborted ? 'cancelled' : 'failed';
          result.exitCode = error instanceof ProcessError ? error.result.exitCode : null;
          const message = error instanceof ProcessError ? error.result.stderr || error.message : String(error);
          result.output = `${result.output}\n${message}`.slice(-MAX_OUTPUT);
          result.summary = controller.signal.aborted ? 'Cancelled.' : `Check could not complete: ${message.slice(0, 300)}`;
        }
        result.durationMs = Date.now() - started;
        this.onProgress(run.repoPath, run.id);
      }
    } finally {
      this.controllers.delete(run.id);
      run.finishedAt = new Date().toISOString();
      const anyFailed = run.results.some((result) => ['failed', 'timed-out', 'cancelled'].includes(result.status));
      const skippedRequired = run.results.some(
        (result) => result.status === 'skipped' && checks.find((check) => check.id === result.checkId)?.required,
      );
      run.status = run.cancelled ? 'cancelled' : anyFailed || skippedRequired ? 'failed' : 'passed';
      this.onProgress(run.repoPath, run.id);
    }
  }

  private async runCheck(
    check: PreflightCheckConfig,
    run: RunInternal,
    snapshot: RepoSnapshot,
    result: CheckResult,
    signal: AbortSignal,
  ): Promise<void> {
    if (check.type === 'status') {
      const { staged, unstaged, untracked, conflicted } = snapshot.stats;
      result.status = conflicted > 0 ? 'failed' : 'passed';
      result.summary = conflicted > 0
        ? `${conflicted} conflicted file(s) present.`
        : `${staged} staged, ${unstaged} unstaged, ${untracked} untracked. Review before committing.`;
      result.exitCode = 0;
      return;
    }
    if (check.type === 'conflicts') {
      result.status = snapshot.operation.conflicts.length > 0 ? 'failed' : 'passed';
      result.exitCode = 0;
      result.summary = snapshot.operation.conflicts.length > 0
        ? `Unresolved conflicts: ${snapshot.operation.conflicts.slice(0, 5).join(', ')}`
        : 'No unresolved conflicts.';
      return;
    }
    if (check.type === 'secret-scan') {
      await this.secretScan(run.repoPath, result, signal);
      return;
    }
    if (check.type === 'command' || check.type === 'custom') {
      if (!check.command) {
        result.status = 'skipped';
        result.summary = 'No command configured.';
        return;
      }
      if (!this.configTrusted(run.repoPath)) {
        result.status = 'skipped';
        result.summary = 'Command execution is not authorized for this repository. Enable command trust in Preflight settings to run it.';
        return;
      }
      const outcome = await runProcess({
        command: check.command,
        args: check.args,
        cwd: run.repoPath,
        timeoutMs: check.timeoutMs,
        maxOutputBytes: 256 * 1024,
        signal,
      }).catch((error: unknown) => error as ProcessError);
      if (outcome instanceof ProcessError) {
        result.exitCode = outcome.result.exitCode;
        result.output = `${outcome.result.stdout}\n${outcome.result.stderr}`.trim();
        result.outputTruncated = outcome.result.truncated;
        if (outcome.code === 'TIMEOUT') {
          result.status = 'timed-out';
          result.summary = `Timed out after ${Math.round(check.timeoutMs / 1000)}s.`;
        } else if (outcome.code === 'CANCELLED') {
          result.status = 'cancelled';
          result.summary = 'Cancelled.';
        } else if (outcome.code === 'ENOENT') {
          result.status = 'failed';
          result.summary = `Tool not found: ${check.command}. Install it or change the command.`;
        } else {
          result.status = 'failed';
          result.summary = `Exited with code ${outcome.result.exitCode}.`;
        }
        return;
      }
      result.exitCode = outcome.exitCode;
      result.output = `${outcome.stdout}\n${outcome.stderr}`.trim().slice(0, MAX_OUTPUT);
      result.outputTruncated = outcome.truncated;
      result.status = outcome.exitCode === 0 ? 'passed' : 'failed';
      result.summary = outcome.exitCode === 0 ? 'Command completed successfully.' : `Exited with code ${outcome.exitCode}.`;
      return;
    }
    result.status = 'skipped';
    result.summary = 'Unsupported check type.';
  }

  private configTrusted(repoPath: string): boolean {
    const config = this.configs.get(this.key(repoPath));
    return config?.trustCommands ?? false;
  }

  private async secretScan(repoPath: string, result: CheckResult, signal: AbortSignal): Promise<void> {
    const diff = await this.git.diff({ repoPath, target: 'staged', context: 0 });
    const patterns: Array<{ name: string; regex: RegExp }> = [
      { name: 'AWS access key', regex: /AKIA[0-9A-Z]{16}/ },
      { name: 'GitHub token', regex: /(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/ },
      { name: 'Private key block', regex: /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
      { name: 'Slack token', regex: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
      { name: 'Generic secret assignment', regex: /(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[=:]\s*['"][^'"\s]{8,}['"]/i },
    ];
    const findings: string[] = [];
    if (signal.aborted) throw new ProcessError('CANCELLED', 'Cancelled', {
      stdout: '', stderr: '', exitCode: null, signal: null, durationMs: 0, timedOut: false, cancelled: true, truncated: false, commandLine: '',
    });
    for (const file of diff.files) {
      for (const hunk of file.hunks) {
        for (const line of hunk.lines) {
          if (line.kind !== 'add') continue;
          for (const pattern of patterns) {
            if (pattern.regex.test(line.text)) {
              const masked = line.text.replace(/[A-Za-z0-9_+/=-]{6,}/g, (match) => `${match.slice(0, 3)}***`);
              findings.push(`${file.newPath}:${line.newNumber ?? '?'} ${pattern.name}: ${masked.trim().slice(0, 200)}`);
              break;
            }
          }
        }
      }
    }
    const conflicts = diff.text.match(/^(?:<<<<<<<|>>>>>>>) /gm);
    if (conflicts) findings.push('Conflict markers found in staged changes.');
    result.output = findings.join('\n').slice(0, MAX_OUTPUT);
    result.outputTruncated = findings.join('\n').length > MAX_OUTPUT;
    result.exitCode = findings.length > 0 ? 1 : 0;
    result.status = findings.length > 0 ? 'failed' : 'passed';
    result.summary = findings.length > 0
      ? `${findings.length} potential secret or conflict marker finding(s) in staged changes. Review before committing.`
      : 'No obvious secrets or conflict markers in staged changes.';
  }

  async getRun(repoPath: string, runId: string): Promise<PreflightRun> {
    const run = (this.runs.get(this.key(repoPath)) ?? []).find((entry) => entry.id === runId);
    if (!run) throw new GitError(ERR.notFound('Preflight run not found. It may have been cleared by restarting Git++.'));
    if (run.status !== 'running') await this.refreshStale(run);
    return this.publicRun(run);
  }

  async runsFor(repoPath: string): Promise<PreflightRun[]> {
    const list = this.runs.get(this.key(repoPath)) ?? [];
    for (const run of list) if (run.status !== 'running') await this.refreshStale(run);
    return list.map((run) => this.publicRun(run));
  }

  private async refreshStale(run: RunInternal): Promise<void> {
    try {
      const snapshot = await this.git.snapshot(run.repoPath);
      const current = await this.fingerprint(snapshot);
      run.stale = current !== run.fingerprint;
      if (run.stale && run.status !== 'cancelled') run.status = 'stale';
    } catch {
      run.stale = true;
    }
  }

  async cancel(repoPath: string, runId: string): Promise<PreflightRun> {
    const run = (this.runs.get(this.key(repoPath)) ?? []).find((entry) => entry.id === runId);
    if (!run) throw new GitError(ERR.notFound('Preflight run not found.'));
    run.cancelled = true;
    this.controllers.get(runId)?.abort();
    for (const result of run.results) {
      if (result.status === 'queued') {
        result.status = 'cancelled';
        result.summary = 'Cancelled.';
      }
    }
    return this.publicRun(run);
  }

  private publicRun(run: RunInternal): PreflightRun {
    const { cancelled: _cancelled, ...rest } = run;
    void _cancelled;
    return structuredClone(rest);
  }
}
