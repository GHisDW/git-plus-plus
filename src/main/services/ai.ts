import type { AiRequest, AiResponse, AiSettings, Settings } from '../../shared/types';
import { makeError } from '../../shared/errors';
import { GitError } from '../git/errors';
import type { SecretStore } from './secrets';

const SYSTEM_PROMPTS: Record<AiRequest['task'], string> = {
  'explain-diff':
    'You are a careful senior engineer explaining a Git diff. Describe what changed, why it might matter, and call out risks. Do not invent intent or facts that are not in the diff. Keep it under 250 words.',
  'commit-message':
    'Write a concise Conventional Commits style commit message for the provided diff. Return only the commit message (a subject line under 72 characters, optionally a brief body). Do not use markdown fences.',
  'explain-error':
    'You are a Git expert. Explain the provided Git error in plain language, then give numbered recovery steps. Warn about destructive steps. Do not claim to have run any command.',
  'summarize-commit':
    'Summarize the provided commit diff for a changelog. State user-visible behavior changes and risks. Do not invent details. Keep it under 150 words.',
};

export class AiService {
  constructor(
    private readonly secrets: SecretStore,
    private readonly settings: () => Settings,
  ) {}

  async info(): Promise<AiSettings> {
    const settings = this.settings().ai;
    return { ...settings, hasKey: Boolean(await this.secrets.get('ai-key')) };
  }

  private async requireReady(): Promise<{ key: string; baseUrl: string; model: string }> {
    const settings = this.settings().ai;
    if (!settings.enabled) {
      throw new GitError(makeError('AI_ERROR', 'unsupported', 'AI assistance is turned off.', {
        hint: 'Enable it in Settings > AI, choose a provider endpoint, and acknowledge the data-sharing notice.',
      }));
    }
    if (!settings.consent) {
      throw new GitError(makeError('AI_ERROR', 'auth', 'AI data-sharing consent has not been granted.', {
        hint: 'Review Settings > AI to see exactly what would be sent, then enable consent.',
      }));
    }
    const key = await this.secrets.get('ai-key');
    if (!key) {
      throw new GitError(makeError('AI_ERROR', 'auth', 'No AI API key is stored.', {
        hint: 'Add a key in Settings > AI. Keys are encrypted with your operating system credential storage.',
      }));
    }
    return { key, baseUrl: settings.baseUrl.replace(/\/$/, ''), model: settings.model };
  }

  async explain(request: AiRequest): Promise<AiResponse> {
    const { key, baseUrl, model } = await this.requireReady();
    const input = request.input.slice(0, 24_000);
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 700,
          messages: [
            { role: 'system', content: SYSTEM_PROMPTS[request.task] },
            { role: 'user', content: input },
          ],
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      throw new GitError(makeError('NETWORK_ERROR', 'network', 'Could not reach the AI provider.', {
        detail: String(error),
        hint: 'Check the endpoint, your network, and any proxy configuration.',
      }));
    }
    const body = (await response.json().catch(() => null)) as
      | { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string }; model?: string }
      | null;
    if (!response.ok) {
      throw new GitError(makeError('AI_ERROR', response.status === 401 ? 'auth' : 'network', body?.error?.message ?? `AI provider returned ${response.status}.`, {
        hint: response.status === 401 ? 'The AI API key was rejected. Replace it in Settings.' : undefined,
      }));
    }
    const text = body?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new GitError(makeError('AI_ERROR', 'unknown', 'The AI provider returned an empty response.'));
    return { text, model: body?.model ?? model };
  }

  async test(): Promise<{ ok: boolean; message: string }> {
    try {
      const { key, baseUrl, model } = await this.requireReady();
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, max_tokens: 8, messages: [{ role: 'user', content: 'Reply with the word ready.' }] }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) return { ok: false, message: `Provider returned HTTP ${response.status}.` };
      return { ok: true, message: 'The AI provider responded successfully.' };
    } catch (error) {
      return { ok: false, message: GitError.toAppError(error).message };
    }
  }
}
