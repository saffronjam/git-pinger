import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TokenStore, type SafeStorageLike } from './token-store'

function makePassthroughStorage(): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8'),
  }
}

describe('TokenStore', () => {
  let dir: string
  let filePath: string
  const storage = makePassthroughStorage()

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'git-pinger-token-test-'))
    filePath = join(dir, 'tokens.enc')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('migrates legacy string entries to {kind:raw} on load', () => {
    const legacy = JSON.stringify({ github: 'legacy-pat', gitlab: null })
    writeFileSync(filePath, Buffer.from(legacy, 'utf8'))

    const store = new TokenStore(filePath, storage)
    const entry = store.getEntry('github')
    expect(entry).toEqual({ kind: 'raw', value: 'legacy-pat' })
    expect(store.getToken('github')).toBe('legacy-pat')
    expect(store.getEntry('gitlab')).toBeNull()
  })

  test('round-trips an OAuth entry with refresh token and expiry', () => {
    const store = new TokenStore(filePath, storage)
    const expiresAt = new Date(Date.now() + 7200 * 1000).toISOString()

    store.saveOAuthToken('gitlab', {
      accessToken: 'a-tok',
      refreshToken: 'r-tok',
      expiresAt,
    })
    expect(store.getToken('gitlab')).toBe('a-tok')
    expect(store.getRefreshToken('gitlab')).toBe('r-tok')

    const reloaded = new TokenStore(filePath, storage)
    expect(reloaded.getToken('gitlab')).toBe('a-tok')
    expect(reloaded.getRefreshToken('gitlab')).toBe('r-tok')
    expect(reloaded.getEntry('gitlab')).toEqual({
      kind: 'oauth',
      accessToken: 'a-tok',
      refreshToken: 'r-tok',
      expiresAt,
    })
  })

  test('saveToken overwrites OAuth entry with raw kind', () => {
    const store = new TokenStore(filePath, storage)
    store.saveOAuthToken('github', {
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: null,
    })
    store.saveToken('github', 'pat-token')
    expect(store.getEntry('github')).toEqual({ kind: 'raw', value: 'pat-token' })
    expect(store.getRefreshToken('github')).toBeNull()
  })

  test('deleteToken clears the entry', () => {
    const store = new TokenStore(filePath, storage)
    store.saveToken('gitlab', 'x')
    expect(store.hasToken('gitlab')).toBe(true)
    store.deleteToken('gitlab')
    expect(store.hasToken('gitlab')).toBe(false)
    expect(store.getToken('gitlab')).toBeNull()
  })

  test('getRefreshToken returns null for raw entries', () => {
    const store = new TokenStore(filePath, storage)
    store.saveToken('github', 'pat')
    expect(store.getRefreshToken('github')).toBeNull()
  })

  test('save failure leaves disk and cache untouched (atomic-write invariant)', () => {
    const store = new TokenStore(filePath, storage)
    store.saveOAuthToken('gitlab', {
      accessToken: 'a-old',
      refreshToken: 'r-old',
      expiresAt: null,
    })

    let throwOnce = true
    const flakyStorage: SafeStorageLike = {
      isEncryptionAvailable: () => true,
      encryptString: (s: string) => {
        if (throwOnce) {
          throwOnce = false
          throw new Error('keychain locked')
        }
        return Buffer.from(s, 'utf8')
      },
      decryptString: (b: Buffer) => b.toString('utf8'),
    }
    const flakyStore = new TokenStore(filePath, flakyStorage)

    expect(() =>
      flakyStore.saveOAuthToken('gitlab', {
        accessToken: 'a-new',
        refreshToken: 'r-new',
        expiresAt: null,
      }),
    ).toThrow('keychain locked')

    expect(flakyStore.getRefreshToken('gitlab')).toBe('r-old')

    const reloaded = new TokenStore(filePath, storage)
    expect(reloaded.getRefreshToken('gitlab')).toBe('r-old')
    expect(reloaded.getToken('gitlab')).toBe('a-old')
  })
})
