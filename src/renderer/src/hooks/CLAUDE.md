# src/renderer/src/hooks — React Context Hooks

All hooks follow a strict Provider + Consumer pattern. New hooks must match this structure.

## Pattern

1. `createContext<T | undefined>(undefined)` — context starts undefined
2. Export a `*Provider` component that:
   - Fetches initial state via `window.api.*` in a `useEffect`
   - Subscribes to IPC push events (`window.api.on.*`) in the same effect
   - Returns the unsubscribe function(s) as the effect cleanup
3. Export a `use*` hook that reads context and throws with a descriptive error if used outside the provider

## Key Rules

- Providers return `ReactNode`
- IPC subscriptions return unsubscribe functions — return them directly from `useEffect` cleanup (or call them in a cleanup arrow if multiple)
- Exception: the theme hook uses `localStorage` + `matchMedia` instead of IPC, since theme is renderer-local
