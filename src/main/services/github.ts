import type {
  CreateIssueRequest,
  CreatePrRequest,
  GitHubRepoRef,
  GithubRelease,
  GithubStatus,
  IssueSummary,
  PullRequestSummary,
  RemoteOpResult,
  Settings,
  WorkflowRun,
} from '../../shared/types';
import { ERR, makeError } from '../../shared/errors';
import { GitError } from '../git/errors';
import type { GitService } from '../git/GitService';
import type { SecretStore } from './secrets';

export interface GitHubRepoMeta {
  owner: string;
  name: string;
  url: string;
  defaultBranch: string;
  private: boolean;
}

interface ApiErrorShape {
  message?: string;
  documentation_url?: string;
}

export function parseGithubRemote(url: string): { owner: string; name: string } | null {
  const cleaned = url.trim().replace(/\.git$/, '').replace(/\/$/, '');
  const https = /^https?:\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/([^/]+)$/.exec(cleaned);
  if (https) return { owner: https[1] ?? '', name: https[2] ?? '' };
  const ssh = /^(?:ssh:\/\/)?git@github\.com[:/]([^/]+)\/([^/]+)$/.exec(cleaned);
  if (ssh) return { owner: ssh[1] ?? '', name: ssh[2] ?? '' };
  const enterprise = /^https?:\/\/([^/]+)\/(?!api\/)([^/]+)\/([^/]+)$/.exec(cleaned);
  if (enterprise) return { owner: enterprise[2] ?? '', name: enterprise[3] ?? '' };
  return null;
}

export class GithubService {
  constructor(
    private readonly git: GitService,
    private readonly secrets: SecretStore,
    private readonly settings: () => Settings,
  ) {}

  private async token(): Promise<string | null> {
    return this.secrets.get('github-token');
  }

  private base(): string {
    return (this.settings().github.apiBase || 'https://api.github.com').replace(/\/$/, '');
  }

  async repoRef(repoPath: string): Promise<GitHubRepoMeta> {
    const remotes = await this.git.remotes(repoPath);
    const origin = remotes.find((remote) => remote.name === 'origin') ?? remotes[0];
    if (!origin) throw new GitError(ERR.validation('This repository has no remote.'));
    const parsed = parseGithubRemote(origin.fetchUrl) ?? parseGithubRemote(origin.pushUrl);
    if (!parsed) throw new GitError(ERR.validation('The "origin" remote does not point to GitHub.'));
    return { ...parsed, url: `https://github.com/${parsed.owner}/${parsed.name}`, defaultBranch: '', private: false };
  }

  async status(repoPath: string): Promise<GithubStatus> {
    const token = await this.token();
    const base: GithubStatus = {
      configured: Boolean(token),
      authenticated: false,
      login: null,
      name: null,
      avatarUrl: null,
      scopes: [],
      repository: null,
      error: null,
      rateLimitRemaining: null,
      rateLimitReset: null,
    };
    try {
      const ref = await this.repoRef(repoPath);
      base.repository = { owner: ref.owner, name: ref.name };
    } catch (error) {
      base.error = GitError.toAppError(error).message;
    }
    if (!token) {
      return { ...base, error: base.error ?? 'Add a GitHub token in Settings to enable the GitHub workspace.' };
    }
    try {
      const response = await this.request<{ login: string; name: string | null; avatar_url: string | null }>('/user', token);
      base.authenticated = true;
      base.login = response.data.login;
      base.name = response.data.name;
      base.avatarUrl = response.data.avatar_url;
      base.scopes = response.scopes;
      base.rateLimitRemaining = response.rateLimitRemaining;
      base.rateLimitReset = response.rateLimitReset;
    } catch (error) {
      base.error = GitError.toAppError(error).message;
    }
    return base;
  }

  private async request<T>(path: string, token: string, init: RequestInit = {}): Promise<{
    data: T;
    scopes: string[];
    rateLimitRemaining: number | null;
    rateLimitReset: string | null;
  }> {
    const url = path.startsWith('http') ? path : `${this.base()}${path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'GitPlusPlus/1.0',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      throw new GitError(makeError('NETWORK_ERROR', 'network', 'Could not reach the GitHub API.', {
        detail: String(error),
        hint: 'Check your connection, proxy, or GitHub Enterprise API base URL in Settings.',
      }));
    }
    const scopes = (response.headers.get('x-oauth-scopes') ?? '').split(',').map((scope) => scope.trim()).filter(Boolean);
    const rateLimitRemaining = response.headers.get('x-ratelimit-remaining') ? Number(response.headers.get('x-ratelimit-remaining')) : null;
    const resetSeconds = response.headers.get('x-ratelimit-reset');
    const rateLimitReset = resetSeconds ? new Date(Number(resetSeconds) * 1000).toISOString() : null;
    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const apiError = (payload ?? {}) as ApiErrorShape;
      const message = apiError.message ?? `GitHub API returned ${response.status}.`;
      const kind = response.status === 401 ? 'auth' : response.status === 403 ? (rateLimitRemaining === 0 ? 'network' : 'auth') : response.status === 404 ? 'not-found' : 'network';
      throw new GitError(makeError('GITHUB_ERROR', kind === 'not-found' ? 'not-found' : kind, message, {
        detail: apiError.documentation_url,
        hint:
          response.status === 401
            ? 'The GitHub token is invalid or expired. Replace it in Settings.'
            : response.status === 403
              ? rateLimitRemaining === 0
                ? `GitHub API rate limit reached. It resets at ${rateLimitReset ?? 'an unknown time'}.`
                : 'The token is missing a required scope. Classic tokens usually need "repo"; fine-grained tokens need repository contents, issues and pull requests permissions.'
              : response.status === 404
                ? 'The repository, endpoint, or resource was not found, or the token cannot see it.'
                : undefined,
      }));
    }
    return { data: payload as T, scopes, rateLimitRemaining, rateLimitReset };
  }

  private async call<T>(repoPath: string, path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.token();
    if (!token) throw new GitError(makeError('AUTH_REQUIRED', 'auth', 'GitHub is not connected.', { hint: 'Add a personal access token in Settings > GitHub.' }));
    const ref = await this.repoRef(repoPath);
    const fullPath = path.replace('{owner}', encodeURIComponent(ref.owner)).replace('{repo}', encodeURIComponent(ref.name));
    const response = await this.request<T>(fullPath, token, init);
    return response.data;
  }

  async pulls(repoPath: string): Promise<PullRequestSummary[]> {
    const raw = await this.call<Array<Record<string, unknown>>>(repoPath, '/repos/{owner}/{repo}/pulls?state=all&per_page=50&sort=updated');
    return raw.map((item) => ({
      number: Number(item.number),
      title: String(item.title ?? ''),
      state: String(item.state ?? (item.draft ? 'draft' : 'open')),
      draft: Boolean(item.draft),
      author: String((item.user as { login?: string } | undefined)?.login ?? 'unknown'),
      createdAt: String(item.created_at ?? ''),
      updatedAt: String(item.updated_at ?? ''),
      headRef: String((item.head as { ref?: string } | undefined)?.ref ?? ''),
      baseRef: String((item.base as { ref?: string } | undefined)?.ref ?? ''),
      url: String(item.html_url ?? ''),
      mergeable: item.mergeable === null || item.mergeable === undefined ? null : String(item.mergeable),
      comments: Number(item.comments ?? 0) + Number(item.review_comments ?? 0),
    }));
  }

  async issues(repoPath: string): Promise<IssueSummary[]> {
    const raw = await this.call<Array<Record<string, unknown>>>(repoPath, '/repos/{owner}/{repo}/issues?state=all&per_page=50&sort=updated');
    return raw
      .filter((item) => !item.pull_request)
      .map((item) => ({
        number: Number(item.number),
        title: String(item.title ?? ''),
        state: String(item.state ?? 'open'),
        author: String((item.user as { login?: string } | undefined)?.login ?? 'unknown'),
        createdAt: String(item.created_at ?? ''),
        updatedAt: String(item.updated_at ?? ''),
        labels: Array.isArray(item.labels) ? (item.labels as Array<{ name?: string }>).map((label) => String(label.name ?? '')) : [],
        comments: Number(item.comments ?? 0),
        url: String(item.html_url ?? ''),
      }));
  }

  async releases(repoPath: string): Promise<GithubRelease[]> {
    const raw = await this.call<Array<Record<string, unknown>>>(repoPath, '/repos/{owner}/{repo}/releases?per_page=30');
    return raw.map((item) => ({
      id: Number(item.id),
      tagName: String(item.tag_name ?? ''),
      name: String(item.name ?? item.tag_name ?? ''),
      draft: Boolean(item.draft),
      prerelease: Boolean(item.prerelease),
      createdAt: String(item.created_at ?? ''),
      publishedAt: item.published_at ? String(item.published_at) : null,
      url: String(item.html_url ?? ''),
      author: String((item.author as { login?: string } | undefined)?.login ?? ''),
    }));
  }

  async workflows(repoPath: string): Promise<WorkflowRun[]> {
    const raw = await this.call<{ workflow_runs?: Array<Record<string, unknown>> }>(repoPath, '/repos/{owner}/{repo}/actions/runs?per_page=30');
    return (raw.workflow_runs ?? []).map((item) => ({
      id: Number(item.id),
      name: String(item.name ?? 'Workflow'),
      status: String(item.status ?? ''),
      conclusion: item.conclusion ? String(item.conclusion) : null,
      branch: String(item.head_branch ?? ''),
      event: String(item.event ?? ''),
      createdAt: String(item.created_at ?? ''),
      url: String(item.html_url ?? ''),
    }));
  }

  async repo(repoPath: string): Promise<GitHubRepoRef> {
    const ref = await this.repoRef(repoPath);
    const raw = await this.call<{ html_url: string; default_branch: string; private: boolean }>(repoPath, '/repos/{owner}/{repo}');
    return {
      owner: ref.owner,
      name: ref.name,
      url: raw.html_url,
      defaultBranch: raw.default_branch,
      private: Boolean(raw.private),
    };
  }

  async createPull(repoPath: string, request: CreatePrRequest): Promise<{ number: number; url: string }> {
    if (request.pushFirst) {
      await this.git.push(repoPath, undefined, request.head, true);
    }
    const raw = await this.call<{ number: number; html_url: string }>(repoPath, '/repos/{owner}/{repo}/pulls', {
      method: 'POST',
      body: JSON.stringify({
        title: request.title,
        body: request.body,
        head: request.head,
        base: request.base,
        draft: request.draft,
      }),
    });
    return { number: raw.number, url: raw.html_url };
  }

  async createIssue(repoPath: string, request: CreateIssueRequest): Promise<{ number: number; url: string }> {
    const raw = await this.call<{ number: number; html_url: string }>(repoPath, '/repos/{owner}/{repo}/issues', {
      method: 'POST',
      body: JSON.stringify({ title: request.title, body: request.body }),
    });
    return { number: raw.number, url: raw.html_url };
  }


  async createRelease(repoPath: string, request: { tag: string; name: string; body: string; draft: boolean; prerelease: boolean }): Promise<GithubRelease> {
    const raw = await this.call<Record<string, unknown>>(repoPath, '/repos/{owner}/{repo}/releases', {
      method: 'POST',
      body: JSON.stringify({
        tag_name: request.tag,
        name: request.name,
        body: request.body,
        draft: request.draft,
        prerelease: request.prerelease,
      }),
    });
    return {
      id: Number(raw.id),
      tagName: String(raw.tag_name ?? request.tag),
      name: String(raw.name ?? request.name),
      draft: Boolean(raw.draft),
      prerelease: Boolean(raw.prerelease),
      createdAt: String(raw.created_at ?? ''),
      publishedAt: raw.published_at ? String(raw.published_at) : null,
      url: String(raw.html_url ?? ''),
      author: String((raw.author as { login?: string } | undefined)?.login ?? ''),
    };
  }

  async pushBranch(repoPath: string, branch: string, setUpstream: boolean): Promise<RemoteOpResult> {
    return this.git.push(repoPath, undefined, branch, setUpstream);
  }
}
