#!/usr/bin/env bash
# Serves the Vite dev server (127.0.0.1:5173) to the tailnet over HTTPS, at
# https://<machine>.<tailnet>.ts.net:5173. Tailscale holds a real certificate
# for that name, so phones on the tailnet get a secure context (AudioWorklet
# needs one) without trusting a local CA. Only this port's entry is touched;
# other `tailscale serve` entries on the machine are left as they are.
#
#   scripts/tailnet.sh on       start serving (persists until `off`)
#   scripts/tailnet.sh off      stop serving this port
#   scripts/tailnet.sh status   all serve entries on this machine
set -euo pipefail

PORT="${PORT:-5173}"

ts() {
  if command -v tailscale >/dev/null 2>&1; then
    tailscale "$@"
  else
    # The macOS app ships its CLI inside the bundle
    /Applications/Tailscale.app/Contents/MacOS/Tailscale "$@"
  fi
}

# Prints a JS expression on `s`, the output of `tailscale status --json`
status() {
  ts status --self --json |
    node -p "const s = JSON.parse(require('fs').readFileSync(0, 'utf8')); $1"
}

case "${1:-status}" in
  on)
    # Without HTTPS certificates on the tailnet, `tailscale serve --https`
    # prints an enable link and then waits for it indefinitely
    if [ "$(status '(s.CertDomains ?? []).length')" = 0 ]; then
      cat >&2 <<'EOF'
tailnet: HTTPS certificates are not enabled on this tailnet.
Enable them once in the Tailscale admin console (DNS → HTTPS Certificates),
or run `tailscale serve --https=5173 http://127.0.0.1:5173` by hand to get
the direct enable link, then run this again.
EOF
      exit 1
    fi
    ts serve --bg --https="$PORT" "http://127.0.0.1:$PORT"
    echo "tailnet: https://$(status 's.Self.DNSName.replace(/\.$/, "")'):$PORT"
    ;;
  off)
    ts serve --https="$PORT" off
    ;;
  status)
    ts serve status
    ;;
  *)
    echo "usage: $0 on|off|status" >&2
    exit 2
    ;;
esac
