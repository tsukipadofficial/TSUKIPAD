#!/usr/bin/env bash
#
# Generates real trading volume on a launched token, so the live trade tape and
# fee accrual can be seen working on Arc testnet.
#
# Uses direct `cast send` rather than `forge script`: Arc's USDC is
# native-backed, and forge simulates the script body locally against forked
# state before broadcasting, where USDC transfers cannot be executed.
#
# Usage: ./scripts/make-volume.sh <tokenAddress>

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
set -a; source "$ROOT/.secrets/deployer.env"; set +a

RPC=https://rpc.testnet.arc.io
USDC=0x3600000000000000000000000000000000000000
ROUTER=${ROUTER:-0x130AA5329Bf8Ee1A6b17144f587D94525447B64a}
LAUNCHPAD=${LAUNCHPAD:-0x04cD49c6e50470b01131e81DBcbAD1df21c3904a}
TOKEN=${1:?token address required}
ME=$ARC_DEPLOYER_ADDRESS
FEE=10000

deadline() { python3 -c "import time;print(int(time.time())+3600)"; }
usdc6()    { python3 -c "print(int($1*1e6))"; }

swap() { # tokenIn tokenOut amount label
  local out
  out=$(cast send "$ROUTER" \
    'exactInputSingle((address,address,uint24,address,uint256,uint256,uint256))' \
    "($1,$2,$FEE,$ME,$(deadline),$3,0)" \
    --private-key "$ARC_DEPLOYER_KEY" --rpc-url "$RPC" 2>&1 | grep -c 'status.*1' || true)
  if [ "$out" -gt 0 ]; then echo "  ✓ $4"; else echo "  ✗ $4 FAILED"; fi
}

echo "==> approving"
cast send "$USDC" 'approve(address,uint256)' "$ROUTER" \
  115792089237316195423570985008687907853269984665640564039457584007913129639935 \
  --private-key "$ARC_DEPLOYER_KEY" --rpc-url "$RPC" >/dev/null
cast send "$TOKEN" 'approve(address,uint256)' "$ROUTER" \
  115792089237316195423570985008687907853269984665640564039457584007913129639935 \
  --private-key "$ARC_DEPLOYER_KEY" --rpc-url "$RPC" >/dev/null
echo "  ✓ USDC + token approved"

echo
echo "==> trading"
# Buys and sells alternate so the tape shows both sides and fees accrue in
# both denominations. Sells are a fraction of the current balance, so the
# same capital can be recycled into far more volume than the wallet holds.
for step in "buy 2" "buy 3" "sell 30" "buy 1.5" "buy 4" "sell 45" "buy 2.5" "buy 1" "sell 25" "buy 3" "buy 2" "sell 40"; do
  set -- $step
  if [ "$1" = "buy" ]; then
    swap "$USDC" "$TOKEN" "$(usdc6 "$2")" "buy  \$$2"
  else
    BAL=$(cast call "$TOKEN" 'balanceOf(address)(uint256)' "$ME" --rpc-url "$RPC" | cut -d' ' -f1)
    AMT=$(python3 -c "print($BAL*$2//100)")
    swap "$TOKEN" "$USDC" "$AMT" "sell $2% of bag"
  fi
done

echo
echo "==> sweeping fees"
cast send "$LAUNCHPAD" 'collectFees(address)' "$TOKEN" \
  --private-key "$ARC_DEPLOYER_KEY" --rpc-url "$RPC" >/dev/null && echo "  ✓ fees collected"

echo
POOL_USDC=$(cast call "$USDC" 'balanceOf(address)(uint256)' \
  "$(cast call "$LAUNCHPAD" 'launchOf(address)((address,address,address,address,int24,int24,uint128,uint64,uint256,uint64,bool))' "$TOKEN" --rpc-url "$RPC" | tr ',' '\n' | sed -n '2p' | tr -d ' ')" --rpc-url "$RPC" | cut -d' ' -f1)
python3 -c "print(f'==> pool now holds \${$POOL_USDC/1e6:.2f} USDC')"
