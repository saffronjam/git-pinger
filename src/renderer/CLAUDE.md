# src/renderer — React UI (Chromium)

The renderer is a standard React app running in Chromium. It uses shadcn/ui components with Tailwind CSS v4.

## Path Alias

`@/*` resolves to `src/renderer/src/*` — use this for all imports within the renderer.

## UI Stack

- **shadcn/ui**: Add components via `bunx shadcn@latest add <component>`. They land in `components/ui/`.
- **Tailwind CSS v4**: Configured via `@tailwindcss/vite` plugin. CSS variables for theming are in `assets/`.
- **Dark/light mode**: Managed by a `ThemeProvider` hook. Uses a CSS class strategy (`.dark` on `<html>`). Always test both themes.
- **No hardcoded colors**: Never use fixed color classes like `bg-black`, `text-neutral-200`, `text-white`, etc. Always use theme-aware tokens (`bg-background`, `text-foreground`, `text-muted-foreground`, `bg-muted`, etc.) so the UI works in both light and dark mode.

## Key Constraints

- **No Node.js APIs**: This runs in a browser context. Access Electron/Node via `window.api` (exposed by preload).
- **Component reuse**: Always search existing `components/ui/` before creating new components.
- **No `any` types**: Use proper types, `unknown` with narrowing, or generics.
- **JSDoc on exported functions**: All exported functions and non-trivial components need JSDoc.
- **No unnecessary comments**: Code should be self-documenting. No section dividers.
