import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface SecretStore {
  readonly available: boolean;
  readonly kind: 'os-encrypted' | 'memory';
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Electron implementation using safeStorage (DPAPI on Windows, Keychain on
 * macOS, libsecret on Linux). Secrets are encrypted at rest and never written
 * to settings.json or logs.
 */
export class EncryptedFileSecretStore implements SecretStore {
  readonly available = true;
  readonly kind = 'os-encrypted' as const;
  private readonly dir: string;
  private readonly safeStorage: { isEncryptionAvailable(): boolean; encryptString(value: string): Buffer; decryptString(value: Buffer): string };

  constructor(dataDir: string, safeStorage: EncryptedFileSecretStore['safeStorage']) {
    this.dir = path.join(dataDir, 'secrets');
    this.safeStorage = safeStorage;
  }

  private file(key: string): string {
    if (!/^[a-z0-9_-]+$/i.test(key)) throw new Error('Invalid secret key');
    return path.join(this.dir, `${key}.bin`);
  }

  async get(key: string): Promise<string | null> {
    if (!this.safeStorage.isEncryptionAvailable()) return null;
    try {
      const buffer = await fs.readFile(this.file(key));
      return this.safeStorage.decryptString(buffer);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('OS credential encryption is not available.');
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    const encrypted = this.safeStorage.encryptString(value);
    const target = this.file(key);
    const temp = `${target}.tmp`;
    await fs.writeFile(temp, encrypted, { mode: 0o600 });
    await fs.rename(temp, target);
  }

  async delete(key: string): Promise<void> {
    await fs.unlink(this.file(key)).catch(() => undefined);
  }
}

/**
 * Non-persistent store. Used by the browser test harness because Electron's
 * safeStorage is unavailable outside the desktop runtime. Secrets never touch
 * disk in this mode.
 */
export class MemorySecretStore implements SecretStore {
  readonly available = true;
  readonly kind = 'memory' as const;
  private readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}
