# Loopromeda

A polyphonic synthesizer for mobile browsers, played by touch.

Status: early setup. See [the plan](docs/plan/initial-setup.md).

## Develop

Requires Node 22+ and pnpm.

```sh
pnpm install
pnpm dev            # http://127.0.0.1:5173
```

### On a phone

The synth needs a secure context (HTTPS) for AudioWorklet. With
[Tailscale](https://tailscale.com) running on this machine and the phone:

```sh
pnpm dev:tailnet    # prints https://<machine>.<tailnet>.ts.net:5173
pnpm tailnet:off    # when done
```

The tailnet needs MagicDNS and HTTPS certificates enabled (Tailscale admin
console → DNS). The very first request after that waits about half a minute
while Tailscale obtains the certificate; later ones are instant.

### Offline

A build saves itself in the browser to start and play with no network (a
service worker, `src/sw/sw.ts`); the dev server never registers one. To
try it:

```sh
pnpm build && pnpm preview   # http://127.0.0.1:4173
```

## Check

```sh
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test
```

## License

MIT: see [LICENSE](LICENSE). The site ships with the licences of what it
is built with (React, the Recursive font, Tailwind's preflight), gathered
into `licences.txt` as it builds (`scripts/vite-licences.ts`) and linked
from Settings, About.
