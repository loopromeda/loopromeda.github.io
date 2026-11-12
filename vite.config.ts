import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { deviceReport } from './scripts/vite-device-report.ts'
import { licences } from './scripts/vite-licences.ts'
import { offline } from './scripts/vite-offline.ts'

export default defineConfig({
  // GitHub Pages serves the site at the root of loopromeda.github.io
  // (deploy.yml); BASE_PATH builds it for a path under a host instead
  base: process.env.BASE_PATH ?? '/',
  plugins: [
    react(),
    tailwindcss(),
    deviceReport(),
    // licences.txt: ours, and those of what the site ships. Tailwind's
    // preflight lands in the stylesheet.
    licences({ title: 'Loopromeda', also: ['tailwindcss'] }),
    // sw.js: the service worker, holding what the build ships, to play
    // offline
    offline({ worker: 'src/sw/sw.ts' }),
  ],
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
