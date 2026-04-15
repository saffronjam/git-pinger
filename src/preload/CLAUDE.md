# src/preload — Electron Preload Scripts

The preload script runs in a sandboxed context before the renderer loads. It bridges the main process (Node.js) and renderer (Chromium) via `contextBridge`.

## Key Constraints

- **Typed in tsconfig.node.json**: This code compiles under the Node.js tsconfig, not the web one. DOM types are not available.
- **contextBridge only**: All APIs exposed to the renderer must go through `contextBridge.exposeInMainWorld()`. Never expose raw Node.js APIs.
- **Type declarations**: `index.d.ts` declares the `Window` interface extensions so the renderer can use exposed APIs with full type safety. Keep it in sync with what `index.ts` actually exposes.
- **Minimal surface area**: Only expose the specific IPC channels and methods the renderer needs. Don't create broad pass-through APIs.
