# Coin-to-Coin Swap via Multicall

This implementation adds support for direct Coin-to-Coin swaps in the SwapTile component by leveraging the ZAMM contract's multicall functionality to execute a series of operations in a single transaction.

## How It Works

The multicall implementation performs the following steps in a single transaction:

1. **First Swap**: Converts the source coin to ETH, consuming the entire input amount
2. **Second Swap**: Converts the ETH from the first swap to the target coin using the estimated ETH amount
3. **Recovery Source Coin**: Recovers any unused source coins (unlikely since we use all in first swap)
4. **Recovery ETH**: Recovers any leftover ETH from the intermediate step
5. **Recovery Target Coin**: Recovers any excess target coins that might be in the contract

## Benefits

- **Gas Efficiency**: Executes multiple operations in a single transaction
- **UX Improvement**: Users can swap directly between coins without manual intermediate steps
- **Safety**: Ensures all unused transient balances (both source coins and ETH) are recovered to the user

## Implementation Details

### Helper Module: `swapHelper.ts`

The `swapHelper.ts` module contains functions to:

1. Create encoded function calls for the multicall with proper ETH amount estimation for the second swap
2. Estimate output amounts for coin-to-coin swaps including the intermediate ETH amount
3. Compute pool keys and IDs
4. Calculate swap amounts with fees and appropriate slippage

### Key Technical Implementation Points

1. **ETH Amount Estimation**: 
   - The expected ETH output from the first swap is calculated with a safety margin
   - This exact ETH amount is specified in the second swap call to ensure predictable results

2. **Recovery Operations**:
   - Transient balances of both the source coin and ETH are recovered
   - This ensures no tokens are left stranded in the contract

3. **Slippage Handling**:
   - Two slippage controls are applied:
     1. Intermediate ETH output has a safety margin 
     2. Final coin output has standard slippage protection

### SwapTile Integration

The SwapTile component has been enhanced to:

1. Support both Coin→ETH and Coin→Coin swaps
2. Dynamically estimate output amounts for all swap types
3. Fetch reserves for both source and target pools
4. Display a "Multi-hop" badge with appropriate fee information for coin-to-coin swaps
5. Show detailed debug information in the console for easier debugging

## Technical Notes

- Uses the ZAAM contract's `multicall` function to batch operations
- Uses `swapExactIn` for both swaps in the batch
- For the second swap, specifies the exact ETH amount to use from the first swap
- Uses the ZAMM contract's `recoverTransientBalance` function twice to handle any leftover tokens

## Usage Flow

1. User selects a source coin that is not ETH
2. User selects a target coin that is not ETH
3. UI automatically detects a coin-to-coin swap and shows the "Multi-hop" indicator
4. User enters an amount to swap
5. UI calculates the expected output through both swaps with proper slippage handling
6. When executing, a single transaction is created with all necessary operations including recovery of leftovers