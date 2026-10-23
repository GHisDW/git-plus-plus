import type { ApiParams } from './contract';

/**
 * Shared types used by the main process, preload bridge, and renderer.
 * Nothing in this file may import Node.js or Electron APIs.
 */

export type ErrorKind =
  | 'validation'
  | 'git'
  | 'filesystem'
  | 'network'
  | 'auth'
  | 'cancelled'
  | 'timeout'
  | 'not-found'
  | 'unsupported'
  | 'conflict'
  | 'unknown';

export type ErrorCode =
  | 'GIT_NOT_FOUND'
  | 'NOT_A_REPOSITORY'
  | 'INVALID_INPUT'
  | 'UNSAFE_PATH'
  | 'IO_ERROR'
  | 'GIT_FAILED'
  | 'GIT_CONFLICT'
  | 'NETWORK_ERROR'
  | 'AUTH_REQUIRED'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'NOT_FOUND'
  | 'UNSUPPORTED'
  | 'SETTINGS_CORRUPT'
  | 'GITHUB_ERROR'
  | 'AI_ERROR'
  | 'INTERNAL';

export interface AppError {
  code: ErrorCode;
  kind: ErrorKind;
  message: string;
  detail?: string;
  stderr?: string;
  hint?: string;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const fail = <T = never>(error: AppError): Result<T> => ({ ok: false, error });

/* ------------------------------------------------------------------ */
/* Repository / status                                                 */
/* ------------------------------------------------------------------ */

export interface HeadInfo {
  branch: string | null;
  detached: boolean;
  unborn: boolean;
  oid: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
}

export interface IdentityInfo {
  name: string | null;
  email: string | null;
}

export interface RepoInfo {
  path: string;
  name: string;
  gitDir: string;
  head: HeadInfo;
  identity: IdentityInfo;
  isShallow: boolean;
  gitVersion: string;
}

export type FileState =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'typechange'
  | 'untracked'
  | 'conflicted'
  | 'ignored';

export interface StatusEntry {
  path: string;
  origPath?: string;
  index: FileState | null;
  worktree: FileState | null;
  untracked: boolean;
  conflicted: boolean;
  staged: boolean;
  unstaged: boolean;
}

export type MergeKind = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'am' | null;

export interface OperationState {
  kind: MergeKind;
  conflicts: string[];
  description: string | null;
  canContinue: boolean;
}

export interface RepoSnapshot {
  info: RepoInfo;
  files: StatusEntry[];
  operation: OperationState;
  stats: { staged: number; unstaged: number; untracked: number; conflicted: number };
  refreshedAt: string;
}

export interface RecentRepo {
  path: string;
  name: string;
  pinned: boolean;
  lastOpenedAt: string;
}

/* ------------------------------------------------------------------ */
/* Diff                                                                */
/* ------------------------------------------------------------------ */

export type DiffLineKind = 'context' | 'add' | 'del' | 'meta';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldNumber: number | null;
  newNumber: number | null;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffFile {
  oldPath: string;
  newPath: string;
  displayPath: string;
  status: 'added' | 'deleted' | 'modified' | 'renamed' | 'copied' | 'binary' | 'mode';
  binary: boolean;
  tooLarge: boolean;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  patch: string;
  oldMode?: string;
  newMode?: string;
  language: string;
}

export interface DiffResult {
  files: DiffFile[];
  text: string;
  truncated: boolean;
  stats: { files: number; additions: number; deletions: number };
  compared: string;
}

export type DiffTarget = 'worktree' | 'staged' | 'commit' | 'range' | 'stash';

export interface DiffRequest {
  repoPath: string;
  target: DiffTarget;
  commit?: string;
  from?: string;
  to?: string;
  stashRef?: string;
  path?: string;
  context?: number;
  ignoreWhitespace?: boolean;
}

/* ------------------------------------------------------------------ */
/* Commit / history                                                    */
/* ------------------------------------------------------------------ */

export interface CommitSummary {
  sha: string;
  shortSha: string;
  parents: string[];
  author: string;
  authorEmail: string;
  date: string;
  subject: string;
  body: string;
  refs: string[];
  lane?: number;
}

export interface CommitDetails {
  commit: CommitSummary;
  files: DiffFileSummary[];
  diff: DiffResult;
}

export interface DiffFileSummary {
  path: string;
  oldPath?: string;
  status: string;
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface LogRequest {
  repoPath: string;
  limit?: number;
  skip?: number;
  all?: boolean;
  ref?: string;
  search?: string;
  path?: string;
}

export interface LogResult {
  commits: CommitSummary[];
  hasMore: boolean;
  headSha: string | null;
}

export interface CommitRequest {
  repoPath: string;
  message: string;
  description?: string;
  amend?: boolean;
  signoff?: boolean;
  allowEmpty?: boolean;
}

export interface CommitResult {
  sha: string;
  shortSha: string;
  subject: string;
  filesChanged: number;
}

export interface FileHistoryEntry {
  sha: string;
  shortSha: string;
  author: string;
  date: string;
  subject: string;
  path: string;
  changeType: string;
}

/* ------------------------------------------------------------------ */
/* Branches / tags / remotes                                           */
/* ------------------------------------------------------------------ */

export interface BranchInfo {
  name: string;
  fullName: string;
  isRemote: boolean;
  remote: string | null;
  sha: string;
  shortSha: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  isHead: boolean;
  updatedAt: string;
  subject: string;
  checkedOutAt: string | null;
}

export interface BranchComparison {
  base: string;
  head: string;
  ahead: number;
  behind: number;
  commits: CommitSummary[];
  files: DiffFileSummary[];
}

export interface TagInfo {
  name: string;
  sha: string;
  annotated: boolean;
  message: string;
  date: string | null;
  author: string | null;
}

export interface RemoteInfo {
  name: string;
  fetchUrl: string;
  pushUrl: string;
  branches: number;
}

export interface RemoteOpResult {
  operation: 'fetch' | 'pull' | 'push';
  output: string;
  remote: string;
  branch: string | null;
  setUpstream?: boolean;
  snapshot?: RepoSnapshot;
}

/* ------------------------------------------------------------------ */
/* Stash / worktree / advanced operations                              */
/* ------------------------------------------------------------------ */

export interface StashEntry {
  index: number;
  ref: string;
  sha: string;
  shortSha: string;
  message: string;
  date: string;
  branch: string | null;
}

export interface WorktreeInfo {
  path: string;
  head: string | null;
  shortHead: string | null;
  branch: string | null;
  bare: boolean;
  detached: boolean;
  locked: boolean;
  lockReason: string | null;
  prunable: boolean;
  isMain: boolean;
  dirty: boolean;
  statusError?: string;
}

export interface AdvancedOpResult {
  output: string;
  snapshot: RepoSnapshot;
  conflicts: string[];
}

export interface ConflictFile {
  path: string;
  kind:
    | 'both-modified'
    | 'both-added'
    | 'deleted-by-them'
    | 'deleted-by-us'
    | 'added-by-us'
    | 'added-by-them'
    | 'both-deleted'
    | 'unknown';
  base: string | null;
  ours: string | null;
  theirs: string | null;
  working: string | null;
  binary: boolean;
}

export interface OperationContinueRequest {
  repoPath: string;
  kind: Exclude<MergeKind, null>;
  message?: string;
}

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

export interface ConfigEntry {
  key: string;
  value: string;
  scope: 'local' | 'global' | 'system';
}

/* ------------------------------------------------------------------ */
/* Markdown / files                                                    */
/* ------------------------------------------------------------------ */

export interface RepoFile {
  path: string;
  size: number;
  modifiedAt: string;
}

export interface TextFile {
  path: string;
  content: string;
  size: number;
  modifiedAt: string;
  version: string;
  truncated: boolean;
}

export interface SaveFileResult {
  path: string;
  version: string;
  size: number;
}

/* ------------------------------------------------------------------ */
/* .gitignore                                                          */
/* ------------------------------------------------------------------ */

export interface IgnoreCheck {
  path: string;
  ignored: boolean;
  source: string | null;
  pattern: string | null;
  line: number | null;
}

export interface IgnoreTemplate {
  id: string;
  name: string;
  description: string;
  lines: string[];
}

/* ------------------------------------------------------------------ */
/* Preflight                                                           */
/* ------------------------------------------------------------------ */

export type CheckType = 'status' | 'conflicts' | 'command' | 'secret-scan' | 'custom';

export interface PreflightCheckConfig {
  id: string;
  name: string;
  type: CheckType;
  command: string | null;
  args: string[];
  required: boolean;
  timeoutMs: number;
  enabled: boolean;
  description: string;
}

export interface PreflightConfig {
  repoPath: string;
  trustCommands: boolean;
  blockCommitOnFailure: boolean;
  checks: PreflightCheckConfig[];
  updatedAt: string;
}

export type CheckStatus = 'queued' | 'running' | 'passed' | 'failed' | 'skipped' | 'timed-out' | 'cancelled';

export interface CheckResult {
  checkId: string;
  name: string;
  type: CheckType;
  commandLine: string | null;
  status: CheckStatus;
  exitCode: number | null;
  durationMs: number;
  output: string;
  outputTruncated: boolean;
  summary: string;
  stateFingerprint: string;
}

export interface PreflightRun {
  id: string;
  repoPath: string;
  branch: string | null;
  headSha: string | null;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'passed' | 'failed' | 'cancelled' | 'stale';
  results: CheckResult[];
  fingerprint: string;
  stale: boolean;
  error?: string;
}

/* ------------------------------------------------------------------ */
/* GitHub                                                              */
/* ------------------------------------------------------------------ */

export interface GithubStatus {
  configured: boolean;
  authenticated: boolean;
  login: string | null;
  name: string | null;
  avatarUrl: string | null;
  scopes: string[];
  repository: { owner: string; name: string } | null;
  error: string | null;
  rateLimitRemaining: number | null;
  rateLimitReset: string | null;
}

export interface GithubUser {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  scopes: string[];
  rateLimitRemaining: number | null;
  rateLimitReset: string | null;
}

export interface PullRequestSummary {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  author: string;
  createdAt: string;
  updatedAt: string;
  headRef: string;
  baseRef: string;
  url: string;
  mergeable: string | null;
  comments: number;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
}

export interface IssueSummary {
  number: number;
  title: string;
  state: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  labels: string[];
  comments: number;
  url: string;
}

export interface GithubRelease {
  id: number;
  tagName: string;
  name: string;
  draft: boolean;
  prerelease: boolean;
  createdAt: string;
  publishedAt: string | null;
  url: string;
  author: string;
}

export interface WorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  branch: string;
  event: string;
  createdAt: string;
  url: string;
}

export interface CreatePrRequest {
  repoPath: string;
  title: string;
  body: string;
  head: string;
  base: string;
  draft: boolean;
  pushFirst: boolean;
}

export interface CreateIssueRequest {
  repoPath: string;
  title: string;
  body: string;
}

/* ------------------------------------------------------------------ */
/* Settings / AI                                                       */
/* ------------------------------------------------------------------ */

export interface ShortcutMap {
  commandPalette: string;
  refresh: string;
  commit: string;
  openRepo: string;
  search: string;
}

export interface AiSettings {
  enabled: boolean;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  consent: boolean;
}

export interface Settings {
  theme: 'dark' | 'light' | 'system';
  gitPath: string;
  defaultRepoDir: string;
  diff: {
    mode: 'unified' | 'split';
    context: number;
    ignoreWhitespace: boolean;
    wrap: boolean;
  };
  editor: {
    fontFamily: string;
    fontSize: number;
    tabSize: number;
  };
  notifications: {
    enabled: boolean;
    operationToasts: boolean;
  };
  privacy: {
    sendDiagnostics: false;
    logLevel: 'info' | 'debug' | 'error';
  };
  ai: AiSettings;
  preflight: {
    defaultTimeoutMs: number;
    defaultTrustCommands: boolean;
  };
  shortcuts: ShortcutMap;
  github: {
    hasToken: boolean;
    apiBase: string;
  };
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export interface SettingsUpdate {
  patch: Partial<Settings>;
}

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  electron: string;
  chrome: string;
  node: string;
  git: { available: boolean; version: string | null; path: string; error: string | null };
  dataDir: string;
  isPackaged: boolean;
}

/* ------------------------------------------------------------------ */
/* AI                                                                  */
/* ------------------------------------------------------------------ */

export interface AiRequest {
  repoPath: string;
  task: 'explain-diff' | 'commit-message' | 'explain-error' | 'summarize-commit';
  input: string;
}

export interface AiResponse {
  text: string;
  model: string;
}

/* ------------------------------------------------------------------ */
/* API results                                                         */
/* ------------------------------------------------------------------ */

export interface GitHubRepoRef {
  owner: string;
  name: string;
  url: string;
  defaultBranch: string;
  private: boolean;
}

export interface ApiResults {
  'app.info': AppInfo;
  'app.openExternal': { opened: boolean };
  'app.showItemInFolder': { shown: boolean };

  'dialog.openDirectory': { path: string | null };
  'dialog.openFile': { path: string | null };

  'settings.get': Settings;
  'settings.update': Settings;
  'settings.reset': Settings;
  'settings.setGithubToken': { stored: boolean };
  'settings.clearGithubToken': { cleared: boolean };
  'settings.setAiKey': { stored: boolean };
  'settings.clearAiKey': { cleared: boolean };

  'recent.list': RecentRepo[];
  'recent.remove': RecentRepo[];
  'recent.pin': RecentRepo[];
  'recent.clear': RecentRepo[];

  'git.detect': AppInfo['git'];
  'git.open': RepoSnapshot;
  'git.init': RepoSnapshot;
  'git.clone': RepoSnapshot;
  'git.status': RepoSnapshot;
  'git.stage': RepoSnapshot;
  'git.unstage': RepoSnapshot;
  'git.discard': RepoSnapshot;
  'git.applyPatch': RepoSnapshot;

  'git.diff': DiffResult;
  'git.commit': CommitResult;
  'git.log': LogResult;
  'git.commitDetails': CommitDetails;
  'git.fileHistory': FileHistoryEntry[];
  'git.showFile': TextFile;
  'git.searchCommits': LogResult;

  'git.branches': BranchInfo[];
  'git.createBranch': BranchInfo[];
  'git.switchBranch': RepoSnapshot;
  'git.renameBranch': BranchInfo[];
  'git.deleteBranch': BranchInfo[];
  'git.setUpstream': RepoSnapshot;
  'git.compareBranches': BranchComparison;
  'git.merge': AdvancedOpResult;
  'git.rebase': AdvancedOpResult;
  'git.cherryPick': AdvancedOpResult;
  'git.revert': AdvancedOpResult;

  'git.tags': TagInfo[];
  'git.createTag': TagInfo[];
  'git.deleteTag': TagInfo[];

  'git.remotes': RemoteInfo[];
  'git.addRemote': RemoteInfo[];
  'git.editRemote': RemoteInfo[];
  'git.removeRemote': RemoteInfo[];
  'git.fetch': RemoteOpResult;
  'git.pull': RemoteOpResult;
  'git.push': RemoteOpResult;
  'git.pushTag': RemoteOpResult;

  'git.stashes': StashEntry[];
  'git.createStash': StashEntry[];
  'git.applyStash': RepoSnapshot;
  'git.popStash': RepoSnapshot;
  'git.dropStash': StashEntry[];

  'git.worktrees': WorktreeInfo[];
  'git.addWorktree': WorktreeInfo[];
  'git.removeWorktree': WorktreeInfo[];
  'git.pruneWorktrees': WorktreeInfo[];

  'git.operationState': OperationState;
  'git.conflicts': ConflictFile[];
  'git.saveConflict': ConflictFile[];
  'git.markResolved': RepoSnapshot;
  'git.continueOperation': AdvancedOpResult;
  'git.abortOperation': RepoSnapshot;

  'git.config': ConfigEntry[];
  'git.configSet': ConfigEntry[];
  'git.configUnset': ConfigEntry[];

  'ignore.read': { path: string; content: string; exists: boolean };
  'ignore.write': { path: string; content: string; exists: boolean };
  'ignore.check': IgnoreCheck;
  'ignore.templates': IgnoreTemplate[];

  'files.listMarkdown': RepoFile[];
  'files.readText': TextFile;
  'files.saveText': SaveFileResult;

  'preflight.getConfig': PreflightConfig;
  'preflight.setConfig': PreflightConfig;
  'preflight.detect': PreflightCheckConfig[];
  'preflight.start': PreflightRun;
  'preflight.getRun': PreflightRun;
  'preflight.runs': PreflightRun[];
  'preflight.cancel': PreflightRun;

  'github.status': GithubStatus;
  'github.pulls': PullRequestSummary[];
  'github.issues': IssueSummary[];
  'github.releases': GithubRelease[];
  'github.workflows': WorkflowRun[];
  'github.repo': GitHubRepoRef;
  'github.createPr': { number: number; url: string };
  'github.createIssue': { number: number; url: string };
  'github.pushBranch': RemoteOpResult;
  'github.createRelease': GithubRelease;

  'ai.settings': AiSettings;
  'ai.explain': AiResponse;
  'ai.test': { ok: boolean; message: string };
}

export type ApiMethod = keyof ApiResults;

export type ApiArgs<M extends ApiMethod> = ApiParams[M];

export interface RendererApi {
  invoke<M extends ApiMethod>(method: M, payload: ApiParams[M]): Promise<Result<ApiResults[M]>>;
  onEvent(listener: (event: AppEvent) => void): () => void;
  platform: string;
  transport: 'ipc' | 'http';
}

export type AppEvent =
  | { type: 'repo-changed'; repoPath: string }
  | { type: 'preflight-progress'; runId: string }
  | { type: 'toast'; level: 'info' | 'success' | 'warning' | 'error'; message: string };

export type { ApiParams } from './contract';
