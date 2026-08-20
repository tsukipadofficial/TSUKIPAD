#!/usr/bin/env bash
#
# Spin up a local Arc-like chain with the whole launchpad stack on it.
#
# Why this exists: Arc's USDC lives at a fixed address and is backed by native
# balance at the node level, so a plain `anvil --fork-url` of Arc can read USDC
# but cannot transfer it. This script instead runs a fresh anvil with the same
# chain id and installs a normal ERC20 at the USDC address, which makes the full
# buy/sell path exercisable offline.
#
# Usage:  ./scripts/local-dev.sh
# Then:   cd web && pnpm dev

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/contracts"

RPC="http://127.0.0.1:8545"
CHAIN_ID=5042002
USDC="0x3600000000000000000000000000000000000000"

# anvil's first default account
KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
ACC="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"

echo "==> building contracts"
forge build >/dev/null

echo "==> starting anvil (chain $CHAIN_ID)"
pkill -f "anvil --chain-id $CHAIN_ID" 2>/dev/null || true
anvil --chain-id "$CHAIN_ID" --silent &
ANVIL_PID=$!
trap 'kill $ANVIL_PID 2>/dev/null || true' EXIT

for _ in $(seq 1 40); do
  cast chain-id --rpc-url "$RPC" >/dev/null 2>&1 && break
  sleep 0.25
done

echo "==> installing a spendable USDC at $USDC"
RUNTIME=$(node -e "process.stdout.write(require('./out/MockUSDC.sol/MockUSDC.json').deployedBytecode.object)")
cast rpc anvil_setCode "$USDC" "$RUNTIME" --rpc-url "$RPC" >/dev/null
cast send "$USDC" "mint(address,uint256)" "$ACC" 5000000000000 \
  --private-key "$KEY" --rpc-url "$RPC" >/dev/null
echo "    minted $(cast call "$USDC" 'balanceOf(address)(uint256)' "$ACC" --rpc-url "$RPC") (6dp) to $ACC"

# viem's arcTestnet chain declares a multicall3 address, so wagmi batches all
# read calls through it. Arc has it deployed; a fresh anvil does not, and the
# batched reads fail silently. Mirror the real chain by copying its bytecode.
echo "==> mirroring multicall3 from Arc testnet"
MULTICALL3="0xcA11bde05977b3631167028862bE2a173976CA11"
MC_CODE=$(cast code "$MULTICALL3" --rpc-url https://rpc.testnet.arc.io 2>/dev/null || echo "0x")
if [ "${#MC_CODE}" -gt 4 ]; then
  cast rpc anvil_setCode "$MULTICALL3" "$MC_CODE" --rpc-url "$RPC" >/dev/null
  echo "    installed multicall3 (${#MC_CODE} chars)"
else
  echo "    WARNING: could not fetch multicall3; batched reads may fail"
fi

echo "==> deploying launchpad stack"
PRIVATE_KEY="$KEY" forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC" --broadcast --skip-simulation >/dev/null

LAUNCHPAD=$(node -e "process.stdout.write(require('./deployments/$CHAIN_ID.json').launchpad)")
ROUTER=$(node -e "process.stdout.write(require('./deployments/$CHAIN_ID.json').swapRouter)")
echo "    launchpad $LAUNCHPAD"
echo "    router    $ROUTER"

echo "==> seeding demo launches"
PRIVATE_KEY="$KEY" LAUNCHPAD="$LAUNCHPAD" ROUTER="$ROUTER" \
  forge script script/SeedDemo.s.sol:SeedDemo \
  --rpc-url "$RPC" --broadcast --skip-simulation 2>&1 | grep -E "^  " || true

cat > "$ROOT/web/.env.local" <<EOF
# Written by scripts/local-dev.sh — points the app at the local anvil chain.
NEXT_PUBLIC_RPC_URL=$RPC
NEXT_PUBLIC_LAUNCHPAD_ADDRESS=$LAUNCHPAD
NEXT_PUBLIC_SWAP_ROUTER_ADDRESS=$ROUTER
EOF

echo
echo "==> ready. wrote web/.env.local"
echo "    import this key into your wallet: $KEY"
echo "    add network: RPC $RPC, chain id $CHAIN_ID"
echo
echo "    now run:  cd web && pnpm dev"
echo
echo "anvil is running in the foreground; press ctrl-c to stop."
wait $ANVIL_PID
