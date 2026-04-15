import { resolve } from 'path'
import { execSync } from 'child_process'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const version = execSync('git describe --tags --always').toString().trim()

export default defineConfig({
  main: {
    define: { __APP_VERSION__: JSON.stringify(version) },
  },
  preload: {
    define: { __APP_VERSION__: JSON.stringify(version) },
  },
  renderer: {
    define: { __APP_VERSION__: JSON.stringify(version) },
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
      },
    },
    plugins: [react(), tailwindcss()],
  },
})
