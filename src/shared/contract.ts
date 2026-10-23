import { z } from 'zod';

/** Runtime validation schemas for every renderer -> main call. */

const safeString = z.string().min(1).max(4096);
const repo = z.object({ repoPath: z.string().min(1).max(4096) });
const empty = z.object({}).strict();
const rev = z.string().min(1).max(256);
const relPath = z.string().min(1).max(4096);
const paths = z.array(z.string().min(1).max(4096)).min(1).max(5000);
const message = z.string().min(1).max(20_000);
const branchName = z.string().min(1).max(255);
const remoteName = z.string().min(1).max(255);
const url = z.string().min(1).max(2048);

const settingsPatch = z.object({
  theme: z.enum(['dark', 'light', 'system']).optional(),
  gitPath: z.string().max(4096).optional(),
  defaultRepoDir: z.string().max(4096).optional(),
  diff: z
    .object({
      mode: z.enum(['unified', 'split']).optional(),
      context: z.number().int().min(0).max(50).optional(),
      ignoreWhitespace: z.boolean().optional(),
      wrap: z.boolean().optional(),
    })
    .partial()
    .optional(),
  editor: z
    .object({
      fontFamily: z.string().max(200).optional(),
      fontSize: z.number().int().min(8).max(32).optional(),
      tabSize: z.number().int().min(1).max(8).optional(),
    })
    .partial()
    .optional(),
  notifications: z
    .object({ enabled: z.boolean().optional(), operationToasts: z.boolean().optional() })
    .partial()
    .optional(),
  privacy: z.object({ logLevel: z.enum(['info', 'debug', 'error']).optional() }).partial().optional(),
  preflight: z
    .object({
      defaultTimeoutMs: z.number().int().min(1000).max(3_600_000).optional(),
      defaultTrustCommands: z.boolean().optional(),
    })
    .partial()
    .optional(),
  shortcuts: z
    .object({
      commandPalette: z.string().max(64).optional(),
      refresh: z.string().max(64).optional(),
      commit: z.string().max(64).optional(),
      openRepo: z.string().max(64).optional(),
      search: z.string().max(64).optional(),
    })
    .partial()
    .optional(),
  github: z.object({ apiBase: z.string().url().optional() }).partial().optional(),
  ai: z
    .object({
      enabled: z.boolean().optional(),
      baseUrl: z.string().max(2048).optional(),
      model: z.string().max(200).optional(),
      consent: z.boolean().optional(),
    })
    .partial()
    .optional(),
});

const preflightCheck = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  type: z.enum(['status', 'conflicts', 'command', 'secret-scan', 'custom']),
  command: z.string().max(4096).nullable(),
  args: z.array(z.string().max(4096)).max(100),
  required: z.boolean(),
  timeoutMs: z.number().int().min(1000).max(3_600_000),
  enabled: z.boolean(),
  description: z.string().max(2000),
});

export const schemas = {
  'app.info': empty,
  'app.openExternal': z.object({ url: z.string().url().max(4096) }),
  'app.showItemInFolder': z.object({ path: safeString }),

  'dialog.openDirectory': z.object({ title: z.string().max(200).optional() }),
  'dialog.openFile': z.object({ title: z.string().max(200).optional() }),

  'settings.get': empty,
  'settings.update': z.object({ patch: settingsPatch }),
  'settings.reset': empty,
  'settings.setGithubToken': z.object({ token: z.string().min(8).max(512) }),
  'settings.clearGithubToken': empty,
  'settings.setAiKey': z.object({ key: z.string().min(8).max(512) }),
  'settings.clearAiKey': empty,

  'recent.list': empty,
  'recent.remove': z.object({ path: safeString }),
  'recent.pin': z.object({ path: safeString, pinned: z.boolean() }),
  'recent.clear': empty,

  'git.detect': empty,
  'git.open': z.object({ path: safeString }),
  'git.init': z.object({ path: safeString }),
  'git.clone': z.object({ url: url, path: safeString, branch: z.string().max(255).optional() }),
  'git.status': repo,
  'git.stage': z.object({ repoPath: safeString, paths }),
  'git.unstage': z.object({ repoPath: safeString, paths }),
  'git.discard': z.object({
    repoPath: safeString,
    entries: z
      .array(
        z.object({
          path: safeString,
          staged: z.boolean(),
          untracked: z.boolean(),
        }),
      )
      .min(1)
      .max(500),
    confirmation: z.literal('discard'),
  }),
  'git.applyPatch': z.object({
    repoPath: safeString,
    patch: z.string().min(1).max(2_000_000),
    direction: z.enum(['stage', 'unstage']),
  }),

  'git.diff': z.object({
    repoPath: safeString,
    target: z.enum(['worktree', 'staged', 'commit', 'range', 'stash']),
    commit: rev.optional(),
    from: rev.optional(),
    to: rev.optional(),
    stashRef: z.string().max(300).optional(),
    path: relPath.optional(),
    context: z.number().int().min(0).max(50).optional(),
    ignoreWhitespace: z.boolean().optional(),
  }),
  'git.commit': z.object({
    repoPath: safeString,
    message,
    description: z.string().max(100_000).optional(),
    amend: z.boolean().optional(),
    signoff: z.boolean().optional(),
    allowEmpty: z.boolean().optional(),
  }),
  'git.log': z.object({
    repoPath: safeString,
    limit: z.number().int().min(1).max(1000).optional(),
    skip: z.number().int().min(0).max(1_000_000).optional(),
    all: z.boolean().optional(),
    ref: rev.optional(),
    search: z.string().max(500).optional(),
    path: relPath.optional(),
  }),
  'git.commitDetails': z.object({ repoPath: safeString, sha: rev }),
  'git.fileHistory': z.object({ repoPath: safeString, path: relPath, limit: z.number().int().min(1).max(500).optional() }),
  'git.showFile': z.object({ repoPath: safeString, rev, path: relPath }),
  'git.searchCommits': z.object({ repoPath: safeString, query: z.string().min(1).max(500), limit: z.number().int().min(1).max(500).optional() }),

  'git.branches': repo,
  'git.createBranch': z.object({
    repoPath: safeString,
    name: branchName,
    startPoint: z.string().max(256).optional(),
    checkout: z.boolean().optional(),
  }),
  'git.switchBranch': z.object({ repoPath: safeString, name: branchName }),
  'git.renameBranch': z.object({ repoPath: safeString, from: branchName, to: branchName }),
  'git.deleteBranch': z.object({ repoPath: safeString, name: branchName, force: z.boolean() }),
  'git.setUpstream': z.object({ repoPath: safeString, branch: branchName, upstream: z.string().max(300) }),
  'git.compareBranches': z.object({ repoPath: safeString, base: z.string().max(300), head: z.string().max(300) }),
  'git.merge': z.object({ repoPath: safeString, ref: rev, noFf: z.boolean().optional() }),
  'git.rebase': z.object({ repoPath: safeString, onto: rev }),
  'git.cherryPick': z.object({ repoPath: safeString, sha: rev }),
  'git.revert': z.object({ repoPath: safeString, sha: rev }),

  'git.tags': repo,
  'git.createTag': z.object({
    repoPath: safeString,
    name: z.string().min(1).max(255),
    target: z.string().max(256).optional(),
    message: z.string().max(10_000).optional(),
  }),
  'git.deleteTag': z.object({ repoPath: safeString, name: z.string().min(1).max(255) }),

  'git.remotes': repo,
  'git.addRemote': z.object({ repoPath: safeString, name: remoteName, url: url }),
  'git.editRemote': z.object({ repoPath: safeString, name: remoteName, url: url }),
  'git.removeRemote': z.object({ repoPath: safeString, name: remoteName }),
  'git.fetch': z.object({ repoPath: safeString, remote: remoteName.optional(), prune: z.boolean().optional() }),
  'git.pull': z.object({ repoPath: safeString, remote: remoteName.optional(), branch: z.string().max(255).optional() }),
  'git.push': z.object({
    repoPath: safeString,
    remote: remoteName.optional(),
    branch: z.string().max(255).optional(),
    setUpstream: z.boolean().optional(),
    forceWithLease: z.boolean().optional(),
  }),

  'git.pushTag': z.object({ repoPath: safeString, tag: z.string().min(1).max(255), remote: remoteName.optional() }),

  'git.stashes': repo,
  'git.createStash': z.object({ repoPath: safeString, message: z.string().max(1000).optional(), includeUntracked: z.boolean().optional() }),
  'git.applyStash': z.object({ repoPath: safeString, ref: z.string().max(300) }),
  'git.popStash': z.object({ repoPath: safeString, ref: z.string().max(300) }),
  'git.dropStash': z.object({ repoPath: safeString, ref: z.string().max(300) }),

  'git.worktrees': repo,
  'git.addWorktree': z.object({
    repoPath: safeString,
    path: safeString,
    branch: branchName,
    createBranch: z.boolean().optional(),
    startPoint: z.string().max(256).optional(),
  }),
  'git.removeWorktree': z.object({ repoPath: safeString, path: safeString, force: z.boolean(), confirmation: z.literal('remove-worktree').optional() }),
  'git.pruneWorktrees': repo,

  'git.operationState': repo,
  'git.conflicts': repo,
  'git.saveConflict': z.object({ repoPath: safeString, path: relPath, content: z.string().max(5_000_000) }),
  'git.markResolved': z.object({ repoPath: safeString, path: relPath }),
  'git.continueOperation': z.object({
    repoPath: safeString,
    kind: z.enum(['merge', 'rebase', 'cherry-pick', 'revert', 'am']),
    message: z.string().max(20_000).optional(),
  }),
  'git.abortOperation': z.object({ repoPath: safeString, confirmation: z.literal('abort') }),

  'git.config': repo,
  'git.configSet': z.object({ repoPath: safeString, key: z.string().min(1).max(200), value: z.string().max(10_000), scope: z.enum(['local', 'global']).optional() }),
  'git.configUnset': z.object({ repoPath: safeString, key: z.string().min(1).max(200), scope: z.enum(['local', 'global']).optional() }),

  'ignore.read': repo,
  'ignore.write': z.object({ repoPath: safeString, content: z.string().max(1_000_000) }),
  'ignore.check': z.object({ repoPath: safeString, path: relPath }),
  'ignore.templates': empty,

  'files.listMarkdown': repo,
  'files.readText': z.object({ repoPath: safeString, path: relPath }),
  'files.saveText': z.object({
    repoPath: safeString,
    path: relPath,
    content: z.string().max(5_000_000),
    expectedVersion: z.string().max(100).optional(),
  }),

  'preflight.getConfig': repo,
  'preflight.setConfig': z.object({
    repoPath: safeString,
    trustCommands: z.boolean(),
    blockCommitOnFailure: z.boolean(),
    checks: z.array(preflightCheck).max(50),
  }),
  'preflight.detect': repo,
  'preflight.start': z.object({ repoPath: safeString, checkIds: z.array(z.string().max(100)).max(50).optional() }),
  'preflight.getRun': z.object({ repoPath: safeString, runId: z.string().min(1).max(100) }),
  'preflight.runs': repo,
  'preflight.cancel': z.object({ repoPath: safeString, runId: z.string().min(1).max(100) }),

  'github.status': repo,
  'github.pulls': repo,
  'github.issues': repo,
  'github.releases': repo,
  'github.workflows': repo,
  'github.repo': repo,
  'github.createPr': z.object({
    repoPath: safeString,
    title: z.string().min(1).max(256),
    body: z.string().max(50_000),
    head: z.string().min(1).max(255),
    base: z.string().min(1).max(255),
    draft: z.boolean(),
    pushFirst: z.boolean(),
  }),
  'github.createIssue': z.object({ repoPath: safeString, title: z.string().min(1).max(256), body: z.string().max(50_000) }),
  'github.pushBranch': z.object({ repoPath: safeString, branch: z.string().min(1).max(255), setUpstream: z.boolean().optional() }),
  'github.createRelease': z.object({
    repoPath: safeString,
    tag: z.string().min(1).max(255),
    name: z.string().min(1).max(255),
    body: z.string().max(100_000),
    draft: z.boolean(),
    prerelease: z.boolean(),
  }),

  'ai.settings': empty,
  'ai.explain': z.object({
    repoPath: safeString,
    task: z.enum(['explain-diff', 'commit-message', 'explain-error', 'summarize-commit']),
    input: z.string().min(1).max(60_000),
  }),
  'ai.test': empty,
} as const;

export type ApiParams = { [K in keyof typeof schemas]: z.infer<(typeof schemas)[K]> };
export type ApiMethodName = keyof typeof schemas;
export const API_METHODS = Object.keys(schemas) as ApiMethodName[];
