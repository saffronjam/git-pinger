import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Stub config used only by the shadcn CLI.
 * The real build config is in electron.vite.config.ts.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve('src/renderer/src'),
    },
  },
  plugins: [react(), tailwindcss()],
})
