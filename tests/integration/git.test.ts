import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GitService } from '../../src/main/git/GitService';
import { GitRunner } from '../../src/main/git/runner';
import { PreflightService } from '../../src/main/services/preflight';
import { DEFAULT_SETTINGS } from '../../src/shared/defaults';

let dir = '';
let service: GitService;
const ENV = { ...process.env, GIT_CONFIG_NOSYSTEM: '1' };

function shell(args: string[], cwd = dir): string {
  return execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8' }).trim();
}

async function write(relative: string, content: string): Promise<void> {
  const target = path.join(dir, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, 'utf8');
}

async function setup(): Promise<void> {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gitpp-it-'));
  service = new GitService(new GitRunner('git'));
  await service.init(dir);
  shell(['config', 'user.name', 'Test User']);
  shell(['config', 'user.email', 'test@example.test']);
}

async function commitFile(name: string, content: string, message: string): Promise<string> {
  await write(name, content);
  await service.stage(dir, [name]);
  const result = await service.commit({ repoPath: dir, message });
  return result.sha;
}

beforeEach(async () => { await setup(); });
afterEach(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true });
  const worktreeRoot = path.join(path.dirname(dir), `${path.basename(dir)}-wt`);
  await fs.rm(worktreeRoot, { recursive: true, force: true }).catch(() => undefined);
});

describe('real Git repository operations', () => {
  it('initializes, stages, commits, logs and reads history', async () => {
    const initial = await service.snapshot(dir);
    expect(initial.info.head.unborn).toBe(true);
    await write('README.md', '# Project\n');
    let snapshot = await service.stage(dir, ['README.md']);
    expect(snapshot.stats.staged).toBe(1);
    const commit = await service.commit({ repoPath: dir, message: 'feat: initial commit' });
    expect(commit.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(commit.filesChanged).toBe(1);
    snapshot = await service.snapshot(dir);
    expect(snapshot.stats.staged).toBe(0);
    expect(snapshot.info.head.branch).toBe('master');
    const log = await service.log({ repoPath: dir, limit: 10 });
    expect(log.commits[0]?.subject).toBe('feat: initial commit');
    expect(log.commits[0]?.sha).toBe(commit.sha);
    const file = await service.showFile(dir, commit.sha, 'README.md');
    expect(file.content).toContain('# Project');
  });

  it('unstages, discards and stages an individual hunk', async () => {
    await commitFile('src.txt', 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n', 'chore: base');
    await write('src.txt', 'ONE\ntwo\nthree\nfour\nfive\nsix\nseven\nEIGHT\n');
    const diff = await service.diff({ repoPath: dir, target: 'worktree', path: 'src.txt', context: 1 });
    expect(diff.files).toHaveLength(1);
    const file = diff.files[0];
    expect(file?.hunks.length).toBe(2);
    if (!file?.hunks[0]) throw new Error('missing hunk');
    const { buildHunkPatch } = await import('../../src/shared/diff');
    const patch = buildHunkPatch(file, [0]);
    const snapshot = await service.applyPatch(dir, patch, 'stage');
    expect(snapshot.stats.staged).toBe(1);
    const staged = await service.diff({ repoPath: dir, target: 'staged', path: 'src.txt' });
    expect(staged.files[0]?.hunks.some((hunk) => hunk.lines.some((line) => line.text.includes('ONE')))).toBe(true);
    await service.unstage(dir, ['src.txt']);
    expect((await service.snapshot(dir)).stats.staged).toBe(0);
    await service.stage(dir, ['src.txt']);
    const discarded = await service.discard(dir, [{ path: 'src.txt', staged: true, untracked: false }]);
    expect(discarded.stats.staged).toBe(0);
    expect(await fs.readFile(path.join(dir, 'src.txt'), 'utf8')).toBe('one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n');
  });

  it('creates, switches, renames and deletes branches with validation', async () => {
    await commitFile('a.txt', 'a\n', 'feat: base');
    await service.createBranch(dir, 'feature/plus', 'master', true);
    expect((await service.snapshot(dir)).info.head.branch).toBe('feature/plus');
    await service.renameBranch(dir, 'feature/plus', 'feature/renamed');
    expect((await service.snapshot(dir)).info.head.branch).toBe('feature/renamed');
    await service.switchBranch(dir, 'master');
    await expect(service.createBranch(dir, 'bad name', 'master', false)).rejects.toMatchObject({ appError: { code: 'INVALID_INPUT' } });
    await service.deleteBranch(dir, 'feature/renamed', false);
    expect((await service.branches(dir)).some((branch) => branch.name === 'feature/renamed')).toBe(false);
    await expect(service.deleteBranch(dir, 'master', false)).rejects.toThrow(/current branch/i);
  });

  it('protects local changes when switching branches', async () => {
    await commitFile('shared.txt', 'base\n', 'chore: base');
    await service.createBranch(dir, 'other', 'master', false);
    await service.switchBranch(dir, 'other');
    await write('shared.txt', 'other version\n');
    await service.stage(dir, ['shared.txt']);
    await service.commit({ repoPath: dir, message: 'feat: change on other' });
    await service.switchBranch(dir, 'master');
    await write('shared.txt', 'local uncommitted\n');
    await expect(service.switchBranch(dir, 'other')).rejects.toMatchObject({ appError: { code: 'GIT_CONFLICT' } });
  });

  it('resolves a genuine merge conflict safely', async () => {
    await commitFile('conflict.txt', 'line one\nline two\nline three\n', 'chore: base');
    await service.createBranch(dir, 'conflicting', 'master', true);
    await write('conflict.txt', 'line one\ntheir change\nline three\n');
    await service.stage(dir, ['conflict.txt']);
    await service.commit({ repoPath: dir, message: 'feat: their change' });
    await service.switchBranch(dir, 'master');
    await write('conflict.txt', 'line one\nour change\nline three\n');
    await service.stage(dir, ['conflict.txt']);
    await service.commit({ repoPath: dir, message: 'feat: our change' });
    const merged = await service.merge(dir, 'conflicting');
    expect(merged.conflicts).toEqual(['conflict.txt']);
    expect(merged.snapshot.operation.kind).toBe('merge');
    expect(merged.snapshot.operation.canContinue).toBe(false);
    const conflicts = await service.conflicts(dir);
    expect(conflicts[0]?.base).toContain('line two');
    expect(conflicts[0]?.ours).toContain('our change');
    expect(conflicts[0]?.theirs).toContain('their change');
    await expect(service.continueOperation(dir, 'merge')).rejects.toMatchObject({ appError: { code: 'GIT_CONFLICT' } });
    await service.saveConflict(dir, 'conflict.txt', 'line one\nresolved change\nline three\n');
    await expect(service.markResolved(dir, 'conflict.txt')).resolves.toBeTruthy();
    const continued = await service.continueOperation(dir, 'merge');
    expect(continued.snapshot.operation.kind).toBeNull();
    expect((await service.log({ repoPath: dir, limit: 10 })).commits[0]?.parents).toHaveLength(2);
  });

  it('uses real stashes and keeps entries when apply fails', async () => {
    await commitFile('notes.txt', 'base\n', 'chore: base');
    await write('notes.txt', 'stashed change\n');
    await write('untracked.txt', 'new file\n');
    const stashes = await service.createStash(dir, 'WIP: notes', true);
    expect(stashes).toHaveLength(1);
    expect(stashes[0]?.message).toContain('WIP: notes');
    expect(await fs.readFile(path.join(dir, 'notes.txt'), 'utf8')).toBe('base\n');
    await expect(fs.access(path.join(dir, 'untracked.txt'))).rejects.toBeTruthy();
    const applied = await service.applyStash(dir, stashes[0]!.ref, false);
    expect(applied.files.some((file) => file.path === 'notes.txt')).toBe(true);
    expect(await service.stashes(dir)).toHaveLength(1);
    await service.dropStash(dir, stashes[0]!.ref);
    expect(await service.stashes(dir)).toHaveLength(0);
  });

  it('creates and removes real worktrees with spaces and unicode', async () => {
    await commitFile('a.txt', 'a\n', 'chore: base');
    await service.createBranch(dir, 'parallel', 'master', false);
    const worktree = path.join(path.dirname(dir), `${path.basename(dir)}-wörk tree`);
    await service.addWorktree(dir, worktree, 'parallel');
    const trees = await service.worktrees(dir);
    expect(trees).toHaveLength(2);
    expect(trees.some((tree) => tree.path === worktree && tree.branch === 'parallel')).toBe(true);
    await fs.writeFile(path.join(worktree, 'untracked.txt'), 'dirty');
    await expect(service.removeWorktree(dir, worktree, false)).rejects.toMatchObject({ appError: { code: 'GIT_FAILED' } });
    await service.removeWorktree(dir, worktree, true);
    expect(await service.worktrees(dir)).toHaveLength(1);
    expect((await service.branches(dir)).some((branch) => branch.name === 'parallel')).toBe(true);
    await fs.rm(worktree, { recursive: true, force: true });
  });

  it('cherry-picks and reverts commits', async () => {
    await commitFile('base.txt', 'base\n', 'chore: base');
    await service.createBranch(dir, 'topic', 'master', true);
    const sha = await commitFile('feature.txt', 'feature\n', 'feat: topic work');
    await service.switchBranch(dir, 'master');
    await service.cherryPick(dir, sha);
    expect(await fs.readFile(path.join(dir, 'feature.txt'), 'utf8')).toBe('feature\n');
    const picked = (await service.log({ repoPath: dir, limit: 5 })).commits[0];
    expect(picked?.subject).toBe('feat: topic work');
    await service.revert(dir, picked!.sha);
    await expect(fs.access(path.join(dir, 'feature.txt'))).rejects.toBeTruthy();
    expect((await service.log({ repoPath: dir, limit: 5 })).commits[0]?.subject).toContain('Revert');
  });

  it('handles files with spaces and unicode and rejects traversal', async () => {
    const relative = 'docs/notes ü.md';
    await commitFile(relative, '# Hello\n', 'docs: add notes');
    const saved = await service.saveText(dir, 'docs/saved ü.md', '# Saved\n');
    expect(saved.path).toBe('docs/saved ü.md');
    const read = await service.readText(dir, 'docs/saved ü.md');
    expect(read.content).toBe('# Saved\n');
    await expect(service.readText(dir, '../outside.md')).rejects.toMatchObject({ appError: { code: 'UNSAFE_PATH' } });
    await expect(service.saveText(dir, '../escape.md', 'x')).rejects.toMatchObject({ appError: { code: 'UNSAFE_PATH' } });
    const md = await service.listMarkdown(dir);
    expect(md.some((file) => file.path === relative)).toBe(true);
  });

  it('edits config, creates tags, writes ignore rules and reads file history', async () => {
    await commitFile('src/a.txt', 'one\n', 'feat: first version');
    await commitFile('src/a.txt', 'two\n', 'fix: second version');
    const config = await service.configSet(dir, 'core.autocrlf', 'false');
    expect(config.find((entry) => entry.key === 'core.autocrlf')?.value).toBe('false');
    const afterUnset = await service.configUnset(dir, 'core.autocrlf');
    expect(afterUnset.some((entry) => entry.key === 'core.autocrlf')).toBe(false);

    const tags = await service.createTag(dir, 'v0.1.0', undefined, 'Test annotated tag');
    expect(tags.some((tag) => tag.name === 'v0.1.0' && tag.annotated)).toBe(true);
    expect(await service.deleteTag(dir, 'v0.1.0')).toHaveLength(0);

    await service.writeIgnore(dir, 'node_modules/\n*.log\n!important.log\n');
    const ignore = await service.readIgnore(dir);
    expect(ignore.exists).toBe(true);
    expect(ignore.content).toContain('*.log');
    const debug = await service.checkIgnore(dir, 'debug.log');
    expect(debug.ignored).toBe(true);
    expect(debug.pattern).toBe('*.log');
    const kept = await service.checkIgnore(dir, 'important.log');
    expect(kept.ignored).toBe(false);

    const history = await service.fileHistory(dir, 'src/a.txt');
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(history[0]?.subject).toBe('fix: second version');
  });

  it('reports actionable errors for missing repositories and Git executables', async () => {
    const missing = path.join(dir, 'does-not-exist');
    await expect(service.snapshot(missing)).rejects.toMatchObject({ appError: { code: 'IO_ERROR' } });
    const noGit = new GitService(new GitRunner('/nonexistent/git-binary'));
    await expect(noGit.snapshot(dir)).rejects.toMatchObject({ appError: { code: 'GIT_NOT_FOUND' } });
  });
});

describe('Preflight against real state', () => {
  it('runs read-only checks, gates commands on trust, scans secrets and marks stale results', async () => {
    await commitFile('app.txt', 'hello\n', 'feat: base');
    const preflight = new PreflightService(path.join(dir, '.preflight'), service, () => ({ ...DEFAULT_SETTINGS }));
    await preflight.load();
    const config = await preflight.getConfig(dir);
    expect(config.checks.some((check) => check.id === 'status')).toBe(true);
    await preflight.setConfig(dir, {
      trustCommands: false,
      blockCommitOnFailure: false,
      checks: [
        { ...config.checks.find((check) => check.id === 'status')!, enabled: true, required: true },
        { ...config.checks.find((check) => check.id === 'conflicts')!, enabled: true, required: true },
        {
          id: 'probe',
          name: 'Probe command',
          type: 'command',
          command: process.platform === 'win32' ? 'cmd' : 'node',
          args: process.platform === 'win32' ? ['/c', 'echo ok'] : ['-e', 'console.log("ok")'],
          required: false,
          timeoutMs: 30_000,
          enabled: true,
          description: 'Harmless test command',
        },
      ],
    });
    let run = await preflight.start(dir);
    const wait = async (): Promise<void> => {
      for (let i = 0; i < 60; i += 1) {
        run = await preflight.getRun(dir, run.id);
        if (run.status !== 'running') return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('run did not finish');
    };
    await wait();
    expect(run.results.find((result) => result.checkId === 'probe')?.status).toBe('skipped');
    await preflight.setConfig(dir, {
      trustCommands: true,
      blockCommitOnFailure: false,
      checks: await preflight.getConfig(dir).then((current) => current.checks),
    });
    run = await preflight.start(dir);
    await wait();
    expect(run.results.find((result) => result.checkId === 'probe')?.status).toBe('passed');
    expect(run.status).toBe('passed');
    await write('leak.txt', `const key = "${'AKIA' + 'ABCDEFGHIJKLMNOP'}";\n`);
    await service.stage(dir, ['leak.txt']);
    const current = await preflight.getConfig(dir);
    await preflight.setConfig(dir, {
      trustCommands: true,
      blockCommitOnFailure: false,
      checks: [
        ...current.checks,
        ...config.checks.filter((check) => check.id === 'secrets' && !current.checks.some((entry) => entry.id === 'secrets')),
      ].map((check) => (check.id === 'secrets' ? { ...check, enabled: true } : check)),
    });
    run = await preflight.start(dir, ['secrets']);
    await wait();
    expect(run.results[0]?.status).toBe('failed');
    expect(run.results[0]?.output).toContain('AWS access key');
    await write('app.txt', 'changed after run\n');
    const stale = await preflight.getRun(dir, run.id);
    expect(stale.stale).toBe(true);
  });
});
