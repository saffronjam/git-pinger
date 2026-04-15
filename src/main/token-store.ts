import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Provider } from '../shared/provider'

interface TokenData {
  github: string | null
  gitlab: string | null
}

/** Encrypts and stores authentication tokens using Electron's safeStorage API. */
export class TokenStore {
  private filePath: string
  private cache: TokenData | null = null

  constructor() {
    const dir = join(app.getPath('userData'), 'tokens')
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    this.filePath = join(dir, 'tokens.enc')
  }

  /** Checks whether the OS keychain-based encryption is available. */
  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  /** Encrypts and saves a token for the given provider. */
  saveToken(provider: Provider, token: string): void {
    const data = this.load()
    data[provider] = token
    this.save(data)
  }

  /** Decrypts and returns the token for the given provider, or null if not stored. */
  getToken(provider: Provider): string | null {
    const data = this.load()
    return data[provider]
  }

  /** Deletes the stored token for the given provider. */
  deleteToken(provider: Provider): void {
    const data = this.load()
    data[provider] = null
    this.save(data)
  }

  /** Returns whether a token exists for the given provider. */
  hasToken(provider: Provider): boolean {
    const data = this.load()
    return data[provider] !== null
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
    const json = safeStorage.decryptString(encrypted)
    this.cache = JSON.parse(json) as TokenData
    return this.cache
  }

  /** Encrypts and writes the token data to disk. */
  private save(data: TokenData): void {
    if (!this.isAvailable()) {
      throw new Error('Encryption is not available on this system')
    }

    this.cache = data
    const json = JSON.stringify(data)
    const encrypted = safeStorage.encryptString(json)
    writeFileSync(this.filePath, encrypted)
  }
}
