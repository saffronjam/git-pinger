import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Provider } from '../shared/provider'

/** Encrypts and stores authentication tokens using Electron's safeStorage API. */
export class TokenStore {
  private tokensDir: string

  constructor() {
    this.tokensDir = join(app.getPath('userData'), 'tokens')
    if (!existsSync(this.tokensDir)) {
      mkdirSync(this.tokensDir, { recursive: true })
    }
  }

  /** Checks whether the OS keychain-based encryption is available. */
  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  /** Encrypts and saves a token for the given provider. */
  saveToken(provider: Provider, token: string): void {
    if (!this.isAvailable()) {
      throw new Error('Encryption is not available on this system')
    }
    const encrypted = safeStorage.encryptString(token)
    writeFileSync(this.tokenPath(provider), encrypted)
  }

  /** Decrypts and returns the token for the given provider, or null if not stored. */
  getToken(provider: Provider): string | null {
    const path = this.tokenPath(provider)
    if (!existsSync(path)) {
      return null
    }
    if (!this.isAvailable()) {
      throw new Error('Encryption is not available on this system')
    }
    const encrypted = readFileSync(path)
    return safeStorage.decryptString(encrypted)
  }

  /** Deletes the stored token for the given provider. */
  deleteToken(provider: Provider): void {
    const path = this.tokenPath(provider)
    if (existsSync(path)) {
      unlinkSync(path)
    }
  }

  /** Returns whether a token exists for the given provider. */
  hasToken(provider: Provider): boolean {
    return existsSync(this.tokenPath(provider))
  }

  /** Returns the file path for a provider's encrypted token. */
  private tokenPath(provider: Provider): string {
    return join(this.tokensDir, `${provider}.enc`)
  }
}
