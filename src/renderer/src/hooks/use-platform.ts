/** Returns the OS platform string (e.g. 'linux', 'darwin', 'win32'). */
export function usePlatform(): string {
  return window.api.window.platform
}
