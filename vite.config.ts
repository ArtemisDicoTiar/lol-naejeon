import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'child_process'

function git(cmd: string, fallback = 'unknown') {
  try { return execSync(cmd, { cwd: import.meta.dirname }).toString().trim(); }
  catch { return fallback; }
}

const GIT_HASH  = git('git rev-parse --short HEAD');
const GIT_COUNT = git('git rev-list --count HEAD', '0');
const BUILD_TIME = new Date().toISOString();

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  define: {
    __GIT_HASH__:  JSON.stringify(GIT_HASH),
    __GIT_COUNT__: JSON.stringify(GIT_COUNT),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
})
