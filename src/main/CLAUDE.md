# src/main — Electron Main Process

This is the Node.js main process. It owns the app lifecycle, creates windows, and will handle:

- API polling (GitHub/GitLab) on a configurable interval
- Native OS notifications via Electron's `Notification` API
- Secure token storage via `safeStorage`
- Persistent config via `electron-conf`
- System tray integration

## Key Constraints

- **macOS notification GC bug**: Always hold references to `Notification` objects until their click/close handlers fire. If you let them get garbage-collected, event handlers silently stop working after ~1-2 minutes.
- **IPC must be typed**: All IPC channels and payloads must use shared types (defined in a shared types location) used by both this process and the preload/renderer.
- **No direct renderer communication**: All communication with the renderer goes through the preload bridge via `ipcMain`.
- **Environment variables**: Use `MAIN_VITE_` prefix for any env vars needed here.
