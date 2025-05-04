import { Address, toHex } from "viem";

// ZAMMSingleLiqETH contract constants
export const ZAMMSingleLiqETHAddress: Address = "0x7c1E515F1c7F1c4909206BD92F6A4BFc0138E58b";

// Properly typed ABI with documentation
export const ZAMMSingleLiqETHAbi = [
  {
    "inputs": [],
    "name": "InvalidPoolKey",
    "type": "error"
  },
  {
    "inputs": [
      {
        "components": [
          {
            "internalType": "uint256",
            "name": "id0",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "id1",
            "type": "uint256"
          },
          {
            "internalType": "address",
            "name": "token0",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "token1",
            "type": "address"
          },
          {
            "internalType": "uint96",
            "name": "swapFee",
            "type": "uint96"
          }
        ],
        "internalType": "struct PoolKey",
        "name": "poolKey",
        "type": "tuple"
      },
      {
        "internalType": "uint256",
        "name": "amountOutMin",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "amount0Min",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "amount1Min",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "deadline",
        "type": "uint256"
      }
    ],
    "name": "addSingleLiqETH",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "amount0",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "amount1",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "liquidity",
        "type": "uint256"
      }
    ],
    "stateMutability": "payable",
    "type": "function"
  }
] as const;

/**
 * Helper function to add single-sided liquidity with ETH
 * This integrates with SwapTile.tsx and allows users to provide just ETH 
 * to get exposure to both sides of the pool
 * 
 * @param coinId - The ID of the coin to pair with ETH
 * @param ethAmount - Amount of ETH to provide (will be split: half swapped to coin, half as ETH)
 * @param minCoinAmount - Minimum coin amount expected from the swap (protects from slippage)
 * @param minEthAmount - Minimum ETH amount to be used in liquidity (protects from slippage)
 * @param minCoinLiqAmount - Minimum coin amount to be used in liquidity (protects from slippage)
 * @param to - Address receiving the LP tokens
 * @param deadline - Timestamp when the transaction expires
 * @returns Parameters for the contract call
 */
export function prepareSingleLiqETHParams(
  coinId: bigint,
  ethAmount: bigint,
  minCoinAmount: bigint,
  minEthAmount: bigint,
  minCoinLiqAmount: bigint,
  to: Address,
  deadline: bigint
) {
  return {
    poolKey: {
      id0: 0n,
      id1: coinId,
      token0: "0x0000000000000000000000000000000000000000" as Address,
      token1: "0xEA70fe7F6EC2A28F32AF230C39B9B2fb3Fe29ec8" as Address, // CoinsAddress
      swapFee: 100n // 1% fee
    },
    amountOutMin: minCoinAmount,
    amount0Min: minEthAmount,
    amount1Min: minCoinLiqAmount,
    to,
    deadline
  };
}