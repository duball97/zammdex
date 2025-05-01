// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

// ZAMMHelper.sol - ETH amount calculation helper for ZAMM liquidity pools

interface IZAMM {
    struct PoolKey {
        uint256 id0;
        uint256 id1;
        address token0;
        address token1;
        uint96 swapFee;
    }

    struct Pool {
        uint112 reserve0;
        uint112 reserve1;
        uint32 blockTimestampLast;
        uint256 price0CumulativeLast;
        uint256 price1CumulativeLast;
        uint256 kLast;
        uint256 supply;
    }

    function pools(uint256 poolId) external view returns (Pool memory);
    
    function addLiquidity(
        PoolKey calldata poolKey,
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 amount0Min,
        uint256 amount1Min,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amount0, uint256 amount1, uint256 liquidity);
}

/**
 * @title ZAMMHelper
 * @dev Helper contract for calculating exact ETH amounts for ZAMM liquidity operations
 */
contract ZAMMHelper {
    IZAMM public immutable zamm;

    constructor(address _zamm) {
        zamm = IZAMM(_zamm);
    }
    
    /**
     * @dev Helper function to add liquidity with exact ETH calculation
     * @param poolKey The pool key structure
     * @param amount1Desired The desired amount of token1
     * @param amount0Min Minimum amount of token0
     * @param amount1Min Minimum amount of token1
     * @param to Recipient of LP tokens
     * @param deadline Transaction deadline timestamp
     * @return Tuple of (amount0, amount1, liquidity)
     */
    function addLiquidityETH(
        IZAMM.PoolKey calldata poolKey,
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 amount0Min,
        uint256 amount1Min,
        address to,
        uint256 deadline
    ) external payable returns (uint256, uint256, uint256) {
        require(poolKey.token0 == address(0), "Token0 must be ETH");
        
        // Calculate the required ETH amount
        (uint256 ethAmount, , ) = this.calculateRequiredETH(poolKey, amount0Desired, amount1Desired);
        
        // Ensure user sent exact ETH amount
        require(msg.value == ethAmount, "Incorrect ETH amount");
        
        // Forward the call to ZAMM
        return zamm.addLiquidity{value: ethAmount}(
            poolKey,
            ethAmount, // amount0Desired is now the exact calculated ETH amount
            amount1Desired,
            amount0Min,
            amount1Min,
            to,
            deadline
        );
    }

    /**
     * @dev Calculates the poolId from a PoolKey structure
     * @param poolKey The pool key structure
     * @return poolId The computed pool ID
     */
    function getPoolId(IZAMM.PoolKey calldata poolKey) public pure returns (uint256 poolId) {
        assembly ("memory-safe") {
            let m := mload(0x40)
            calldatacopy(m, poolKey, 0xa0)
            poolId := keccak256(m, 0xa0)
        }
    }

    /**
     * @dev Calculates the exact ETH amount needed when adding liquidity
     * @param poolKey The pool key structure
     * @param amount0Desired The desired amount of token0 (ETH if token0 is address(0))
     * @param amount1Desired The desired amount of token1
     * @return ethAmount The exact ETH amount needed
     * @return amount0 The actual amount of token0 that will be used
     * @return amount1 The actual amount of token1 that will be used
     */
    function calculateRequiredETH(
        IZAMM.PoolKey calldata poolKey,
        uint256 amount0Desired,
        uint256 amount1Desired
    ) external view returns (uint256 ethAmount, uint256 amount0, uint256 amount1) {
        // Ensure token0 is ETH (address(0))
        require(poolKey.token0 == address(0), "Token0 must be ETH");
        
        uint256 poolId = getPoolId(poolKey);
        IZAMM.Pool memory pool = zamm.pools(poolId);
        
        uint112 reserve0 = pool.reserve0;
        uint112 reserve1 = pool.reserve1;
        
        // If the pool doesn't exist or is empty, use desired amounts
        if (pool.supply == 0) {
            return (amount0Desired, amount0Desired, amount1Desired);
        }
        
        // Calculate the optimal amounts based on the same formula in ZAMM.addLiquidity
        uint256 amount1Optimal = mulDiv(amount0Desired, reserve1, reserve0);
        
        // If amount1Optimal <= amount1Desired, use amount0Desired and amount1Optimal
        if (amount1Optimal <= amount1Desired) {
            amount0 = amount0Desired;
            amount1 = amount1Optimal;
        } else {
            // Otherwise, calculate amount0Optimal based on amount1Desired
            uint256 amount0Optimal = mulDiv(amount1Desired, reserve0, reserve1);
            
            // amount0Optimal should always be <= amount0Desired based on the calculation
            amount0 = amount0Optimal;
            amount1 = amount1Desired;
        }
        
        // Since token0 is ETH, the ethAmount is the calculated amount0
        ethAmount = amount0;
    }
    
    /**
     * @dev Calculates optimal ETH amount when token1 is ETH
     * @param poolKey The pool key structure
     * @param amount0Desired The desired amount of token0
     * @param amount1Desired The desired amount of token1 (ETH)
     * @return ethAmount The exact ETH amount needed
     * @return amount0 The actual amount of token0 that will be used
     * @return amount1 The actual amount of token1 (ETH) that will be used
     */
    function calculateRequiredETHForToken1(
        IZAMM.PoolKey calldata poolKey,
        uint256 amount0Desired,
        uint256 amount1Desired
    ) external view returns (uint256 ethAmount, uint256 amount0, uint256 amount1) {
        // Ensure token1 is ETH (address(0))
        require(poolKey.token1 == address(0), "Token1 must be ETH");
        
        uint256 poolId = getPoolId(poolKey);
        IZAMM.Pool memory pool = zamm.pools(poolId);
        
        uint112 reserve0 = pool.reserve0;
        uint112 reserve1 = pool.reserve1;
        
        // If the pool doesn't exist or is empty, use desired amounts
        if (pool.supply == 0) {
            return (amount1Desired, amount0Desired, amount1Desired);
        }
        
        // Calculate the optimal amounts based on the same formula in ZAMM.addLiquidity
        uint256 amount0Optimal = mulDiv(amount1Desired, reserve0, reserve1);
        
        // If amount0Optimal <= amount0Desired, use amount0Optimal and amount1Desired
        if (amount0Optimal <= amount0Desired) {
            amount0 = amount0Optimal;
            amount1 = amount1Desired;
        } else {
            // Otherwise, calculate amount1Optimal based on amount0Desired
            uint256 amount1Optimal = mulDiv(amount0Desired, reserve1, reserve0);
            
            // amount1Optimal should always be <= amount1Desired based on the calculation
            amount0 = amount0Desired;
            amount1 = amount1Optimal;
        }
        
        // Since token1 is ETH, the ethAmount is the calculated amount1
        ethAmount = amount1;
    }

    /**
     * @dev Math utility functions from ZAMM
     */
    function min(uint256 x, uint256 y) internal pure returns (uint256 z) {
        assembly ("memory-safe") {
            z := xor(x, mul(xor(x, y), lt(y, x)))
        }
    }

    function mulDiv(uint256 x, uint256 y, uint256 d) internal pure returns (uint256 z) {
        assembly ("memory-safe") {
            z := mul(x, y)
            if iszero(mul(or(iszero(x), eq(div(z, x), y)), d)) {
                mstore(0x00, 0xad251c27)
                revert(0x1c, 0x04)
            }
            z := div(z, d)
        }
    }

    function sqrt(uint256 x) internal pure returns (uint256 z) {
        assembly ("memory-safe") {
            z := 181
            let r := shl(7, lt(0xffffffffffffffffffffffffffffffffff, x))
            r := or(r, shl(6, lt(0xffffffffffffffffff, shr(r, x))))
            r := or(r, shl(5, lt(0xffffffffff, shr(r, x))))
            r := or(r, shl(4, lt(0xffffff, shr(r, x))))
            z := shl(shr(1, r), z)
            z := shr(18, mul(z, add(shr(r, x), 65536)))
            z := shr(1, add(z, div(x, z)))
            z := shr(1, add(z, div(x, z)))
            z := shr(1, add(z, div(x, z)))
            z := shr(1, add(z, div(x, z)))
            z := shr(1, add(z, div(x, z)))
            z := shr(1, add(z, div(x, z)))
            z := shr(1, add(z, div(x, z)))
            z := sub(z, lt(div(x, z), z))
        }
    }
}
