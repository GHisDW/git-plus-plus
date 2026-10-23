import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import type {
  AdvancedOpResult,
  BranchComparison,
  BranchInfo,
  CommitDetails,
  CommitRequest,
  CommitResult,
  CommitSummary,
  ConfigEntry,
  ConflictFile,
  DiffFile,
  DiffFileSummary,
  DiffRequest,
  DiffResult,
  FileHistoryEntry,
  IdentityInfo,
  LogRequest,
  LogResult,
  OperationState,
  RemoteInfo,
  RemoteOpResult,
  RepoInfo,
  RepoSnapshot,
  StashEntry,
  StatusEntry,
  TagInfo,
  TextFile,
  WorktreeInfo,
} from '../../shared/types';
import { ERR, makeError } from '../../shared/errors';
import { assignLanes } from '../../shared/graph';
import { parseDiff } from '../../shared/diff';
import { parsePorcelainV2, statusStats } from '../../shared/status';
import { languageForPath, isProbablyBinary } from '../../shared/lang';
import { GitError, translateGitFailure } from './errors';
import { GitRunner } from './runner';
import {
  LOG_FORMAT,
  parseBranches,
  parseConfig,
  parseFileHistory,
  parseLog,
  parseRemotes,
  parseStashes,
  parseTags,
  parseWorktrees,
} from './parse';
import { canonicalizeExisting, resolveInsideRepo, validateRelativePath } from './paths';

const MAX_DIFF_BYTES = 6 * 1024 * 1024;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export interface DiffPrefs {
  context: number;
  ignoreWhitespace: boolean;
}

interface RepoContext {
  root: string;
  gitDir: string;
  bare: boolean;
  shallow: boolean;
}

/**
 * All repository operations. Every method validates paths and revisions before
 * invoking Git with an argument array; nothing is passed through a shell.
 */
export class GitService {
  constructor(
    private readonly runner: GitRunner,
    private readonly diffPrefs: () => DiffPrefs = () => ({ context: 3, ignoreWhitespace: false }),
  ) {}

  setGitPath(pathValue: string): void {
    this.runner.setGitPath(pathValue);
  }

  getGitPath(): string {
    return this.runner.getGitPath();
  }

  async detect(): Promise<{ available: boolean; version: string | null; path: string; error: string | null }> {
    const detected = await this.runner.detect();
    return { ...detected, error: detected.error?.message ?? null };
  }

  private async context(repoPath: string): Promise<RepoContext> {
    const root = await canonicalizeExisting(repoPath);
    const result = await this.runner.run({
      cwd: root,
      args: ['rev-parse', '--show-toplevel', '--git-dir', '--is-bare-repository', '--is-shallow-repository'],
      timeoutMs: 20_000,
    });
    const lines = result.stdout.split(/\r?\n/).filter(Boolean);
    const topLevel = lines[0];
    const gitDirRaw = lines[1];
    if (!topLevel || !gitDirRaw) throw new GitError(ERR.notRepo(repoPath));
    return {
      root: path.resolve(topLevel),
      gitDir: path.resolve(root, gitDirRaw),
      bare: lines[2] === 'true',
      shallow: lines[3] === 'true',
    };
  }

  private async identity(repoPath: string): Promise<IdentityInfo> {
    const read = async (key: string): Promise<string | null> => {
      const result = await this.runner.run({ cwd: repoPath, args: ['config', '--get', key], allowNonZero: true, timeoutMs: 10_000 });
      return result.stdout.trim() || null;
    };
    return { name: await read('user.name'), email: await read('user.email') };
  }

  async info(repoPath: string): Promise<RepoInfo> {
    const ctx = await this.context(repoPath);
    const [status, identity, version] = await Promise.all([
      this.rawStatus(ctx.root),
      this.identity(ctx.root),
      this.runner.version(ctx.root).catch(() => ''),
    ]);
    return {
      path: ctx.root,
      name: path.basename(ctx.root),
      gitDir: ctx.gitDir,
      head: status.head,
      identity,
      isShallow: ctx.shallow,
      gitVersion: version.replace(/^git version\s*/i, '').trim(),
    };
  }

  private async rawStatus(root: string) {
    const result = await this.runner.run({
      cwd: root,
      args: ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all', '--find-renames'],
      timeoutMs: 60_000,
      maxOutputBytes: MAX_DIFF_BYTES,
    });
    return parsePorcelainV2(result.stdout);
  }

  private async gitPath(root: string, name: string): Promise<string> {
    const result = await this.runner.run({ cwd: root, args: ['rev-parse', '--git-path', name], timeoutMs: 10_000 });
    return path.resolve(root, result.stdout.trim());
  }

  async operationState(repoPath: string): Promise<{ state: OperationState; ctx: RepoContext }> {
    const ctx = await this.context(repoPath);
    const entries = (await this.rawStatus(ctx.root)).entries;
    const conflicts = entries.filter((entry) => entry.conflicted).map((entry) => entry.path);
    const exists = async (name: string) => existsSync(await this.gitPath(ctx.root, name));
    let kind: OperationState['kind'] = null;
    let description: string | null = null;
    if (await exists('MERGE_HEAD')) {
      kind = 'merge';
      const message = await fs.readFile(await this.gitPath(ctx.root, 'MERGE_MSG'), 'utf8').catch(() => '');
      description = `Merging: ${message.split(/\r?\n/)[0]?.replace(/^Merge branch '([^']+)'.*$/, '$1') ?? 'in progress'}`;
    } else if (await exists('rebase-merge') || await exists('rebase-apply')) {
      kind = (await exists('rebase-apply/applying')) ? 'am' : 'rebase';
      const headName = await fs.readFile(await this.gitPath(ctx.root, 'rebase-merge/head-name'), 'utf8').catch(() => '');
      const onto = await fs.readFile(await this.gitPath(ctx.root, 'rebase-merge/onto'), 'utf8').catch(() => '');
      description = `Rebasing ${headName.trim().replace('refs/heads/', '') || 'branch'} onto ${onto.trim().slice(0, 7) || 'upstream'}`;
    } else if (await exists('CHERRY_PICK_HEAD')) {
      kind = 'cherry-pick';
      description = 'Cherry-pick in progress';
    } else if (await exists('REVERT_HEAD')) {
      kind = 'revert';
      description = 'Revert in progress';
    }
    return {
      ctx,
      state: { kind, conflicts, description, canContinue: Boolean(kind) && conflicts.length === 0 },
    };
  }

  async state(repoPath: string): Promise<OperationState> {
    return (await this.operationState(repoPath)).state;
  }

  async snapshot(repoPath: string): Promise<RepoSnapshot> {
    const { ctx, state } = await this.operationState(repoPath);
    const [status, identity, version] = await Promise.all([
      this.rawStatus(ctx.root),
      this.identity(ctx.root),
      this.runner.version(ctx.root).catch(() => ''),
    ]);
    const head = { ...status.head, ...(status.head.branch === null && !status.head.detached ? {} : {}) };
    return {
      info: {
        path: ctx.root,
        name: path.basename(ctx.root),
        gitDir: ctx.gitDir,
        head,
        identity,
        isShallow: ctx.shallow,
        gitVersion: version.replace(/^git version\s*/i, '').trim(),
      },
      files: status.entries,
      operation: state,
      stats: statusStats(status.entries),
      refreshedAt: new Date().toISOString(),
    };
  }

  async open(repoPath: string): Promise<RepoSnapshot> {
    const snapshot = await this.snapshot(repoPath);
    return snapshot;
  }

  async init(folder: string): Promise<RepoSnapshot> {
    const root = await canonicalizeExisting(folder);
    const gitFolder = path.join(root, '.git');
    if (!existsSync(gitFolder)) {
      await this.runner.run({ cwd: root, args: ['init'], timeoutMs: 60_000 });
    }
    return this.snapshot(root);
  }

  async clone(url: string, destination: string, branch?: string): Promise<RepoSnapshot> {
    if (!/^(https?:\/\/|git@|ssh:\/\/)/i.test(url)) {
      throw new GitError(ERR.validation('Enter an HTTPS or SSH Git URL.', 'Local paths cannot be cloned from this screen.'));
    }
    const target = path.resolve(destination);
    if (existsSync(target)) {
      const entries = await fs.readdir(target).catch(() => [] as string[]);
      if (entries.length > 0) throw new GitError(ERR.validation('The destination folder is not empty.'));
    } else {
      await fs.mkdir(path.dirname(target), { recursive: true });
    }
    const args = ['clone', '--progress'];
    if (branch) args.push('--branch', branch);
    args.push('--', url, target);
    await this.runner.run({ cwd: path.dirname(target), args, timeoutMs: 10 * 60_000, maxOutputBytes: 2 * 1024 * 1024 });
    return this.snapshot(target);
  }

  /* ----------------------------- staging ----------------------------- */

  private validatePaths(paths: string[]): string[] {
    return paths.map((value) => validateRelativePath(value));
  }

  async stage(repoPath: string, paths: string[]): Promise<RepoSnapshot> {
    const ctx = await this.context(repoPath);
    const safePaths = this.validatePaths(paths);
    await this.runner.run({ cwd: ctx.root, args: ['add', '--', ...safePaths], timeoutMs: 60_000 });
    return this.snapshot(ctx.root);
  }

  async unstage(repoPath: string, paths: string[]): Promise<RepoSnapshot> {
    const ctx = await this.context(repoPath);
    const safePaths = this.validatePaths(paths);
    const status = await this.rawStatus(ctx.root);
    if (status.head.unborn) {
      await this.runner.run({ cwd: ctx.root, args: ['rm', '--cached', '-r', '--', ...safePaths], timeoutMs: 60_000 });
    } else {
      await this.runner.run({ cwd: ctx.root, args: ['restore', '--staged', '--', ...safePaths], timeoutMs: 60_000 });
    }
    return this.snapshot(ctx.root);
  }

  async discard(repoPath: string, entries: Array<{ path: string; staged: boolean; untracked: boolean }>): Promise<RepoSnapshot> {
    const ctx = await this.context(repoPath);
    const status = await this.rawStatus(ctx.root);
    const byPath = new Map(status.entries.map((entry) => [entry.path, entry]));
    const toRestoreWorktree: string[] = [];
    const toUnstage: string[] = [];

    for (const requested of entries) {
      const safe = validateRelativePath(requested.path);
      const entry: StatusEntry | undefined = byPath.get(safe);
      if (!entry) throw new GitError(ERR.notFound(`File is no longer changed: ${safe}`));
      if (entry.conflicted) {
        throw new GitError(
          makeError('GIT_CONFLICT', 'conflict', `Cannot discard ${safe} while it is conflicted.`, {
            hint: 'Resolve the conflict, or abort the in-progress merge/rebase from the conflict workspace.',
          }),
        );
      }
      if (entry.untracked) {
        const absolute = await resolveInsideRepo(ctx.root, safe);
        const stat = await fs.lstat(absolute);
        if (stat.isDirectory()) await fs.rm(absolute, { recursive: true, force: false });
        else await fs.unlink(absolute);
        continue;
      }
      if (requested.staged) toUnstage.push(safe);
      if (entry.unstaged || (!entry.staged && requested.staged)) toRestoreWorktree.push(safe);
    }

    if (toRestoreWorktree.length > 0) {
      await this.runner.run({ cwd: ctx.root, args: ['restore', '--worktree', '--', ...toRestoreWorktree], timeoutMs: 60_000 });
    }
    if (toUnstage.length > 0) {
      if (status.head.unborn) {
        await this.runner.run({ cwd: ctx.root, args: ['rm', '--cached', '-r', '--', ...toUnstage], timeoutMs: 60_000 });
      } else {
        await this.runner.run({ cwd: ctx.root, args: ['restore', '--staged', '--', ...toUnstage], timeoutMs: 60_000 });
      }
    }
    return this.snapshot(ctx.root);
  }

  async applyPatch(repoPath: string, patch: string, direction: 'stage' | 'unstage'): Promise<RepoSnapshot> {
    const ctx = await this.context(repoPath);
    if (!patch.includes('diff --git') || patch.length > 2_000_000) {
      throw new GitError(ERR.validation('The selected patch is not valid.'));
    }
    for (const line of patch.split('\n')) {
      if (line.startsWith('diff --git ')) {
        const rest = line.slice('diff --git '.length);
        if (rest.includes('..') || rest.includes('/dev/fd') || rest.includes('/proc/') || rest.includes('\\0')) {
          throw new GitError(ERR.unsafePath('The patch references an unsafe path.'));
        }
      }
    }
    const args = ['apply', '--cached', '--recount', '--whitespace=nowarn', ...(direction === 'unstage' ? ['--reverse'] : [])];
    await this.runner.run({ cwd: ctx.root, args, input: patch, timeoutMs: 60_000 });
    return this.snapshot(ctx.root);
  }

  /* ------------------------------- diff ------------------------------- */

  async diff(request: DiffRequest): Promise<DiffResult> {
    const ctx = await this.context(request.repoPath);
    const prefs = this.diffPrefs();
    const context = request.context ?? prefs.context;
    const ignoreWhitespace = request.ignoreWhitespace ?? prefs.ignoreWhitespace;
    const baseArgs = ['diff', '--no-color', '--no-ext-diff', '-M', `--unified=${context}`];
    if (ignoreWhitespace) baseArgs.push('--ignore-all-space');
    let compared = 'Working tree';
    let args: string[];
    let allowNonZero = false;

    if (request.target === 'worktree') {
      args = [...baseArgs, '--'];
      if (request.path) args.push(validateRelativePath(request.path));
    } else if (request.target === 'staged') {
      args = [...baseArgs, '--cached', '--'];
      if (request.path) args.push(validateRelativePath(request.path));
      compared = 'Staged changes';
    } else if (request.target === 'commit') {
      if (!request.commit) throw new GitError(ERR.validation('A commit is required.'));
      const commit = request.commit;
      args = ['show', '--no-color', '--no-ext-diff', '-M', `--unified=${context}`, '--format=', commit, '--'];
      if (request.path) args.push(validateRelativePath(request.path));
      compared = `Commit ${commit.slice(0, 7)}`;
    } else if (request.target === 'range') {
      if (!request.from || !request.to) throw new GitError(ERR.validation('Both references are required.'));
      args = [...baseArgs, `${request.from}..${request.to}`, '--'];
      if (request.path) args.push(validateRelativePath(request.path));
      compared = `${request.from}..${request.to}`;
    } else {
      if (!request.stashRef) throw new GitError(ERR.validation('A stash reference is required.'));
      args = ['stash', 'show', '-p', '--no-color', '--no-ext-diff', `--unified=${context}`, request.stashRef];
      compared = request.stashRef;
      allowNonZero = true;
    }

    const result = await this.runner.run({
      cwd: ctx.root,
      args,
      timeoutMs: 120_000,
      maxOutputBytes: MAX_DIFF_BYTES,
      allowNonZero,
    });
    let parsed = parseDiff(result.stdout);
    if (request.target === 'worktree' && !request.path) {
      const status = await this.rawStatus(ctx.root);
      parsed = await this.appendUntrackedDiff(ctx.root, parsed, status.entries);
    }
    return { ...parsed, compared };
  }

  private async appendUntrackedDiff(root: string, diff: DiffResult, entries: StatusEntry[]): Promise<DiffResult> {
    const untracked = entries.filter((entry) => entry.untracked).slice(0, 40);
    const files: DiffFile[] = [...diff.files];
    for (const entry of untracked) {
      try {
        const absolute = await resolveInsideRepo(root, entry.path);
        const stat = await fs.stat(absolute);
        if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
        const buffer = await fs.readFile(absolute);
        if (isProbablyBinary(buffer)) {
          files.push({
            oldPath: entry.path,
            newPath: entry.path,
            displayPath: entry.path,
            status: 'added',
            binary: true,
            tooLarge: false,
            additions: 0,
            deletions: 0,
            hunks: [],
            patch: '',
            language: languageForPath(entry.path),
          });
          continue;
        }
        const text = buffer.toString('utf8');
        const lines = text.split(/\r?\n/);
        if (lines.length > 5000) continue;
        files.push({
          oldPath: entry.path,
          newPath: entry.path,
          displayPath: entry.path,
          status: 'added',
          binary: false,
          tooLarge: false,
          additions: lines.length,
          deletions: 0,
          hunks: [
            {
              header: `@@ -0,0 +1,${lines.length} @@`,
              oldStart: 0,
              oldLines: 0,
              newStart: 1,
              newLines: lines.length,
              lines: lines.map((line, index) => ({ kind: 'add', text: line, oldNumber: null, newNumber: index + 1 })),
            },
          ],
          patch: '',
          language: languageForPath(entry.path),
        });
      } catch {
        // A file may disappear between status and diff; ignore it.
      }
    }
    const additions = files.reduce((sum, file) => sum + file.additions, 0);
    const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
    return { ...diff, files, stats: { files: files.length, additions, deletions } };
  }

  /* ------------------------------ commit ------------------------------ */

  async commit(request: CommitRequest): Promise<CommitResult> {
    const ctx = await this.context(request.repoPath);
    const message = request.message.replace(/\r\n/g, '\n').trim();
    if (!message) throw new GitError(ERR.validation('A commit message is required.'));
    if (message.length > 20_000) throw new GitError(ERR.validation('The commit message is too long.'));
    const status = await this.rawStatus(ctx.root);
    const conflicts = status.entries.filter((entry) => entry.conflicted);
    if (conflicts.length > 0) {
      throw new GitError(
        makeError('GIT_CONFLICT', 'conflict', 'Resolve all conflicts before committing.', {
          hint: `Unresolved: ${conflicts.slice(0, 5).map((entry) => entry.path).join(', ')}`,
        }),
      );
    }
    const staged = status.entries.filter((entry) => entry.staged);
    if (staged.length === 0 && !request.amend && !request.allowEmpty) {
      throw new GitError(
        makeError('GIT_FAILED', 'git', 'Nothing is staged for commit.', {
          hint: 'Git++ never stages files automatically. Select the changes you want and stage them first.',
        }),
      );
    }
    const fullMessage = [message, request.description?.trim()].filter(Boolean).join('\n\n');
    const args = ['commit', '--cleanup=strip', '-F', '-'];
    if (request.amend) args.push('--amend');
    if (request.signoff) args.push('--signoff');
    if (request.allowEmpty) args.push('--allow-empty');
    await this.runner.run({ cwd: ctx.root, args, input: `${fullMessage}\n`, timeoutMs: 5 * 60_000, maxOutputBytes: 2 * 1024 * 1024 });
    const head = await this.runner.run({ cwd: ctx.root, args: ['rev-parse', 'HEAD'], timeoutMs: 20_000 });
    const sha = head.stdout.trim();
    const numstat = await this.runner.run({ cwd: ctx.root, args: ['show', '--numstat', '--format=', sha], timeoutMs: 60_000, allowNonZero: true });
    return {
      sha,
      shortSha: sha.slice(0, 7),
      subject: message.split('\n')[0] ?? message,
      filesChanged: numstat.stdout.split('\n').filter((line) => line.trim()).length,
    };
  }

  /* ------------------------------ history ----------------------------- */

  async log(request: LogRequest): Promise<LogResult> {
    const ctx = await this.context(request.repoPath);
    const status = await this.rawStatus(ctx.root);
    const limit = request.limit ?? 100;
    const args = ['log', '--date=iso-strict', `--format=${LOG_FORMAT}`, '--topo-order', '--no-color', `--max-count=${limit + 1}`];
    if (request.skip) args.push(`--skip=${request.skip}`);
    if (request.all) args.push('--all');
    if (request.search) args.push('--regexp-ignore-case', '--fixed-strings', `--grep=${request.search}`);
    const ref = request.ref ?? (request.all ? null : 'HEAD');
    if (ref) args.push(ref);
    if (request.path) args.push('--', validateRelativePath(request.path));
    if (status.head.unborn && !request.all) {
      return { commits: [], hasMore: false, headSha: null };
    }
    const result = await this.runner.run({ cwd: ctx.root, args, timeoutMs: 120_000, maxOutputBytes: MAX_DIFF_BYTES });
    const commits = parseLog(result.stdout);
    const hasMore = commits.length > limit;
    const page = assignLanes(commits.slice(0, limit));
    return { commits: page, hasMore, headSha: status.head.oid };
  }

  async searchCommits(repoPath: string, query: string, limit = 100): Promise<LogResult> {
    return this.log({ repoPath, search: query, limit, all: true });
  }

  async commitDetails(repoPath: string, sha: string): Promise<CommitDetails> {
    const ctx = await this.context(repoPath);
    const log = await this.logger(ctx, ['-1', sha]);
    const commit = log[0];
    if (!commit) throw new GitError(ERR.notFound(`Commit not found: ${sha}`));
    const diff = await this.diff({ repoPath: ctx.root, target: 'commit', commit: commit.sha });
    const files: DiffFileSummary[] = diff.files.map((file) => ({
      path: file.newPath,
      ...(file.status === 'renamed' ? { oldPath: file.oldPath } : {}),
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      binary: file.binary,
    }));
    return { commit, files, diff };
  }

  private async logger(ctx: RepoContext, extra: string[]): Promise<CommitSummary[]> {
    const result = await this.runner.run({
      cwd: ctx.root,
      args: ['log', '--date=iso-strict', `--format=${LOG_FORMAT}`, '--no-color', ...extra],
      timeoutMs: 60_000,
      allowNonZero: true,
    });
    if (result.exitCode !== 0) throw new GitError(translateGitFailure(result.stderr, this.runner.getGitPath(), result.commandLine), result.stderr);
    return parseLog(result.stdout);
  }

  async fileHistory(repoPath: string, filePath: string, limit = 100): Promise<FileHistoryEntry[]> {
    const ctx = await this.context(repoPath);
    const safe = validateRelativePath(filePath);
    const format = `%x1e%H%x1f%h%x1f%an%x1f%aI%x1f%s`;
    const result = await this.runner.run({
      cwd: ctx.root,
      args: ['log', '--follow', `--format=${format}`, '--name-status', `--max-count=${limit}`, '--', safe],
      timeoutMs: 60_000,
      allowNonZero: true,
    });
    if (result.exitCode !== 0) return [];
    return parseFileHistory(result.stdout);
  }

  async showFile(repoPath: string, rev: string, filePath: string): Promise<TextFile> {
    const ctx = await this.context(repoPath);
    if (!/^[\w./~^@{}+-]+$/.test(rev)) throw new GitError(ERR.validation('Invalid revision.'));
    const safe = validateRelativePath(filePath);
    const result = await this.runner.run({
      cwd: ctx.root,
      args: ['show', `${rev}:${safe}`],
      timeoutMs: 60_000,
      maxOutputBytes: MAX_FILE_BYTES + 1024,
    });
    const content = result.stdout;
    const truncated = result.truncated || content.length > MAX_FILE_BYTES;
    return {
      path: safe,
      content: truncated ? content.slice(0, MAX_FILE_BYTES) : content,
      size: Buffer.byteLength(content),
      modifiedAt: new Date().toISOString(),
      version: String(Buffer.byteLength(content)),
      truncated,
    };
  }

  /* ----------------------------- branches ----------------------------- */

  async branches(repoPath: string): Promise<BranchInfo[]> {
    const ctx = await this.context(repoPath);
    const worktrees = parseWorktrees((await this.runner.run({ cwd: ctx.root, args: ['worktree', 'list', '--porcelain'], timeoutMs: 20_000 })).stdout);
    const map = new Map<string, string>();
    for (const worktree of worktrees) if (worktree.branch) map.set(worktree.branch, worktree.path);
    const result = await this.runner.run({
      cwd: ctx.root,
      args: [
        'for-each-ref',
        '--format=%(refname)%1f%(refname:short)%1f%(objectname)%1f%(objectname:short)%1f%(upstream:short)%1f%(HEAD)%1f%(committerdate:iso-strict)%1f%(subject)%1f%(upstream:track,nobracket)%1f%(symref)',
        'refs/heads',
        'refs/remotes',
      ],
      timeoutMs: 60_000,
    });
    return parseBranches(result.stdout, map);
  }

  private async assertBranchName(repoPath: string, name: string): Promise<void> {
    if (!name.trim() || name.startsWith('-')) throw new GitError(ERR.validation('Enter a valid branch name.'));
    const result = await this.runner.run({ cwd: repoPath, args: ['check-ref-format', '--branch', name], allowNonZero: true, timeoutMs: 10_000 });
    if (result.exitCode !== 0) {
      throw new GitError(
        makeError('INVALID_INPUT', 'validation', `Invalid branch name: ${name}`, {
          hint: 'Branch names cannot contain spaces, ~ ^ : ? * [ \\, start with a dash, or end with a dot.',
        }),
      );
    }
  }

  async createBranch(repoPath: string, name: string, startPoint?: string, checkout = true): Promise<BranchInfo[]> {
    const ctx = await this.context(repoPath);
    await this.assertBranchName(ctx.root, name);
    const args = checkout ? ['switch', '-c', name] : ['branch', name];
    if (startPoint) args.push(startPoint);
    await this.runner.run({ cwd: ctx.root, args, timeoutMs: 60_000 });
    return this.branches(ctx.root);
  }

  async switchBranch(repoPath: string, name: string): Promise<RepoSnapshot> {
    const ctx = await this.context(repoPath);
    const status = await this.rawStatus(ctx.root);
    if (status.head.branch === name) return this.snapshot(ctx.root);
    const dirty = status.entries.filter((entry) => entry.staged || entry.unstaged || entry.untracked);
    if (dirty.length > 0) {
      const targetDiff = await this.runner.run({
        cwd: ctx.root,
        args: ['diff', '--name-only', 'HEAD', name, '--'],
        timeoutMs: 30_000,
        allowNonZero: true,
      });
      const changedOnTarget = new Set(targetDiff.stdout.split('\n').filter(Boolean));
      const overlap = dirty.filter((entry) => changedOnTarget.has(entry.path));
      if (overlap.length > 0) {
        throw new GitError(
          makeError('GIT_CONFLICT', 'conflict', `Switching to ${name} would overwrite local changes.`, {
            hint: `Commit or stash these files first: ${overlap.slice(0, 6).map((entry) => entry.path).join(', ')}`,
          }),
        );
      }
    }
    await this.runner.run({ cwd: ctx.root, args: ['switch', name], timeoutMs: 120_000 });
    return this.snapshot(ctx.root);
  }

  async renameBranch(repoPath: string, from: string, to: string): Promise<BranchInfo[]> {
    const ctx = await this.context(repoPath);
    await this.assertBranchName(ctx.root, to);
    await this.runner.run({ cwd: ctx.root, args: ['branch', '-m', from, to], timeoutMs: 30_000 });
    return this.branches(ctx.root);
  }

  async deleteBranch(repoPath: string, name: string, force: boolean): Promise<BranchInfo[]> {
    const ctx = await this.context(repoPath);
    const status = await this.rawStatus(ctx.root);
    if (status.head.branch === name) {
      throw new GitError(ERR.validation('The current branch cannot be deleted. Switch to another branch first.'));
    }
    await this.runner.run({ cwd: ctx.root, args: ['branch', force ? '-D' : '-d', name], timeoutMs: 60_000 });
    return this.branches(ctx.root);
  }

  async setUpstream(repoPath: string, branch: string, upstream: string): Promise<RepoSnapshot> {
    const ctx = await this.context(repoPath);
    await this.runner.run({ cwd: ctx.root, args: ['branch', `--set-upstream-to=${upstream}`, branch], timeoutMs: 30_000 });
    return this.snapshot(ctx.root);
  }

  async compareBranches(repoPath: string, base: string, head: string): Promise<BranchComparison> {
    const ctx = await this.context(repoPath);
    const counts = await this.runner.run({ cwd: ctx.root, args: ['rev-list', '--left-right', '--count', `${base}...${head}`], timeoutMs: 30_000 });
    const [left, right] = counts.stdout.trim().split(/\s+/).map(Number);
    const commits = await this.logger(ctx, ['--max-count=100', `${base}..${head}`]);
    const numstat = await this.runner.run({ cwd: ctx.root, args: ['diff', '--numstat', '--no-color', `${base}...${head}`], timeoutMs: 60_000, allowNonZero: true });
    const files: DiffFileSummary[] = [];
    for (const line of numstat.stdout.split('\n')) {
      if (!line.trim()) continue;
      const [adds, dels, ...rest] = line.split('\t');
      const filePath = rest.join('\t');
      const binary = adds === '-' || dels === '-';
      files.push({
        path: filePath,
        status: 'modified',
        additions: binary ? 0 : Number(adds),
        deletions: binary ? 0 : Number(dels),
        binary,
      });
    }
    return { base, head, ahead: right || 0, behind: left || 0, commits: assignLanes(commits), files };
  }

  /* --------------------------- advanced ops --------------------------- */

  private async mutation(repoPath: string, args: string[], timeoutMs = 120_000): Promise<AdvancedOpResult> {
    const ctx = await this.context(repoPath);
    const result = await this.runner.run({ cwd: ctx.root, args, timeoutMs, allowNonZero: true, maxOutputBytes: 2 * 1024 * 1024 });
    const snapshot = await this.snapshot(ctx.root);
    const conflicts = snapshot.operation.conflicts;
    if (result.exitCode !== 0 && conflicts.length === 0) {
      const stderr = result.stderr || result.stdout;
      if (!/already up to date|already up-to-date|nothing to commit|no local changes/i.test(stderr)) {
        throw new GitError(translateGitFailure(stderr, this.runner.getGitPath(), result.commandLine), stderr, result.exitCode);
      }
    }
    return { output: `${result.stdout}${result.stderr}`.trim(), snapshot, conflicts };
  }

  async merge(repoPath: string, ref: string, noFf = false): Promise<AdvancedOpResult> {
    return this.mutation(repoPath, ['merge', '--no-edit', ...(noFf ? ['--no-ff'] : []), ref]);
  }

  async rebase(repoPath: string, onto: string): Promise<AdvancedOpResult> {
    return this.mutation(repoPath, ['rebase', onto], 180_000);
  }

  async cherryPick(repoPath: string, sha: string): Promise<AdvancedOpResult> {
    return this.mutation(repoPath, ['cherry-pick', sha]);
  }

  async revert(repoPath: string, sha: string): Promise<AdvancedOpResult> {
    return this.mutation(repoPath, ['revert', '--no-edit', sha]);
  }

  /* ------------------------------- tags ------------------------------- */

  async tags(repoPath: string): Promise<TagInfo[]> {
    const ctx = await this.context(repoPath);
    const result = await this.runner.run({
      cwd: ctx.root,
      args: [
        'for-each-ref',
        '--format=%(refname:short)%1f%(objectname)%1f%(objecttype)%1f%(contents:subject)%1f%(creatordate:iso-strict)%1f%(taggername)',
        'refs/tags',
      ],
      timeoutMs: 30_000,
    });
    return parseTags(result.stdout);
  }

  async createTag(repoPath: string, name: string, target?: string, message?: string): Promise<TagInfo[]> {
    const ctx = await this.context(repoPath);
    if (!/^[\w][\w./-]{0,254}$/.test(name)) throw new GitError(ERR.validation('Enter a valid tag name.'));
    const args = message ? ['tag', '-a', name, '-m', message] : ['tag', name];
    if (target) args.push(target);
    await this.runner.run({ cwd: ctx.root, args, timeoutMs: 30_000 });
    return this.tags(ctx.root);
  }

  async deleteTag(repoPath: string, name: string): Promise<TagInfo[]> {
    const ctx = await this.context(repoPath);
    await this.runner.run({ cwd: ctx.root, args: ['tag', '-d', name], timeoutMs: 30_000 });
    return this.tags(ctx.root);
  }

  /* ------------------------------ remotes ----------------------------- */

  async remotes(repoPath: string): Promise<RemoteInfo[]> {
    const ctx = await this.context(repoPath);
    const [raw, branches] = await Promise.all([
      this.runner.run({ cwd: ctx.root, args: ['remote', '-v'], timeoutMs: 20_000 }),
      this.branches(ctx.root),
    ]);
    return parseRemotes(raw.stdout).map((remote) => ({
      ...remote,
      branches: branches.filter((branch) => branch.isRemote && branch.remote === remote.name).length,
    }));
  }

  private validateRemoteInput(name: string, url: string): void {
    if (!/^[A-Za-z0-9._-]+$/.test(name) || name.startsWith('-')) throw new GitError(ERR.validation('Remote names may only contain letters, digits, dots, dashes and underscores.'));
    if (url.startsWith('-') || /\s/.test(url)) throw new GitError(ERR.validation('Enter a valid remote URL without spaces.'));
  }

  async addRemote(repoPath: string, name: string, url: string): Promise<RemoteInfo[]> {
    const ctx = await this.context(repoPath);
    this.validateRemoteInput(name, url);
    await this.runner.run({ cwd: ctx.root, args: ['remote', 'add', name, url], timeoutMs: 30_000 });
    return this.remotes(ctx.root);
  }

  async editRemote(repoPath: string, name: string, url: string): Promise<RemoteInfo[]> {
    const ctx = await this.context(repoPath);
    this.validateRemoteInput(name, url);
    await this.runner.run({ cwd: ctx.root, args: ['remote', 'set-url', name, url], timeoutMs: 30_000 });
    return this.remotes(ctx.root);
  }

  async removeRemote(repoPath: string, name: string): Promise<RemoteInfo[]> {
    const ctx = await this.context(repoPath);
    await this.runner.run({ cwd: ctx.root, args: ['remote', 'remove', name], timeoutMs: 30_000 });
    return this.remotes(ctx.root);
  }

  private async remoteOperation(
    repoPath: string,
    operation: 'fetch' | 'pull' | 'push',
    args: string[],
    remote: string,
    branch: string | null,
    setUpstream?: boolean,
  ): Promise<RemoteOpResult> {
    const ctx = await this.context(repoPath);
    const result = await this.runner.run({
      cwd: ctx.root,
      args,
      timeoutMs: 5 * 60_000,
      maxOutputBytes: 2 * 1024 * 1024,
      allowNonZero: true,
    });
    if (result.exitCode !== 0) {
      throw new GitError(translateGitFailure(result.stderr || result.stdout, this.runner.getGitPath(), result.commandLine), result.stderr, result.exitCode);
    }
    return {
      operation,
      output: `${result.stdout}${result.stderr}`.trim(),
      remote,
      branch,
      ...(setUpstream !== undefined ? { setUpstream } : {}),
      snapshot: await this.snapshot(ctx.root),
    };
  }

  async fetch(repoPath: string, remote?: string, prune = false): Promise<RemoteOpResult> {
    const ctx = await this.context(repoPath);
    const remotes = await this.remotes(ctx.root);
    const chosen = remote ?? remotes[0]?.name ?? 'origin';
    if (remotes.length === 0) throw new GitError(ERR.validation('This repository has no remotes. Add one first.'));
    const args = ['fetch', '--progress', ...(prune ? ['--prune'] : []), chosen];
    return this.remoteOperation(ctx.root, 'fetch', args, chosen, null);
  }

  async pull(repoPath: string, remote?: string, branch?: string): Promise<RemoteOpResult> {
    const ctx = await this.context(repoPath);
    const status = await this.rawStatus(ctx.root);
    const remotes = await this.remotes(ctx.root);
    if (remotes.length === 0) throw new GitError(ERR.validation('This repository has no remotes. Add one first.'));
    const chosen = remote ?? remotes[0]?.name ?? 'origin';
    const current = branch ?? status.head.branch ?? undefined;
    if (!current) throw new GitError(ERR.validation('Check out a branch before pulling.'));
    const args = ['pull', '--ff-only', '--progress', chosen, current];
    return this.remoteOperation(ctx.root, 'pull', args, chosen, current);
  }

  async push(repoPath: string, remote?: string, branch?: string, setUpstream = false, forceWithLease = false): Promise<RemoteOpResult> {
    const ctx = await this.context(repoPath);
    const status = await this.rawStatus(ctx.root);
    const remotes = await this.remotes(ctx.root);
    if (remotes.length === 0) throw new GitError(ERR.validation('This repository has no remotes. Add one first.'));
    const chosen = remote ?? (status.head.upstream ? remotes.find((r) => status.head.upstream?.startsWith(r.name))?.name : remotes[0]?.name) ?? 'origin';
    const current = branch ?? status.head.branch;
    if (!current) throw new GitError(ERR.validation('Check out a branch before pushing.'));
    const args = ['push', '--progress'];
    if (forceWithLease) args.push('--force-with-lease');
    if (setUpstream) args.push('--set-upstream');
    args.push(chosen, current);
    return this.remoteOperation(ctx.root, 'push', args, chosen, current, setUpstream);
  }

  async pushTag(repoPath: string, tag: string, remote?: string): Promise<RemoteOpResult> {
    const ctx = await this.context(repoPath);
    const remotes = await this.remotes(ctx.root);
    if (remotes.length === 0) throw new GitError(ERR.validation('This repository has no remotes.'));
    const chosen = remote ?? remotes[0]?.name ?? 'origin';
    await this.runner.run({ cwd: ctx.root, args: ['push', '--progress', chosen, `refs/tags/${tag}`], timeoutMs: 5 * 60_000, maxOutputBytes: 2 * 1024 * 1024 });
    return { operation: 'push', output: `Pushed tag ${tag} to ${chosen}.`, remote: chosen, branch: tag };
  }

  /* ------------------------------ stash ------------------------------- */

  async stashes(repoPath: string): Promise<StashEntry[]> {
    const ctx = await this.context(repoPath);
    const result = await this.runner.run({
      cwd: ctx.root,
      args: ['stash', 'list', '--format=%gd%1f%H%1f%h%1f%gs%1f%aI'],
      timeoutMs: 30_000,
    });
    return parseStashes(result.stdout);
  }

  async createStash(repoPath: string, message?: string, includeUntracked = false): Promise<StashEntry[]> {
    const ctx = await this.context(repoPath);
    const args = ['stash', 'push', ...(includeUntracked ? ['--include-untracked'] : []), ...(message ? ['-m', message] : [])];
    const result = await this.runner.run({ cwd: ctx.root, args, timeoutMs: 120_000, allowNonZero: true });
    if (result.exitCode !== 0) {
      throw new GitError(translateGitFailure(result.stderr, this.runner.getGitPath(), result.commandLine), result.stderr);
    }
    return this.stashes(ctx.root);
  }

  async applyStash(repoPath: string, ref: string, pop: boolean): Promise<RepoSnapshot> {
    const ctx = await this.context(repoPath);
    if (!/^stash@\{\d+\}$/.test(ref)) throw new GitError(ERR.validation('Invalid stash reference.'));
    const result = await this.runner.run({ cwd: ctx.root, args: ['stash', pop ? 'pop' : 'apply', ref], timeoutMs: 120_000, allowNonZero: true });
    if (result.exitCode !== 0) {
      throw new GitError(
        translateGitFailure(result.stderr, this.runner.getGitPath(), result.commandLine),
        result.stderr,
      );
    }
    return this.snapshot(ctx.root);
  }

  async dropStash(repoPath: string, ref: string): Promise<StashEntry[]> {
    const ctx = await this.context(repoPath);
    if (!/^stash@\{\d+\}$/.test(ref)) throw new GitError(ERR.validation('Invalid stash reference.'));
    await this.runner.run({ cwd: ctx.root, args: ['stash', 'drop', ref], timeoutMs: 30_000 });
    return this.stashes(ctx.root);
  }

  /* ----------------------------- worktrees ---------------------------- */

  async worktrees(repoPath: string): Promise<WorktreeInfo[]> {
    const ctx = await this.context(repoPath);
    const result = await this.runner.run({ cwd: ctx.root, args: ['worktree', 'list', '--porcelain'], timeoutMs: 30_000 });
    const worktrees = parseWorktrees(result.stdout);
    await Promise.all(
      worktrees.map(async (worktree) => {
        if (!existsSync(worktree.path)) {
          worktree.statusError = 'Folder is missing';
          worktree.prunable = true;
          return;
        }
        try {
          const status = await this.runner.run({
            cwd: worktree.path,
            args: ['status', '--porcelain', '-z', '--untracked-files=normal'],
            timeoutMs: 30_000,
            maxOutputBytes: 1024 * 1024,
            allowNonZero: true,
          });
          worktree.dirty = Boolean(status.stdout.replace(/\0/g, '').trim());
        } catch (error) {
          worktree.statusError = GitError.toAppError(error).message;
        }
      }),
    );
    return worktrees.map((worktree) => ({ ...worktree, isMain: worktree.path === ctx.root }));
  }

  async addWorktree(repoPath: string, destination: string, branch: string, createBranch = false, startPoint?: string): Promise<WorktreeInfo[]> {
    const ctx = await this.context(repoPath);
    const target = path.resolve(destination);
    if (target === ctx.root || target.startsWith(`${ctx.root}${path.sep}`)) {
      throw new GitError(ERR.validation('A worktree must live outside the main repository folder.'));
    }
    if (existsSync(target)) {
      const entries = await fs.readdir(target).catch(() => [] as string[]);
      if (entries.length > 0) throw new GitError(ERR.validation('The destination folder is not empty.'));
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    const args = createBranch
      ? ['worktree', 'add', '-b', branch, target, ...(startPoint ? [startPoint] : [])]
      : ['worktree', 'add', target, branch];
    await this.runner.run({ cwd: ctx.root, args, timeoutMs: 120_000 });
    return this.worktrees(ctx.root);
  }

  async removeWorktree(repoPath: string, worktreePath: string, force: boolean): Promise<WorktreeInfo[]> {
    const ctx = await this.context(repoPath);
    const target = path.resolve(worktreePath);
    if (target === ctx.root) throw new GitError(ERR.validation('The main working tree cannot be removed.'));
    if (existsSync(target)) {
      const status = await this.runner.run({
        cwd: target,
        args: ['status', '--porcelain', '-z', '--untracked-files=normal'],
        timeoutMs: 30_000,
        allowNonZero: true,
      });
      const dirty = status.stdout.replace(/\0/g, '').trim();
      if (dirty && !force) {
        throw new GitError(
          makeError('GIT_FAILED', 'git', 'This worktree has uncommitted changes.', {
            hint: 'Commit the changes, or confirm forced removal. Git++ will not delete the folder automatically.',
          }),
        );
      }
    }
    await this.runner.run({ cwd: ctx.root, args: ['worktree', 'remove', ...(force ? ['--force'] : []), target], timeoutMs: 60_000 });
    return this.worktrees(ctx.root);
  }

  async pruneWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
    const ctx = await this.context(repoPath);
    await this.runner.run({ cwd: ctx.root, args: ['worktree', 'prune'], timeoutMs: 60_000 });
    return this.worktrees(ctx.root);
  }

  /* --------------------------- conflicts ------------------------------ */

  private async blob(ctx: RepoContext, stage: 1 | 2 | 3, filePath: string): Promise<{ text: string | null; binary: boolean; exists: boolean }> {
    const result = await this.runner.run({
      cwd: ctx.root,
      args: ['show', `:${stage}:${filePath}`],
      timeoutMs: 30_000,
      maxOutputBytes: MAX_FILE_BYTES + 1024,
      allowNonZero: true,
    });
    if (result.exitCode !== 0) return { text: null, binary: false, exists: false };
    const buffer = Buffer.from(result.stdout, 'utf8');
    const binary = isProbablyBinary(buffer);
    return { text: binary ? null : result.stdout, binary, exists: true };
  }

  async conflicts(repoPath: string): Promise<ConflictFile[]> {
    const ctx = await this.context(repoPath);
    const status = await this.rawStatus(ctx.root);
    const conflicted = status.entries.filter((entry) => entry.conflicted);
    const result: ConflictFile[] = [];
    for (const entry of conflicted.slice(0, 200)) {
      const [base, ours, theirs] = await Promise.all([
        this.blob(ctx, 1, entry.path),
        this.blob(ctx, 2, entry.path),
        this.blob(ctx, 3, entry.path),
      ]);
      let working: string | null = null;
      let binary = base.binary || ours.binary || theirs.binary;
      try {
        const absolute = await resolveInsideRepo(ctx.root, entry.path);
        const stat = await fs.stat(absolute);
        if (stat.size <= MAX_FILE_BYTES) {
          const buffer = await fs.readFile(absolute);
          binary = binary || isProbablyBinary(buffer);
          working = binary ? null : buffer.toString('utf8');
        }
      } catch {
        working = null;
      }
      const kind = !base.exists && ours.exists && theirs.exists
        ? 'both-added'
        : base.exists && ours.exists && !theirs.exists
          ? 'deleted-by-them'
          : base.exists && !ours.exists && theirs.exists
            ? 'deleted-by-us'
            : !base.exists && ours.exists && !theirs.exists
              ? 'added-by-us'
              : !base.exists && !ours.exists && theirs.exists
                ? 'added-by-them'
                : !base.exists && !ours.exists && !theirs.exists
                  ? 'both-deleted'
                  : base.exists && ours.exists && theirs.exists
                    ? 'both-modified'
                    : 'unknown';
      result.push({
        path: entry.path,
        kind,
        base: base.text,
        ours: ours.text,
        theirs: theirs.text,
        working,
        binary,
      });
    }
    return result;
  }

  async saveConflict(repoPath: string, filePath: string, content: string): Promise<ConflictFile[]> {
    const ctx = await this.context(repoPath);
    const status = await this.rawStatus(ctx.root);
    const entry = status.entries.find((candidate) => candidate.path === validateRelativePath(filePath));
    if (!entry?.conflicted) throw new GitError(ERR.validation('Only conflicted files can be edited here.'));
    const absolute = await resolveInsideRepo(ctx.root, filePath);
    await fs.writeFile(absolute, content, 'utf8');
    return this.conflicts(ctx.root);
  }

  async markResolved(repoPath: string, filePath: string): Promise<RepoSnapshot> {
    const ctx = await this.context(repoPath);
    const safe = validateRelativePath(filePath);
    const status = await this.rawStatus(ctx.root);
    if (!status.entries.some((entry) => entry.path === safe && entry.conflicted)) {
      throw new GitError(ERR.validation('That file is not currently conflicted.'));
    }
    const absolute = await resolveInsideRepo(ctx.root, safe).catch(() => null);
    if (!absolute) {
      await this.runner.run({ cwd: ctx.root, args: ['rm', '--', safe], timeoutMs: 30_000 });
    } else {
      const content = await fs.readFile(absolute, 'utf8').catch(() => null);
      if (content && /^(<{7}|={7}|>{7})/m.test(content)) {
        throw new GitError(
          makeError('GIT_CONFLICT', 'conflict', 'Conflict markers are still present in the file.', {
            hint: 'Remove the <<<<<<<, ======= and >>>>>>> markers before marking the file resolved.',
          }),
        );
      }
      await this.runner.run({ cwd: ctx.root, args: ['add', '--', safe], timeoutMs: 30_000 });
    }
    return this.snapshot(ctx.root);
  }

  async continueOperation(repoPath: string, kind: 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'am', message?: string): Promise<AdvancedOpResult> {
    const ctx = await this.context(repoPath);
    const { state } = await this.operationState(ctx.root);
    if (!state.kind) throw new GitError(ERR.validation('There is no Git operation in progress.'));
    if (state.conflicts.length > 0) {
      throw new GitError(
        makeError('GIT_CONFLICT', 'conflict', 'Unresolved conflicts remain.', {
          hint: state.conflicts.slice(0, 6).join(', '),
        }),
      );
    }
    if (kind === 'merge') {
      const args = ['commit', '--no-edit'];
      if (message) args.splice(1, 1, '-m', message);
      const result = await this.runner.run({ cwd: ctx.root, args, timeoutMs: 120_000, allowNonZero: true });
      if (result.exitCode !== 0) throw new GitError(translateGitFailure(result.stderr, this.runner.getGitPath(), result.commandLine), result.stderr);
    } else {
      const command = kind === 'rebase' ? ['rebase', '--continue'] : kind === 'cherry-pick' ? ['cherry-pick', '--continue'] : kind === 'revert' ? ['revert', '--continue'] : ['am', '--continue'];
      const result = await this.runner.run({ cwd: ctx.root, args: command, timeoutMs: 180_000, allowNonZero: true });
      if (result.exitCode !== 0) throw new GitError(translateGitFailure(result.stderr, this.runner.getGitPath(), result.commandLine), result.stderr);
    }
    const snapshot = await this.snapshot(ctx.root);
    return { output: 'Operation continued.', snapshot, conflicts: snapshot.operation.conflicts };
  }

  async abortOperation(repoPath: string): Promise<RepoSnapshot> {
    const ctx = await this.context(repoPath);
    const { state } = await this.operationState(ctx.root);
    if (!state.kind) throw new GitError(ERR.validation('There is no Git operation to abort.'));
    const args =
      state.kind === 'merge'
        ? ['merge', '--abort']
        : state.kind === 'rebase'
          ? ['rebase', '--abort']
          : state.kind === 'cherry-pick'
            ? ['cherry-pick', '--abort']
            : state.kind === 'revert'
              ? ['revert', '--abort']
              : ['am', '--abort'];
    await this.runner.run({ cwd: ctx.root, args, timeoutMs: 120_000 });
    return this.snapshot(ctx.root);
  }

  /* ------------------------------ config ------------------------------ */

  private validateConfigKey(key: string): void {
    if (!/^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z0-9-]+)+$/.test(key)) {
      throw new GitError(ERR.validation('Use a valid Git configuration key, for example user.name or core.autocrlf.'));
    }
  }

  async config(repoPath: string, scope: 'local' | 'global' | 'system' = 'local'): Promise<ConfigEntry[]> {
    const ctx = await this.context(repoPath);
    const result = await this.runner.run({
      cwd: ctx.root,
      args: ['config', `--${scope}`, '--list', '-z'],
      timeoutMs: 30_000,
      allowNonZero: true,
    });
    return parseConfig(result.stdout, scope);
  }

  async configSet(repoPath: string, key: string, value: string, scope: 'local' | 'global' = 'local'): Promise<ConfigEntry[]> {
    const ctx = await this.context(repoPath);
    this.validateConfigKey(key);
    await this.runner.run({ cwd: ctx.root, args: ['config', `--${scope}`, key, value], timeoutMs: 30_000 });
    return this.config(ctx.root, scope);
  }

  async configUnset(repoPath: string, key: string, scope: 'local' | 'global' = 'local'): Promise<ConfigEntry[]> {
    const ctx = await this.context(repoPath);
    this.validateConfigKey(key);
    await this.runner.run({ cwd: ctx.root, args: ['config', `--${scope}`, '--unset-all', key], timeoutMs: 30_000, allowNonZero: true });
    return this.config(ctx.root, scope);
  }

  /* ---------------------------- .gitignore ---------------------------- */

  private async ignoreFile(repoPath: string): Promise<{ absolute: string; root: string; exists: boolean }> {
    const ctx = await this.context(repoPath);
    const absolute = await resolveInsideRepo(ctx.root, '.gitignore', { allowMissing: true });
    return { absolute, root: ctx.root, exists: existsSync(absolute) };
  }

  async readIgnore(repoPath: string): Promise<{ path: string; content: string; exists: boolean }> {
    const { absolute, exists } = await this.ignoreFile(repoPath);
    if (!exists) return { path: '.gitignore', content: '', exists: false };
    const stat = await fs.stat(absolute);
    if (stat.size > 1_000_000) throw new GitError(ERR.validation('.gitignore is larger than 1 MB.'));
    return { path: '.gitignore', content: await fs.readFile(absolute, 'utf8'), exists: true };
  }

  async writeIgnore(repoPath: string, content: string): Promise<{ path: string; content: string; exists: boolean }> {
    const { absolute } = await this.ignoreFile(repoPath);
    const temp = `${absolute}.gitpp-${process.pid}-${Date.now()}.tmp`;
    await fs.writeFile(temp, content, 'utf8');
    await fs.rename(temp, absolute);
    return { path: '.gitignore', content, exists: true };
  }

  async checkIgnore(repoPath: string, filePath: string): Promise<{ path: string; ignored: boolean; source: string | null; pattern: string | null; line: number | null }> {
    const ctx = await this.context(repoPath);
    const safe = validateRelativePath(filePath);
    const result = await this.runner.run({
      cwd: ctx.root,
      args: ['check-ignore', '-v', '--no-index', '-z', '--', safe],
      timeoutMs: 30_000,
      allowNonZero: true,
    });
    if (!result.stdout.trim()) return { path: safe, ignored: false, source: null, pattern: null, line: null };
    const first = result.stdout.split('\0')[0] ?? '';
    const match = /^(.*?):(\d+):(.*)$/.exec(first.split('\t')[0] ?? first);
    return {
      path: safe,
      ignored: true,
      source: match?.[1] ?? null,
      line: match?.[2] ? Number(match[2]) : null,
      pattern: match?.[3] ?? null,
    };
  }

  /* ----------------------------- files -------------------------------- */

  async listMarkdown(repoPath: string): Promise<Array<{ path: string; size: number; modifiedAt: string }>> {
    const ctx = await this.context(repoPath);
    const result = await this.runner.run({
      cwd: ctx.root,
      args: ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '*.md', '*.markdown', '*.mdx', '*.mdown', '*.mkd'],
      timeoutMs: 60_000,
      maxOutputBytes: 2 * 1024 * 1024,
      allowNonZero: true,
    });
    const paths = [...new Set(result.stdout.split('\0').filter(Boolean))].slice(0, 1000);
    const files: Array<{ path: string; size: number; modifiedAt: string }> = [];
    for (const relative of paths) {
      try {
        const absolute = await resolveInsideRepo(ctx.root, relative);
        const stat = await fs.stat(absolute);
        if (!stat.isFile()) continue;
        files.push({ path: relative, size: stat.size, modifiedAt: stat.mtime.toISOString() });
      } catch {
        // Skip files that vanished or escaped the repository.
      }
    }
    return files.sort((a, b) => a.path.localeCompare(b.path));
  }

  private async versionOf(absolute: string): Promise<{ version: string; size: number; modifiedAt: string }> {
    const stat = await fs.stat(absolute);
    return { version: `${stat.mtimeMs}:${stat.size}`, size: stat.size, modifiedAt: stat.mtime.toISOString() };
  }

  async readText(repoPath: string, filePath: string): Promise<TextFile> {
    const ctx = await this.context(repoPath);
    const safe = validateRelativePath(filePath);
    const absolute = await resolveInsideRepo(ctx.root, safe);
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) throw new GitError(ERR.validation('That path is not a file.'));
    if (stat.size > MAX_FILE_BYTES) throw new GitError(ERR.validation('This file is larger than 2 MB and cannot be edited here.'));
    const buffer = await fs.readFile(absolute);
    if (isProbablyBinary(buffer)) throw new GitError(ERR.validation('This looks like a binary file.'));
    const version = await this.versionOf(absolute);
    return {
      path: safe,
      content: buffer.toString('utf8'),
      size: version.size,
      modifiedAt: version.modifiedAt,
      version: version.version,
      truncated: false,
    };
  }

  async saveText(repoPath: string, filePath: string, content: string, expectedVersion?: string): Promise<{ path: string; version: string; size: number }> {
    const ctx = await this.context(repoPath);
    const safe = validateRelativePath(filePath);
    if (!/\.(md|markdown|mdx|mdown|mkd|txt)$/i.test(safe)) {
      throw new GitError(ERR.validation('Only Markdown and plain text files can be saved from this editor.'));
    }
    if (Buffer.byteLength(content) > 5_000_000) throw new GitError(ERR.validation('The document is too large to save.'));
    const absolute = await resolveInsideRepo(ctx.root, safe, { allowMissing: true });
    if (expectedVersion && existsSync(absolute)) {
      const current = await this.versionOf(absolute);
      if (current.version !== expectedVersion) {
        throw new GitError(
          makeError('IO_ERROR', 'filesystem', 'The file changed on disk since it was opened.', {
            hint: 'Reload the file to see the external changes before saving, so you do not overwrite them.',
          }),
        );
      }
    }
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    const temp = `${absolute}.gitpp-${process.pid}-${Date.now()}.tmp`;
    await fs.writeFile(temp, content, 'utf8');
    await fs.rename(temp, absolute);
    const version = await this.versionOf(absolute);
    return { path: safe, version: version.version, size: version.size };
  }
}
