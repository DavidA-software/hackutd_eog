import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Backend API (Spring Boot). Dataset files go there too, so uploaded datasets (e.g. test/) load.
  // Only the three dataset files are forwarded; anything else under /data (e.g. city_boundaries.json)
  // is still served from public/.
  server: {
    proxy: {
      '/api': 'http://localhost:8081',
      '^/data/[^/]+/(network\\.json|ops\\.json|telemetry\\.csv)$': 'http://localhost:8081',
    },
  },
})
