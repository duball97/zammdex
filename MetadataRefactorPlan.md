# Metadata Retrieval Refactoring Plan

## Current Issues

Our current approach to fetching metadata and pool information has several inefficiencies:

1. **Multiple Separate Blockchain Calls**: 
   - Each token requires 3 separate calls (name, symbol, tokenURI)
   - Additional call to fetch pool reserves
   - These multiple RPC calls increase loading time and potential for failures

2. **IPFS Gateway Reliability Issues**:
   - Unstable IPFS gateway connections
   - Different gateways used in different components

3. **No Centralized Caching**:
   - Duplicate requests for the same data across components
   - Inefficient memory usage

4. **Error Handling Inconsistencies**:
   - Different approaches to error handling in different components
   - Leads to UI inconsistency and potential crashes

## Solution: Leveraging CoinsMetadataHelper

The deployed `CoinsMetadataHelper` contract (0x10471CA11076f446F9f77DbA164fe810902d0Fd4) provides a unified interface to fetch all necessary data in a single call:

- Token metadata (tokenURI)
- Pool reserves (ETH and token reserves)
- Pool liquidity
- Pool ID

## Implementation Plan

### 1. Create New Hooks

#### A. Global Data Cache Hook

```typescript
// hooks/use-global-coins-data.ts
import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { publicClient } from '@/lib/client';
import { mainnet } from 'viem/chains';
import { CoinsMetadataHelperAbi, CoinsMetadataHelperAddress } from '@/constants/CoinsMetadataHelper';

export type CoinData = {
  coinId: bigint;
  tokenURI: string;
  reserve0: bigint; // ETH reserve
  reserve1: bigint; // Coin reserve
  poolId: bigint;
  liquidity: bigint;
  // Derived data
  name: string | null;
  symbol: string | null;
  metadata: any | null;
  imageUrl: string | null;
};

export function useGlobalCoinsData() {
  // Fetch all coins data in a single call
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['all-coins-data'],
    queryFn: async () => {
      const data = await publicClient.readContract({
        address: CoinsMetadataHelperAddress,
        abi: CoinsMetadataHelperAbi,
        functionName: 'getAllCoinsData',
        chainId: mainnet.id,
      });
      
      // Initial processing of raw blockchain data
      return parseCoinsData(data);
    },
    staleTime: 5 * 60 * 1000, // 5 minutes - we can adjust based on usage patterns
    gcTime: 30 * 60 * 1000,   // 30 minutes
  });
  
  // Function to parse token URIs and metadata in the background
  const enrichCoinsData = useCallback(async (coinsData: CoinData[]) => {
    // Process in batches to avoid overwhelming the browser
    const batchSize = 5;
    for (let i = 0; i < coinsData.length; i += batchSize) {
      const batch = coinsData.slice(i, i + batchSize);
      await Promise.all(batch.map(async (coin) => {
        // Parse name and symbol from token URI if possible
        // Fetch and cache metadata
        await fetchAndEnrichCoin(coin);
      }));
    }
  }, []);
  
  // Start enrichment process in the background if we have data
  useEffect(() => {
    if (data && data.length > 0) {
      enrichCoinsData(data);
    }
  }, [data, enrichCoinsData]);
  
  // Provide functions to access specific coins by ID
  const getCoinById = useCallback((id: bigint): CoinData | undefined => {
    return data?.find(coin => coin.coinId === id);
  }, [data]);
  
  // Return both the full dataset and helper functions
  return {
    allCoins: data || [],
    isLoading,
    error,
    refetch,
    getCoinById,
  };
}

// Helper functions
function parseCoinsData(rawData: any[]): CoinData[] {
  return rawData.map(item => ({
    coinId: item.coinId,
    tokenURI: item.tokenURI,
    reserve0: item.reserve0,
    reserve1: item.reserve1,
    poolId: item.poolId,
    liquidity: item.liquidity,
    name: null, // Will be populated later
    symbol: null, // Will be populated later
    metadata: null, // Will be populated later
    imageUrl: null, // Will be populated later
  }));
}

async function fetchAndEnrichCoin(coin: CoinData) {
  try {
    // Try to fetch metadata if it's an IPFS or HTTP URI
    if (coin.tokenURI && (coin.tokenURI.startsWith('ipfs://') || coin.tokenURI.startsWith('http'))) {
      const uri = coin.tokenURI.startsWith('ipfs://') 
        ? `https://content.wrappr.wtf/ipfs/${coin.tokenURI.slice(7)}`
        : coin.tokenURI;
        
      const response = await fetch(uri);
      if (response.ok) {
        const metadata = await response.json();
        coin.metadata = metadata;
        
        // Extract name and symbol if available
        if (metadata.name) coin.name = metadata.name;
        if (metadata.symbol) coin.symbol = metadata.symbol;
        
        // Handle image URL
        if (metadata.image) {
          coin.imageUrl = metadata.image.startsWith('ipfs://') 
            ? `https://content.wrappr.wtf/ipfs/${metadata.image.slice(7)}`
            : metadata.image;
        }
      }
    }
  } catch (error) {
    console.error(`Error enriching coin ${coin.coinId.toString()}:`, error);
    // No state updates on error - we keep what we have
  }
}
```

#### B. Individual Coin Hook

```typescript
// hooks/use-coin-data.ts
import { useMemo } from 'react';
import { useGlobalCoinsData, CoinData } from './use-global-coins-data';

export function useCoinData(coinId: bigint) {
  const { allCoins, isLoading, error, getCoinById } = useGlobalCoinsData();
  
  // Get the specific coin data
  const coinData = useMemo(() => {
    return getCoinById(coinId);
  }, [getCoinById, coinId]);
  
  // Calculate derived values
  const priceInEth = useMemo(() => {
    if (
      !coinData ||
      !coinData.reserve0 ||
      !coinData.reserve1 ||
      coinData.reserve0 === 0n ||
      coinData.reserve1 === 0n
    ) {
      return null;
    }
    
    // Price = reserve0 (ETH) / reserve1 (token)
    return coinData.reserve0 / coinData.reserve1;
  }, [coinData]);
  
  return {
    coinData,
    isLoading: isLoading || !coinData,
    error,
    priceInEth,
  };
}
```

#### C. Paged Coins Hook for Explorer

```typescript
// hooks/use-paged-coins.ts
import { useState, useEffect, useMemo } from 'react';
import { useGlobalCoinsData } from './use-global-coins-data';

export function usePagedCoins(pageSize: number = 20) {
  const [page, setPage] = useState(0);
  const { allCoins, isLoading, error } = useGlobalCoinsData();
  
  // Calculate total pages
  const totalPages = useMemo(() => {
    return Math.ceil((allCoins?.length || 0) / pageSize);
  }, [allCoins, pageSize]);
  
  // Get current page items
  const pageItems = useMemo(() => {
    if (!allCoins) return [];
    const start = page * pageSize;
    const end = Math.min(start + pageSize, allCoins.length);
    return allCoins.slice(start, end);
  }, [allCoins, page, pageSize]);
  
  // Ensure valid page
  useEffect(() => {
    if (page >= totalPages && totalPages > 0) {
      setPage(totalPages - 1);
    }
  }, [page, totalPages]);
  
  return {
    coins: pageItems,
    total: allCoins?.length || 0,
    page,
    totalPages,
    setPage,
    isLoading,
    error,
    hasNextPage: page < totalPages - 1,
    hasPreviousPage: page > 0,
    goToNextPage: () => setPage(p => Math.min(p + 1, totalPages - 1)),
    goToPreviousPage: () => setPage(p => Math.max(p - 1, 0)),
  };
}
```

### 2. Add Constants for CoinsMetadataHelper

```typescript
// constants/CoinsMetadataHelper.ts
export const CoinsMetadataHelperAddress = '0x10471CA11076f446F9f77DbA164fe810902d0Fd4';
export const CoinsMetadataHelperAbi = [
  {
    inputs: [],
    name: 'getAllCoinsData',
    outputs: [
      {
        components: [
          { name: 'coinId', type: 'uint256' },
          { name: 'tokenURI', type: 'string' },
          { name: 'reserve0', type: 'uint112' },
          { name: 'reserve1', type: 'uint112' },
          { name: 'poolId', type: 'uint256' },
          { name: 'liquidity', type: 'uint256' }
        ],
        internalType: 'struct CoinsMetadataHelper.CoinData[]',
        name: '',
        type: 'tuple[]'
      }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  // Add other functions as needed (getCoinData, getLatestCoins, etc.)
] as const;
```

### 3. Update Component Integration

#### A. Refactor ExplorerGrid Component

```typescript
// ExplorerGrid.tsx
import { usePagedCoins } from '@/hooks/use-paged-coins';
import { PAGE_SIZE } from '@/constants';

export const ExplorerGrid = () => {
  const { 
    coins, 
    total, 
    page, 
    totalPages, 
    hasNextPage, 
    hasPreviousPage, 
    goToNextPage, 
    goToPreviousPage, 
    isLoading 
  } = usePagedCoins(PAGE_SIZE);
  
  // ... rest of component
  
  return (
    <div>
      {/* Use coins array for rendering */}
      {coins.map(coin => (
        <CoinCard 
          key={coin.coinId.toString()} 
          coin={coin} 
          onTrade={() => handleTrade(coin.coinId)} 
        />
      ))}
      
      {/* Pagination controls */}
      <div>
        <button onClick={goToPreviousPage} disabled={!hasPreviousPage || isLoading}>
          Previous
        </button>
        <span>
          Page {page + 1} of {totalPages}
        </span>
        <button onClick={goToNextPage} disabled={!hasNextPage || isLoading}>
          Next
        </button>
      </div>
    </div>
  );
};
```

#### B. Update CoinCard Component

```typescript
// Updated CoinCard
import { type CoinData } from '@/hooks/use-global-coins-data';

export const CoinCard = ({
  coin,
  onTrade,
}: {
  coin: CoinData;
  onTrade: () => void;
}) => {
  // Generate a color based on coin ID for fallback
  const bgColor = getColorForId(coin.coinId);
  
  // Handle fallback for name/symbol
  const displayName = coin.name || `Token ${coin.coinId.toString()}`;
  const displaySymbol = coin.symbol || 'TKN';
  
  return (
    <Card>
      <CardContent>
        <h3>{displayName} [{displaySymbol}]</h3>
        
        {/* Image with fallback */}
        <div className="w-16 h-16">
          {coin.imageUrl ? (
            <img 
              src={coin.imageUrl} 
              alt={displaySymbol}
              className="w-full h-full rounded-full object-cover"
              onError={() => renderFallback()}
            />
          ) : (
            <div className={`w-full h-full flex ${bgColor} text-white justify-center items-center rounded-full`}>
              {displaySymbol.slice(0, 3)}
            </div>
          )}
        </div>
        
        <button onClick={onTrade}>Trade</button>
      </CardContent>
    </Card>
  );
};
```

#### C. Update BuySell Component

```typescript
// BuySell.tsx
import { useCoinData } from '@/hooks/use-coin-data';
import { formatEther, formatUnits, parseEther, parseUnits } from 'viem';
import { SWAP_FEE, SLIPPAGE_BPS, DEADLINE_SEC } from '@/constants';

export const BuySell = ({ coinId }: { coinId: bigint }) => {
  const { coinData, isLoading } = useCoinData(coinId);
  const [tab, setTab] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('');
  
  // Rest of BuySell logic remains similar, but simplified since we already have reserves
  
  // Calculate the estimate from reserves directly
  const estimated = useMemo(() => {
    if (!coinData || !coinData.reserve0 || !coinData.reserve1) return '0';
    
    try {
      if (tab === 'buy') {
        const inWei = parseEther(amount || '0');
        const rawOut = getAmountOut(
          inWei,
          coinData.reserve0,
          coinData.reserve1,
          SWAP_FEE
        );
        const minOut = withSlippage(rawOut);
        return formatUnits(minOut, 18);
      } else {
        const inUnits = parseUnits(amount || '0', 18);
        const rawOut = getAmountOut(
          inUnits,
          coinData.reserve1,
          coinData.reserve0,
          SWAP_FEE
        );
        const minOut = withSlippage(rawOut);
        return formatEther(minOut);
      }
    } catch {
      return '0';
    }
  }, [amount, coinData, tab]);
  
  // Display name/symbol/metadata from coin data
  const displayName = coinData?.name || `Token ${coinId.toString()}`;
  const displaySymbol = coinData?.symbol || 'TKN';
  const description = coinData?.metadata?.description || 'No description available';
  
  // Market cap calculation can now use the reserves directly
  const marketCapEth = useMemo(() => {
    if (!coinData || !coinData.reserve0 || !coinData.reserve1) return null;
    
    const pricePerTokenEth = Number(formatEther(coinData.reserve0)) / Number(formatUnits(coinData.reserve1, 18));
    const FIXED_SUPPLY = 21_000_000;
    return pricePerTokenEth * FIXED_SUPPLY;
  }, [coinData]);
  
  // ... rest of component (UI, transaction handlers, etc.)
};
```

### 4. Implement Fallback Mechanisms

To ensure reliability even if the metadata helper contract call fails:

1. **Cache Layer**:
   - Add persistent caching using localStorage to store the last successful fetch
   - Implement a mechanism to merge fresh data with cached data
   
2. **Direct Contract Fallback**:
   - If the metadata helper fails, fall back to individual contract calls
   - Gradually rebuild the cache with individual calls

```typescript
// Example cache implementation in use-global-coins-data.ts

// Try to load from cache first
const loadFromCache = () => {
  try {
    const cached = localStorage.getItem('coins-metadata-cache');
    if (cached) {
      return JSON.parse(cached, (key, value) => {
        if (typeof value === 'string' && /^\d+n$/.test(value)) {
          return BigInt(value.slice(0, -1));
        }
        return value;
      });
    }
  } catch (e) {
    console.error('Failed to load from cache:', e);
  }
  return null;
};

// Save to cache
const saveToCache = (data: CoinData[]) => {
  try {
    localStorage.setItem(
      'coins-metadata-cache',
      JSON.stringify(data, (key, value) => {
        if (typeof value === 'bigint') {
          return value.toString() + 'n';
        }
        return value;
      })
    );
  } catch (e) {
    console.error('Failed to save to cache:', e);
  }
};
```

### 5. Performance Optimizations

1. **Lazy Loading**:
   - Initially, only fetch the minimal data needed for the current view
   - Load full metadata on demand when a token is selected
   
2. **Pagination Handling**:
   - Implement pagination in the UI but use the full dataset in memory
   - This avoids multiple blockchain calls while still providing a responsive UI

3. **Background Processing**:
   - Process metadata and image URLs in background tasks
   - Use the web worker API for parsing and processing tasks

## Implementation Strategy

1. **Phase 1: Core Infrastructure**
   - Implement the CoinsMetadataHelper constants
   - Create the global data cache hook
   - Add basic caching mechanisms
   
2. **Phase 2: Component Integration**
   - Update ExplorerGrid to use the new hook
   - Test pagination and rendering performance
   
3. **Phase 3: Enhanced Features**
   - Add the individual coin data hook
   - Update BuySell and TradeView components
   
4. **Phase 4: Optimization and Finalization**
   - Add fallback mechanisms
   - Implement background processing
   - Fine-tune caching strategies

## Benefits

1. **Reduced Network Requests**:
   - Single blockchain call instead of multiple calls per coin
   - Lower risk of rate limiting or RPC failures
   
2. **Improved Performance**:
   - Faster initial load time
   - Better caching reduces redundant fetches
   
3. **Enhanced Reliability**:
   - Central error handling
   - Robust fallback mechanisms
   
4. **Better User Experience**:
   - Consistent loading indicators
   - Smoother pagination
   - More predictable behavior

## Testing Plan

1. **Unit Tests**:
   - Test the data parsing logic
   - Validate caching mechanisms
   
2. **Integration Tests**:
   - Verify component integrations
   - Test fallback scenarios
   
3. **Performance Testing**:
   - Measure load times with various dataset sizes
   - Test pagination performance

4. **Error Handling Tests**:
   - Simulate network failures
   - Test contract call errors