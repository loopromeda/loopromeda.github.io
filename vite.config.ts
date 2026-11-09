import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { deviceReport } from './scripts/vite-device-report.ts'

export default defineConfig({
  // GitHub Pages serves the project page under /loopromeda/ (deploy.yml)
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss(), deviceReport()],
  server: {
    // Phones reach this server over the tailnet: `tailscale serve`
    // (scripts/tailnet.sh) terminates HTTPS on <machine>.<tailnet>.ts.net:5173
    // and proxies to 127.0.0.1:5173. IPv4 loopback on purpose, since
    // "localhost" may bind ::1 only; a fixed port, since the proxy points at
    // it.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // Vite refuses requests whose Host it does not know
    allowedHosts: ['.ts.net'],
  },
})
