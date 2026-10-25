import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SettingsStore } from '../../src/main/services/settings';
import { MemorySecretStore } from '../../src/main/services/secrets';

let dir = '';

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gitpp-settings-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('SettingsStore', () => {
  it('loads defaults and persists validated updates', async () => {
    const store = new SettingsStore(dir, new MemorySecretStore());
    await store.load();
    expect(store.get().theme).toBe('dark');
    await store.update({ theme: 'light', diff: { context: 7 } });
    const reloaded = new SettingsStore(dir, new MemorySecretStore());
    await reloaded.load();
    expect(reloaded.get().theme).toBe('light');
    expect(reloaded.get().diff.context).toBe(7);
    expect(JSON.parse(await fs.readFile(path.join(dir, 'settings.json'), 'utf8')).theme).toBe('light');
  });

  it('rejects invalid settings without corrupting the file', async () => {
    const store = new SettingsStore(dir, new MemorySecretStore());
    await store.load();
    await expect(store.update({ theme: 'neon' as 'dark' })).rejects.toThrow(/Invalid setting/);
    expect(store.get().theme).toBe('dark');
  });

  it('requires AI consent before enabling AI', async () => {
    const store = new SettingsStore(dir, new MemorySecretStore());
    await store.load();
    await expect(store.update({ ai: { enabled: true, consent: false } })).rejects.toThrow(/consent|acknowledge/i);
  });

  it('recovers from corrupted JSON and writes a backup', async () => {
    await fs.writeFile(path.join(dir, 'settings.json'), '{not json');
    const store = new SettingsStore(dir, new MemorySecretStore());
    await store.load();
    expect(store.get().theme).toBe('dark');
    expect(store.takeWarnings().length).toBe(1);
    const files = await fs.readdir(dir);
    expect(files.some((file) => file.includes('settings.json.corrupt-'))).toBe(true);
  });

  it('manages recents without touching folders', async () => {
    const store = new SettingsStore(dir, new MemorySecretStore());
    await store.load();
    await store.addRecent('/tmp/project-a');
    await store.addRecent('/tmp/project-b');
    await store.pinRecent('/tmp/project-a', true);
    expect(store.listRecents()[0]?.path).toBe('/tmp/project-a');
    await store.removeRecent('/tmp/project-b');
    expect(store.listRecents()).toHaveLength(1);
    await store.clearRecents();
    expect(store.listRecents()).toHaveLength(1);
    expect(store.listRecents()[0]?.pinned).toBe(true);
  });

  it('tracks token presence without storing the token in settings.json', async () => {
    const secrets = new MemorySecretStore();
    await secrets.set('github-token', 'test-credential-value');
    const store = new SettingsStore(dir, secrets);
    await store.load();
    expect(store.get().github.hasToken).toBe(true);
    const raw = await fs.readFile(path.join(dir, 'settings.json'), 'utf8').catch(() => '');
    expect(raw).not.toContain('test-credential-value');
  });
});
