import { API_METHODS, schemas, type ApiMethodName } from '../shared/contract';
import { ERR, makeError } from '../shared/errors';
import { fail, ok, type ApiMethod, type ApiParams, type ApiResults, type AppEvent, type Result } from '../shared/types';
import { IGNORE_TEMPLATES } from '../shared/templates';
import { GitService } from './git/GitService';
import { GitRunner } from './git/runner';
import { GitError } from './git/errors';
import { SettingsStore } from './services/settings';
import { PreflightService } from './services/preflight';
import { GithubService } from './services/github';
import { AiService } from './services/ai';
import type { SecretStore } from './services/secrets';

export interface HostBindings {
  meta: {
    name: string;
    version: string;
    platform: string;
    electron: string;
    chrome: string;
    node: string;
    dataDir: string;
    isPackaged: boolean;
  };
  openDirectoryDialog(title?: string): Promise<string | null>;
  openFileDialog(title?: string): Promise<string | null>;
  openExternal(url: string): Promise<boolean>;
  showItemInFolder(pathValue: string): void;
  emit(event: AppEvent): void;
}

export interface ApiDeps {
  dataDir: string;
  secrets: SecretStore;
  host: HostBindings;
  gitPath?: string;
}

export interface ApiHandle {
  invoke(method: ApiMethodName, payload: unknown): Promise<Result<unknown>>;
  git: GitService;
  settings: SettingsStore;
  preflight: PreflightService;
  github: GithubService;
  ai: AiService;
  warnings: string[];
}

type Handlers = {
  [K in ApiMethod]: (payload: ApiParams[K]) => Promise<ApiResults[K]>;
};

function validateExternalUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new GitError(ERR.validation('That is not a valid URL.'));
  }
  if (!['https:', 'http:', 'mailto:'].includes(parsed.protocol)) {
    throw new GitError(ERR.validation('Only http(s) and mailto links can be opened externally.'));
  }
  if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
    throw new GitError(ERR.validation('Local links cannot be opened from the app.'));
  }
  return parsed.toString();
}

export async function createApi(deps: ApiDeps): Promise<ApiHandle> {
  const settings = new SettingsStore(deps.dataDir, deps.secrets);
  await settings.load();
  const runner = new GitRunner(deps.gitPath ?? settings.get().gitPath);
  const git = new GitService(runner, () => ({
    context: settings.get().diff.context,
    ignoreWhitespace: settings.get().diff.ignoreWhitespace,
  }));
  const preflight = new PreflightService(deps.dataDir, git, () => settings.get(), (_repoPath, runId) => {
    deps.host.emit({ type: 'preflight-progress', runId });
  });
  await preflight.load();
  const github = new GithubService(git, deps.secrets, () => settings.get());
  const ai = new AiService(deps.secrets, () => settings.get());
  const warnings = settings.takeWarnings();

  const handlers: Handlers = {
    'app.info': async () => ({
      ...deps.host.meta,
      git: await git.detect(),
    }),
    'app.openExternal': async ({ url }) => ({ opened: await deps.host.openExternal(validateExternalUrl(url)) }),
    'app.showItemInFolder': async ({ path: target }) => {
      deps.host.showItemInFolder(target);
      return { shown: true };
    },

    'dialog.openDirectory': async ({ title }) => ({ path: await deps.host.openDirectoryDialog(title) }),
    'dialog.openFile': async ({ title }) => ({ path: await deps.host.openFileDialog(title) }),

    'settings.get': async () => settings.get(),
    'settings.update': async ({ patch }) => {
      const previousGitPath = settings.get().gitPath;
      if (patch.gitPath !== undefined) {
        git.setGitPath(patch.gitPath || 'git');
        const detected = await git.detect();
        if (!detected.available) {
          git.setGitPath(previousGitPath);
          throw new GitError(makeError('GIT_NOT_FOUND', 'git', `Git was not found at "${patch.gitPath}".`, {
            detail: detected.error ?? undefined,
            hint: 'Install Git or point Settings at a valid git executable. The previous path was restored.',
          }));
        }
      }
      const next = await settings.update(patch);
      if (patch.ai || patch.github) await settings.updateWithIdentity(Boolean(await deps.secrets.get('github-token')), Boolean(await deps.secrets.get('ai-key')));
      return next;
    },
    'settings.reset': async () => settings.reset(),
    'settings.setGithubToken': async ({ token }) => {
      if (!/^[A-Za-z0-9_:-]{8,512}$/.test(token)) throw new GitError(ERR.validation('That does not look like a GitHub token.'));
      await deps.secrets.set('github-token', token.trim());
      await settings.updateWithIdentity(true, Boolean(await deps.secrets.get('ai-key')));
      return { stored: true };
    },
    'settings.clearGithubToken': async () => {
      await deps.secrets.delete('github-token');
      await settings.updateWithIdentity(false, Boolean(await deps.secrets.get('ai-key')));
      return { cleared: true };
    },
    'settings.setAiKey': async ({ key }) => {
      if (key.length < 8 || key.length > 512) throw new GitError(ERR.validation('Enter a valid API key.'));
      await deps.secrets.set('ai-key', key.trim());
      await settings.updateWithIdentity(Boolean(await deps.secrets.get('github-token')), true);
      return { stored: true };
    },
    'settings.clearAiKey': async () => {
      await deps.secrets.delete('ai-key');
      await settings.updateWithIdentity(Boolean(await deps.secrets.get('github-token')), false);
      return { cleared: true };
    },

    'recent.list': async () => settings.listRecents(),
    'recent.remove': async ({ path: repoPath }) => settings.removeRecent(repoPath),
    'recent.pin': async ({ path: repoPath, pinned }) => settings.pinRecent(repoPath, pinned),
    'recent.clear': async () => settings.clearRecents(),

    'git.detect': async () => git.detect(),
    'git.open': async ({ path: repoPath }) => {
      const snapshot = await git.open(repoPath);
      await settings.addRecent(snapshot.info.path);
      deps.host.emit({ type: 'repo-changed', repoPath: snapshot.info.path });
      return snapshot;
    },
    'git.init': async ({ path: folder }) => {
      const snapshot = await git.init(folder);
      await settings.addRecent(snapshot.info.path);
      return snapshot;
    },
    'git.clone': async ({ url, path: destination, branch }) => {
      const snapshot = await git.clone(url, destination, branch);
      await settings.addRecent(snapshot.info.path);
      return snapshot;
    },
    'git.status': async ({ repoPath }) => git.snapshot(repoPath),
    'git.stage': async ({ repoPath, paths }) => git.stage(repoPath, paths),
    'git.unstage': async ({ repoPath, paths }) => git.unstage(repoPath, paths),
    'git.discard': async ({ repoPath, entries }) => git.discard(repoPath, entries),
    'git.applyPatch': async ({ repoPath, patch, direction }) => git.applyPatch(repoPath, patch, direction),

    'git.diff': async (request) => git.diff(request),
    'git.commit': async (request) => git.commit(request),
    'git.log': async (request) => git.log(request),
    'git.commitDetails': async ({ repoPath, sha }) => git.commitDetails(repoPath, sha),
    'git.fileHistory': async ({ repoPath, path: filePath, limit }) => git.fileHistory(repoPath, filePath, limit),
    'git.showFile': async ({ repoPath, rev, path: filePath }) => git.showFile(repoPath, rev, filePath),
    'git.searchCommits': async ({ repoPath, query, limit }) => git.searchCommits(repoPath, query, limit),

    'git.branches': async ({ repoPath }) => git.branches(repoPath),
    'git.createBranch': async ({ repoPath, name, startPoint, checkout }) => git.createBranch(repoPath, name, startPoint, checkout),
    'git.switchBranch': async ({ repoPath, name }) => git.switchBranch(repoPath, name),
    'git.renameBranch': async ({ repoPath, from, to }) => git.renameBranch(repoPath, from, to),
    'git.deleteBranch': async ({ repoPath, name, force }) => git.deleteBranch(repoPath, name, force),
    'git.setUpstream': async ({ repoPath, branch, upstream }) => git.setUpstream(repoPath, branch, upstream),
    'git.compareBranches': async ({ repoPath, base, head }) => git.compareBranches(repoPath, base, head),
    'git.merge': async ({ repoPath, ref, noFf }) => git.merge(repoPath, ref, noFf),
    'git.rebase': async ({ repoPath, onto }) => git.rebase(repoPath, onto),
    'git.cherryPick': async ({ repoPath, sha }) => git.cherryPick(repoPath, sha),
    'git.revert': async ({ repoPath, sha }) => git.revert(repoPath, sha),

    'git.tags': async ({ repoPath }) => git.tags(repoPath),
    'git.createTag': async ({ repoPath, name, target, message }) => git.createTag(repoPath, name, target, message),
    'git.deleteTag': async ({ repoPath, name }) => git.deleteTag(repoPath, name),

    'git.remotes': async ({ repoPath }) => git.remotes(repoPath),
    'git.addRemote': async ({ repoPath, name, url }) => git.addRemote(repoPath, name, url),
    'git.editRemote': async ({ repoPath, name, url }) => git.editRemote(repoPath, name, url),
    'git.removeRemote': async ({ repoPath, name }) => git.removeRemote(repoPath, name),
    'git.fetch': async ({ repoPath, remote, prune }) => git.fetch(repoPath, remote, prune),
    'git.pull': async ({ repoPath, remote, branch }) => git.pull(repoPath, remote, branch),
    'git.push': async ({ repoPath, remote, branch, setUpstream, forceWithLease }) => git.push(repoPath, remote, branch, setUpstream, forceWithLease),

    'git.pushTag': async ({ repoPath, tag, remote }) => git.pushTag(repoPath, tag, remote),

    'git.stashes': async ({ repoPath }) => git.stashes(repoPath),
    'git.createStash': async ({ repoPath, message, includeUntracked }) => git.createStash(repoPath, message, includeUntracked),
    'git.applyStash': async ({ repoPath, ref }) => git.applyStash(repoPath, ref, false),
    'git.popStash': async ({ repoPath, ref }) => git.applyStash(repoPath, ref, true),
    'git.dropStash': async ({ repoPath, ref }) => git.dropStash(repoPath, ref),

    'git.worktrees': async ({ repoPath }) => git.worktrees(repoPath),
    'git.addWorktree': async ({ repoPath, path: destination, branch, createBranch, startPoint }) => git.addWorktree(repoPath, destination, branch, createBranch, startPoint),
    'git.removeWorktree': async ({ repoPath, path: destination, force }) => git.removeWorktree(repoPath, destination, force),
    'git.pruneWorktrees': async ({ repoPath }) => git.pruneWorktrees(repoPath),

    'git.operationState': async ({ repoPath }) => git.state(repoPath),
    'git.conflicts': async ({ repoPath }) => git.conflicts(repoPath),
    'git.saveConflict': async ({ repoPath, path: filePath, content }) => git.saveConflict(repoPath, filePath, content),
    'git.markResolved': async ({ repoPath, path: filePath }) => git.markResolved(repoPath, filePath),
    'git.continueOperation': async ({ repoPath, kind, message }) => git.continueOperation(repoPath, kind, message),
    'git.abortOperation': async ({ repoPath }) => git.abortOperation(repoPath),

    'git.config': async ({ repoPath }) => git.config(repoPath),
    'git.configSet': async ({ repoPath, key, value, scope }) => git.configSet(repoPath, key, value, scope ?? 'local'),
    'git.configUnset': async ({ repoPath, key, scope }) => git.configUnset(repoPath, key, scope ?? 'local'),

    'ignore.read': async ({ repoPath }) => git.readIgnore(repoPath),
    'ignore.write': async ({ repoPath, content }) => git.writeIgnore(repoPath, content),
    'ignore.check': async ({ repoPath, path: filePath }) => git.checkIgnore(repoPath, filePath),
    'ignore.templates': async () => IGNORE_TEMPLATES,

    'files.listMarkdown': async ({ repoPath }) => git.listMarkdown(repoPath),
    'files.readText': async ({ repoPath, path: filePath }) => git.readText(repoPath, filePath),
    'files.saveText': async ({ repoPath, path: filePath, content, expectedVersion }) => git.saveText(repoPath, filePath, content, expectedVersion),

    'preflight.getConfig': async ({ repoPath }) => preflight.getConfig(repoPath),
    'preflight.setConfig': async ({ repoPath, trustCommands, blockCommitOnFailure, checks }) =>
      preflight.setConfig(repoPath, { trustCommands, blockCommitOnFailure, checks }),
    'preflight.detect': async ({ repoPath }) => preflight.detect(repoPath),
    'preflight.start': async ({ repoPath, checkIds }) => preflight.start(repoPath, checkIds),
    'preflight.getRun': async ({ repoPath, runId }) => preflight.getRun(repoPath, runId),
    'preflight.runs': async ({ repoPath }) => preflight.runsFor(repoPath),
    'preflight.cancel': async ({ repoPath, runId }) => preflight.cancel(repoPath, runId),

    'github.status': async ({ repoPath }) => github.status(repoPath),
    'github.pulls': async ({ repoPath }) => github.pulls(repoPath),
    'github.issues': async ({ repoPath }) => github.issues(repoPath),
    'github.releases': async ({ repoPath }) => github.releases(repoPath),
    'github.workflows': async ({ repoPath }) => github.workflows(repoPath),
    'github.repo': async ({ repoPath }) => github.repo(repoPath),
    'github.createPr': async (request) => github.createPull(request.repoPath, request),
    'github.createIssue': async (request) => github.createIssue(request.repoPath, request),
    'github.pushBranch': async ({ repoPath, branch, setUpstream }) => github.pushBranch(repoPath, branch, setUpstream ?? false),
    'github.createRelease': async ({ repoPath, tag, name, body, draft, prerelease }) => github.createRelease(repoPath, { tag, name, body, draft, prerelease }),

    'ai.settings': async () => ai.info(),
    'ai.explain': async (request) => ai.explain(request),
    'ai.test': async () => ai.test(),
  };

  const invoke = async (method: ApiMethodName, payload: unknown): Promise<Result<unknown>> => {
    if (!API_METHODS.includes(method)) return fail(ERR.validation('Unknown action.'));
    const schema = schemas[method];
    const parsed = schema.safeParse(payload ?? {});
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return fail(ERR.validation(`Invalid input for ${method}: ${issue?.path.join('.') || 'value'} ${issue?.message ?? 'is invalid'}.`));
    }
    try {
      const handler = handlers[method] as (value: unknown) => Promise<ApiResults[ApiMethod]>;
      return ok(await handler(parsed.data));
    } catch (error) {
      return fail(GitError.toAppError(error));
    }
  };

  return { invoke, git, settings, preflight, github, ai, warnings };
}

export type { ApiHandle as GitPlusApi };
