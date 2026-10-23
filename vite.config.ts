import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The lazily loaded 3D chunk (three.js) is ~900 kB before gzip by design.
  build: { chunkSizeWarningLimit: 1000 },
})
