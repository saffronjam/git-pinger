import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import type { Provider } from '../shared/provider'

export type StoredToken =
  | { kind: 'raw'; value: string }
  | {
      kind: 'oauth'
      accessToken: string
      refreshToken: string | null
      expiresAt: string | null
    }

interface TokenData {
  github: StoredToken | null
  gitlab: StoredToken | null
}

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(enc: Buffer): string
}

/** Migrates a persisted token value (legacy string or modern object) to the StoredToken shape. */
function migrateEntry(raw: unknown): StoredToken | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'string') return { kind: 'raw', value: raw }
  if (typeof raw === 'object' && raw !== null && 'kind' in raw) {
    const obj = raw as { kind: string } & Record<string, unknown>
    if (obj.kind === 'raw' && typeof obj.value === 'string') {
      return { kind: 'raw', value: obj.value }
    }
    if (obj.kind === 'oauth' && typeof obj.accessToken === 'string') {
      return {
        kind: 'oauth',
        accessToken: obj.accessToken,
        refreshToken: typeof obj.refreshToken === 'string' ? obj.refreshToken : null,
        expiresAt: typeof obj.expiresAt === 'string' ? obj.expiresAt : null,
      }
    }
  }
  return null
}

/** Encrypts and stores authentication tokens on disk via an injected storage backend. */
export class TokenStore {
  private cache: TokenData | null = null

  constructor(
    private filePath: string,
    private storage: SafeStorageLike,
  ) {}

  /** Checks whether the underlying encryption backend is available. */
  isAvailable(): boolean {
    return this.storage.isEncryptionAvailable()
  }

  /** Encrypts and saves a raw string token (PAT-style) for the given provider. */
  saveToken(provider: Provider, token: string): void {
    const data = { ...this.load() }
    data[provider] = { kind: 'raw', value: token }
    this.save(data)
  }

  /** Saves an OAuth token bundle for the given provider. */
  saveOAuthToken(
    provider: Provider,
    entry: { accessToken: string; refreshToken: string | null; expiresAt: string | null },
  ): void {
    const data = { ...this.load() }
    data[provider] = { kind: 'oauth', ...entry }
    this.save(data)
  }

  /** Returns the access token string (raw value or OAuth access token), or null. */
  getToken(provider: Provider): string | null {
    const entry = this.getEntry(provider)
    if (!entry) return null
    return entry.kind === 'raw' ? entry.value : entry.accessToken
  }

  /** Returns the full stored token entry for the given provider. */
  getEntry(provider: Provider): StoredToken | null {
    return this.load()[provider]
  }

  /** Returns the refresh token for an OAuth entry, or null for raw/missing entries. */
  getRefreshToken(provider: Provider): string | null {
    const entry = this.getEntry(provider)
    if (!entry || entry.kind !== 'oauth') return null
    return entry.refreshToken
  }

  /** Deletes the stored token for the given provider. */
  deleteToken(provider: Provider): void {
    const data = { ...this.load() }
    data[provider] = null
    this.save(data)
  }

  /** Returns whether a token exists for the given provider. */
  hasToken(provider: Provider): boolean {
    return this.getEntry(provider) !== null
  }

  /** Loads and decrypts the token data. Uses in-memory cache after first read. */
  private load(): TokenData {
    if (this.cache) return this.cache

    if (!existsSync(this.filePath)) {
      this.cache = { github: null, gitlab: null }
      return this.cache
    }

    if (!this.isAvailable()) {
      throw new Error('Encryption is not available on this system')
    }

    const encrypted = readFileSync(this.filePath)
    const json = this.storage.decryptString(encrypted)
    const parsed = JSON.parse(json) as Record<string, unknown>
    this.cache = {
      github: migrateEntry(parsed['github']),
      gitlab: migrateEntry(parsed['gitlab']),
    }
    return this.cache
  }

  /**
   * Encrypts and writes the token data to disk atomically.
   *
   * Writes to a sibling temp file, fsyncs it, then renames over the target. The in-memory cache is
   * only updated after the rename succeeds, so a failure anywhere in the encrypt/write/rename
   * sequence leaves both disk and cache untouched. This is load-bearing for OAuth refresh: if the
   * cache were updated speculatively and the disk write later threw, the next process start would
   * load the stale on-disk refresh token and be locked out by GitLab's rotation enforcement.
   */
  private save(data: TokenData): void {
    if (!this.isAvailable()) {
      throw new Error('Encryption is not available on this system')
    }

    const json = JSON.stringify(data)
    const encrypted = this.storage.encryptString(json)
    const tmpPath = `${this.filePath}.tmp`

    const fd = openSync(tmpPath, 'w')
    try {
      writeFileSync(fd, encrypted)
      fsyncSync(fd)
    } catch (err) {
      try {
        closeSync(fd)
      } catch {
        // ignore — original error is more useful
      }
      try {
        unlinkSync(tmpPath)
      } catch {
        // ignore — best-effort cleanup
      }
      throw err
    }
    closeSync(fd)
    renameSync(tmpPath, this.filePath)
    this.cache = data
  }
}
