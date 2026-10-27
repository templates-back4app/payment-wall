#!/usr/bin/env bash
# The same shop, in the two shapes this problem comes in, with the same stranger
# attacking both. The payment provider keeps the only ledger that holds real money.
#
#   ./run.sh
#
# Needs Node 22 and nothing else.
set -euo pipefail
cd "$(dirname "$0")"
PORT=8181
PROVIDER_PORT=8182
export PORT PROVIDER_PORT

wait_for() { for _ in $(seq 1 60); do curl -sf -o /dev/null "$1" && return 0; sleep 0.2; done
  echo "never came up: $1" >&2; return 1; }

up() { # mode
  MODE="$1" node shop.mjs 2>/dev/null & echo $! > .shop.pid; disown
  node provider.mjs 2>/dev/null & echo $! > .prov.pid; disown
  wait_for "http://127.0.0.1:$PORT/stats"
  wait_for "http://127.0.0.1:$PROVIDER_PORT/balance"
}
down() {
  for f in .shop.pid .prov.pid; do [ -f $f ] && { kill "$(cat $f)" 2>/dev/null || true; rm -f $f; }; done
  wait 2>/dev/null || true
}
trap down EXIT

up client-trust
node attack.mjs client-trust
down

up webhook
node attack.mjs webhook
down
