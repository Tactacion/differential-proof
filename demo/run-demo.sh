#!/usr/bin/env bash
# Runs the three demo scenarios and prints what each one should say.
#   1. real fix + honest proof      -> PROVEN      (check passes)
#   2. fake fix + its own proof     -> VACUOUS     (check fails: proof also passes on main)
#   3. fake fix + the honest proof  -> HEAD_FAILS  (check fails: the bug is still there)
# Usage: bash demo/run-demo.sh [extra diffproof flags, e.g. --video]
set -uo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$HERE/.demo-repo"
[ -d "$REPO" ] || bash "$HERE/demo/make-demo-repo.sh" "$REPO"

run() {
  local expect="$1" head="$2" proof="$3"; shift 3
  echo
  echo "=== $head + $(basename "$proof")  (expect $expect) ==="
  node "$HERE/bin/diffproof.js" run --repo "$REPO" --base main --head "$head" \
    --proof "$HERE/demo/proofs/$proof" --start "node server.js" --port 4321 \
    --runs 2 --out "$HERE/.diffproof" "$@" | sed -n '1,3p;/Diff coverage/p'
}

run PROVEN     fix-invoice-export invoices-export.json "$@"
run VACUOUS    fake-fix           reports-export.json  "$@"
run HEAD_FAILS fake-fix           invoices-export.json "$@"
echo
echo "Full results and videos are under $HERE/.diffproof/"
