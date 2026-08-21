/// Only the fragments this app actually calls. The full ABI lives in
/// web/lib/abi.ts; duplicating all of it here would be dead weight in a bundle.
export const launchpadAbi = [
  {
    type: "function", name: "launchCount", inputs: [],
    outputs: [{ type: "uint256" }], stateMutability: "view",
  },
  {
    type: "function", name: "recentLaunches",
    inputs: [{ name: "offset", type: "uint256" }, { name: "limit", type: "uint256" }],
    outputs: [{
      name: "page", type: "tuple[]",
      components: [
        { name: "token", type: "address" }, { name: "pool", type: "address" },
        { name: "creator", type: "address" }, { name: "feeRecipient", type: "address" },
        { name: "tickLower", type: "int24" }, { name: "tickUpper", type: "int24" },
        { name: "liquidity", type: "uint128" }, { name: "createdAt", type: "uint64" },
        { name: "creatorAllocation", type: "uint256" }, { name: "unlockAt", type: "uint64" },
        { name: "allocationClaimed", type: "bool" }, { name: "buybackAndBurn", type: "bool" },
        { name: "usdcSpentOnBuybacks", type: "uint256" }, { name: "tokensBurned", type: "uint256" },
      ],
    }],
    stateMutability: "view",
  },
] as const;

export const erc20Abi = [
  { type: "function", name: "name", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "symbol", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "decimals", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
  { type: "function", name: "totalSupply", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "balanceOf", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "tokenURI", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  {
    type: "function", name: "allowance",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ type: "uint256" }], stateMutability: "view",
  },
  {
    type: "function", name: "approve",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }], stateMutability: "nonpayable",
  },
] as const;

export const swapRouterAbi = [
  {
    type: "function", name: "exactInputSingle",
    inputs: [{
      name: "params", type: "tuple",
      components: [
        { name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" },
        { name: "fee", type: "uint24" }, { name: "recipient", type: "address" },
        { name: "deadline", type: "uint256" }, { name: "amountIn", type: "uint256" },
        { name: "amountOutMinimum", type: "uint256" },
      ],
    }],
    outputs: [{ name: "amountOut", type: "uint256" }],
    stateMutability: "nonpayable",
  },
] as const;

export const poolAbi = [
  {
    type: "function", name: "slot0", inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" }, { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" }, { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" }, { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" },
    ],
    stateMutability: "view",
  },
  { type: "function", name: "token0", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "token1", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "liquidity", inputs: [], outputs: [{ type: "uint128" }], stateMutability: "view" },
] as const;
