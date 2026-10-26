import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { RecentRepo, Settings } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/defaults';
import { ERR } from '../../shared/errors';
import { GitError } from '../git/errors';
import type { SecretStore } from './secrets';

const settingsSchema = z.object({
  theme: z.enum(['dark', 'light', 'system']),
  gitPath: z.string().max(4096),
  defaultRepoDir: z.string().max(4096),
  diff: z.object({
    mode: z.enum(['unified', 'split']),
    context: z.number().int().min(0).max(50),
    ignoreWhitespace: z.boolean(),
    wrap: z.boolean(),
  }),
  editor: z.object({
    fontFamily: z.string().max(200),
    fontSize: z.number().int().min(8).max(32),
    tabSize: z.number().int().min(1).max(8),
  }),
  notifications: z.object({ enabled: z.boolean(), operationToasts: z.boolean() }),
  privacy: z.object({ sendDiagnostics: z.literal(false), logLevel: z.enum(['info', 'debug', 'error']) }),
  ai: z.object({
    enabled: z.boolean(),
    baseUrl: z.string().max(2048),
    model: z.string().max(200),
    hasKey: z.boolean(),
    consent: z.boolean(),
  }),
  preflight: z.object({ defaultTimeoutMs: z.number().int().min(1000).max(3_600_000), defaultTrustCommands: z.boolean() }),
  shortcuts: z.object({
    commandPalette: z.string().max(64),
    refresh: z.string().max(64),
    commit: z.string().max(64),
    openRepo: z.string().max(64),
    search: z.string().max(64),
  }),
  github: z.object({ hasToken: z.boolean(), apiBase: z.string().max(2048) }),
});

const recentsSchema = z.array(
  z.object({
    path: z.string().min(1).max(4096),
    name: z.string().max(255),
    pinned: z.boolean(),
    lastOpenedAt: z.string().max(64),
  }),
);

function mergeDeep<T>(base: T, patch: unknown): T {
  if (patch === null || patch === undefined) return base;
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return patch as T;
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return base;
  const output: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (!(key in output)) continue;
    output[key] = mergeDeep(output[key], value);
  }
  return output as T;
}

export class SettingsStore {
  readonly dataDir: string;
  readonly settingsFile: string;
  readonly recentsFile: string;
  private settings: Settings;
  private recents: RecentRepo[];
  private warnings: string[] = [];

  constructor(dataDir: string, private readonly secrets: SecretStore) {
    this.dataDir = dataDir;
    this.settingsFile = path.join(dataDir, 'settings.json');
    this.recentsFile = path.join(dataDir, 'recent-repositories.json');
    this.settings = structuredClone(DEFAULT_SETTINGS);
    this.recents = [];
  }

  async load(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
    this.settings = await this.loadJson(this.settingsFile, settingsSchema, structuredClone(DEFAULT_SETTINGS));
    this.recents = await this.loadJson(this.recentsFile, recentsSchema, []);
    this.settings.github.hasToken = Boolean(await this.secrets.get('github-token'));
    this.settings.ai.hasKey = Boolean(await this.secrets.get('ai-key'));
    this.recents = this.recents.filter((entry) => entry && typeof entry.path === 'string').slice(0, 50);
  }

  private async loadJson<T>(file: string, schema: z.ZodType<T>, fallback: T): Promise<T> {
    if (!existsSync(file)) return fallback;
    try {
      const raw = JSON.parse(await fs.readFile(file, 'utf8'));
      const parsed = schema.safeParse(raw);
      if (!parsed.success) throw new Error(parsed.error.message);
      return parsed.data;
    } catch (error) {
      const backup = `${file}.corrupt-${Date.now()}`;
      await fs.rename(file, backup).catch(() => undefined);
      this.warnings.push(`Recovered from a damaged configuration file. Backup: ${backup}. ${String(error).slice(0, 200)}`);
      return fallback;
    }
  }

  takeWarnings(): string[] {
    const warnings = this.warnings;
    this.warnings = [];
    return warnings;
  }

  get(): Settings {
    return structuredClone(this.settings);
  }

  async update(patch: unknown): Promise<Settings> {
    const merged = mergeDeep(this.settings, patch);
    const parsed = settingsSchema.safeParse(merged);
    if (!parsed.success) {
      throw new GitError(ERR.validation(`Invalid setting: ${parsed.error.issues[0]?.path.join('.') ?? 'unknown'} — ${parsed.error.issues[0]?.message ?? 'invalid value'}`));
    }
    if (parsed.data.github.apiBase) {
      const url = parsed.data.github.apiBase;
      const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(url);
      if (!/^https:\/\//.test(url) && !isLocal) {
        throw new GitError(ERR.validation('The GitHub API base URL must use HTTPS (HTTP is allowed only for localhost).'));
      }
    }
    if (parsed.data.ai.baseUrl) {
      const url = parsed.data.ai.baseUrl;
      const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(url);
      if (!/^https:\/\//.test(url) && !isLocal) {
        throw new GitError(ERR.validation('The AI endpoint must use HTTPS (HTTP is allowed only for localhost).'));
      }
      if (parsed.data.ai.enabled && !parsed.data.ai.consent) {
        throw new GitError(ERR.validation('AI must stay disabled until you acknowledge that content is sent to the provider.'));
      }
    }
    this.settings = parsed.data;
    await this.persistSettings();
    return this.get();
  }

  async updateWithIdentity(hasGithubToken: boolean, hasAiKey: boolean): Promise<Settings> {
    this.settings.github.hasToken = hasGithubToken;
    this.settings.ai.hasKey = hasAiKey;
    return this.get();
  }

  private async persistSettings(): Promise<void> {
    const temp = `${this.settingsFile}.tmp`;
    await fs.writeFile(temp, JSON.stringify(this.settings, null, 2), 'utf8');
    await fs.rename(temp, this.settingsFile);
  }

  async reset(): Promise<Settings> {
    this.settings = structuredClone(DEFAULT_SETTINGS);
    this.settings.github.hasToken = Boolean(await this.secrets.get('github-token'));
    this.settings.ai.hasKey = Boolean(await this.secrets.get('ai-key'));
    await this.persistSettings();
    return this.get();
  }

  /* ---------------------------- recents ----------------------------- */

  listRecents(): RecentRepo[] {
    return this.recents
      .slice()
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastOpenedAt.localeCompare(a.lastOpenedAt));
  }

  async addRecent(repoPath: string): Promise<void> {
    const name = path.basename(repoPath);
    const existing = this.recents.find((entry) => entry.path === repoPath);
    if (existing) {
      existing.lastOpenedAt = new Date().toISOString();
      existing.name = name;
    } else {
      this.recents.unshift({ path: repoPath, name, pinned: false, lastOpenedAt: new Date().toISOString() });
    }
    this.recents = this.recents.slice(0, 40);
    await this.persistRecents();
  }

  async removeRecent(repoPath: string): Promise<RecentRepo[]> {
    this.recents = this.recents.filter((entry) => entry.path !== repoPath);
    await this.persistRecents();
    return this.listRecents();
  }

  async pinRecent(repoPath: string, pinned: boolean): Promise<RecentRepo[]> {
    const entry = this.recents.find((candidate) => candidate.path === repoPath);
    if (entry) entry.pinned = pinned;
    await this.persistRecents();
    return this.listRecents();
  }

  async clearRecents(): Promise<RecentRepo[]> {
    this.recents = this.recents.filter((entry) => entry.pinned);
    await this.persistRecents();
    return this.listRecents();
  }

  private async persistRecents(): Promise<void> {
    const temp = `${this.recentsFile}.tmp`;
    await fs.writeFile(temp, JSON.stringify(this.recents, null, 2), 'utf8');
    await fs.rename(temp, this.recentsFile);
  }
}
