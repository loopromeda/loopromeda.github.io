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

## Check

```sh
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test
```
