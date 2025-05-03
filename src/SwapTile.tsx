import { mainnet } from "viem/chains";
import { useState, useEffect } from "react";
import {
  useWriteContract,
  useWaitForTransactionReceipt,
  useAccount,
  usePublicClient,
  useChainId,
  useBalance,
} from "wagmi";
import { handleWalletError, isUserRejectionError } from "./utils";
import {
  parseEther,
  parseUnits,
  formatEther,
  formatUnits,
  keccak256,
  zeroAddress,
  encodeAbiParameters,
  parseAbiParameters,
} from "viem";
import { CoinsAbi, CoinsAddress } from "./constants/Coins";
import { ZAAMAbi, ZAAMAddress } from "./constants/ZAAM";
import { ZAMMHelperAbi, ZAMMHelperAddress } from "./constants/ZAMMHelper";
import { CoinchanAbi, CoinchanAddress } from "./constants/Coinchan";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, ArrowDownUp, Plus, Minus } from "lucide-react";

/* ────────────────────────────────────────────────────────────────────────────
  CONSTANTS & HELPERS
──────────────────────────────────────────────────────────────────────────── */
const SWAP_FEE = 100n; // 1% pool fee
const SLIPPAGE_BPS = 100n; // 1% slippage tolerance
const DEADLINE_SEC = 20 * 60; // 20 minutes

const withSlippage = (amount: bigint) =>
  (amount * (10000n - SLIPPAGE_BPS)) / 10000n;

export interface TokenMeta {
  id: bigint | null; // null = ETH pseudo-token
  name: string;
  symbol: string;
  tokenUri?: string; // Added tokenUri field to display thumbnails
  reserve0?: bigint; // ETH reserves in the pool
  reserve1?: bigint; // Token reserves in the pool
  balance?: bigint; // User's balance of this token
}

// Inline SVG for ETH
const ETH_SVG = `<svg fill="#000000" width="800px" height="800px" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
<g fill-rule="evenodd">
<path d="M16 32C7.163 32 0 24.837 0 16S7.163 0 16 0s16 7.163 16 16-7.163 16-16 16zm7.994-15.781L16.498 4 9 16.22l7.498 4.353 7.496-4.354zM24 17.616l-7.502 4.351L9 17.617l7.498 10.378L24 17.616z"/>
<g fill-rule="nonzero">
<path fill-opacity=".298" d="M16.498 4v8.87l7.497 3.35zm0 17.968v6.027L24 17.616z"/>
<path fill-opacity=".801" d="M16.498 20.573l7.497-4.353-7.497-3.348z"/>
<path fill-opacity=".298" d="M9 16.22l7.498 4.353v-7.701z"/>
</g>
</g>
</svg>`;

const ETH_TOKEN: TokenMeta = {
  id: null,
  name: "Ether",
  symbol: "ETH",
  tokenUri: `data:image/svg+xml;base64,${btoa(ETH_SVG)}`, // Embed ETH SVG as data URI
  reserve0: BigInt(Number.MAX_SAFE_INTEGER), // Ensure ETH is always at the top (special case)
  balance: 0n, // Will be updated with actual balance in useAllTokens hook
};

const computePoolKey = (coinId: bigint) => ({
  id0: 0n,
  id1: coinId,
  token0: zeroAddress,
  token1: CoinsAddress,
  swapFee: SWAP_FEE,
});

const computePoolId = (coinId: bigint) =>
  BigInt(keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "uint256 id0, uint256 id1, address token0, address token1, uint96 swapFee",
      ),
      [0n, coinId, zeroAddress, CoinsAddress, SWAP_FEE],
    ),
  ));

// x*y=k AMM with fee — forward (amountIn → amountOut)
const getAmountOut = (
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  swapFee: bigint,
) => {
  if (amountIn === 0n || reserveIn === 0n || reserveOut === 0n) return 0n;
  
  const amountInWithFee = amountIn * (10000n - swapFee);
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * 10000n + amountInWithFee;
  return numerator / denominator;
};

// inverse — desired amountOut → required amountIn
const getAmountIn = (
  amountOut: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  swapFee: bigint,
) => {
  if (amountOut === 0n || reserveIn === 0n || reserveOut === 0n || amountOut >= reserveOut) 
    return 0n;
    
  const numerator = reserveIn * amountOut * 10000n;
  const denominator = (reserveOut - amountOut) * (10000n - swapFee);
  return numerator / denominator + 1n; // +1 for ceiling rounding
};

/* ────────────────────────────────────────────────────────────────────────────
  HOOK: Simplified approach to fetch all tokens with tokenUri and balances
──────────────────────────────────────────────────────────────────────────── */

const useAllTokens = () => {
  const publicClient = usePublicClient({ chainId: mainnet.id }); // Always use mainnet
  const { address } = useAccount();
  const [tokens, setTokens] = useState<TokenMeta[]>([ETH_TOKEN]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Get ETH balance using wagmi hook with optimized settings
  const { data: ethBalance, isSuccess: ethBalanceSuccess, refetch: refetchEthBalance } = useBalance({
    address,
    chainId: mainnet.id,
    scopeKey: 'ethBalance', // Unique key for this balance query
  });
  
  // Refetch ETH balance when component mounts and when the chain changes
  useEffect(() => {
    if (address) {
      console.log("Manually triggering ETH balance refetch");
      refetchEthBalance();
    }
  }, [address, refetchEthBalance]);
  
  // Log ETH balance status for debugging
  useEffect(() => {
    console.log('ETH Balance Status:', { 
      hasAddress: !!address, 
      ethBalance: ethBalance ? formatEther(ethBalance.value) : 'undefined',
      isSuccess: ethBalanceSuccess
    });
  }, [address, ethBalance, ethBalanceSuccess]);

  // Update ETH balance in our token list when it changes
  useEffect(() => {
    if (ethBalance) {
      console.log(`ETH Balance available: ${formatEther(ethBalance.value)} ETH`);
      
      // Create a new ETH token object with the balance
      const ethTokenWithBalance = {
        ...ETH_TOKEN,
        balance: ethBalance.value
      };
      
      // Update the tokens array, replacing the ETH token
      setTokens(prevTokens => {
        // If we only have the ETH token, just update it
        if (prevTokens.length === 1 && prevTokens[0].id === null) {
          return [ethTokenWithBalance];
        }
        
        // Otherwise, replace the ETH token while keeping the other tokens
        return [
          ethTokenWithBalance,
          ...prevTokens.filter(token => token.id !== null)
        ];
      });
    }
  }, [ethBalance]);

  useEffect(() => {
    const fetchTokens = async () => {
      if (!publicClient) {
        setError("No wallet connection available");
        setLoading(false);
        return;
      }

      try {
        // Step 1: Get total coins count
        console.log("Fetching coin count...");
        const countResult = await publicClient.readContract({
          address: CoinchanAddress,
          abi: CoinchanAbi,
          functionName: "getCoinsCount",
        });
        const count = Number(countResult);
        console.log(`Contract reports ${count} total coins`);

        // Step 2: Get all coins directly using indices instead of getCoins
        const coinPromises = [];
        const displayLimit = Math.min(count, 100); // Limit to first 100 for safety

        for (let i = 0; i < displayLimit; i++) {
          coinPromises.push(
            publicClient.readContract({
              address: CoinchanAddress,
              abi: CoinchanAbi,
              functionName: "coins", // Direct array access - faster and more reliable
              args: [BigInt(i)],
            })
          );
        }

        console.log(`Fetching ${coinPromises.length} individual coins...`);
        const coinResults = await Promise.allSettled(coinPromises);
        const coinIds: bigint[] = [];

        for (let i = 0; i < coinResults.length; i++) {
          const result = coinResults[i];
          if (result.status === "fulfilled") {
            coinIds.push(result.value as bigint);
          } else {
            console.error(`Failed to fetch coin at index ${i}:`, result.reason);
          }
        }

        console.log(`Successfully retrieved ${coinIds.length} coin IDs`);

        if (coinIds.length === 0) {
          console.log("No coins found, using ETH only");
          setTokens([ETH_TOKEN]);
          setLoading(false);
          return;
        }

        // Step 3: Get metadata, reserves, and balances for each coin
        const tokenPromises = coinIds.map(async (id) => {
          try {
            // Fetch metadata
            const [symbolResult, nameResult, tokenUriResult] = await Promise.allSettled([
              publicClient.readContract({
                address: CoinsAddress,
                abi: CoinsAbi,
                functionName: "symbol",
                args: [id],
              }),
              publicClient.readContract({
                address: CoinsAddress,
                abi: CoinsAbi,
                functionName: "name",
                args: [id],
              }),
              publicClient.readContract({
                address: CoinsAddress,
                abi: CoinsAbi,
                functionName: "tokenURI",
                args: [id],
              }),
            ]);

            const symbol = symbolResult.status === "fulfilled" 
              ? symbolResult.value as string 
              : `C#${id.toString()}`;
              
            const name = nameResult.status === "fulfilled" 
              ? nameResult.value as string 
              : `Coin #${id.toString()}`;
              
            const tokenUri = tokenUriResult.status === "fulfilled"
              ? tokenUriResult.value as string
              : "";

            // Fetch reserves for this token
            let reserve0: bigint = 0n;
            let reserve1: bigint = 0n;
            
            try {
              const poolId = computePoolId(id);
              console.log(`Fetching reserves for coin ${id}, poolId: ${poolId}`);
              
              const poolResult = await publicClient.readContract({
                address: ZAAMAddress,
                abi: ZAAMAbi,
                functionName: "pools",
                args: [poolId],
              });
              
              // Cast to unknown first, then extract the reserves from the array
              const poolData = poolResult as unknown as readonly bigint[];
              
              // Ensure we have valid data before assigning
              if (poolData && poolData.length >= 2) {
                reserve0 = poolData[0]; // ETH reserve
                reserve1 = poolData[1]; // Token reserve
                console.log(`Coin ${id} (${symbol}): ETH reserve = ${formatEther(reserve0)} ETH`);
              } else {
                console.warn(`Invalid pool data for coin ${id}: ${JSON.stringify(poolData)}`);
              }
            } catch (err) {
              console.error(`Failed to fetch reserves for coin ${id}:`, err);
              // Keep reserves as 0n if we couldn't fetch them
            }
            
            // Fetch user's balance if address is connected
            let balance: bigint = 0n;
            if (address) {
              try {
                const balanceResult = await publicClient.readContract({
                  address: CoinsAddress,
                  abi: CoinsAbi,
                  functionName: "balanceOf",
                  args: [address, id],
                });
                
                balance = balanceResult as bigint;
                console.log(`User balance for coin ${id} (${symbol}): ${formatUnits(balance, 18)}`);
              } catch (err) {
                console.error(`Failed to fetch balance for coin ${id}:`, err);
                // Keep balance as 0n if we couldn't fetch it
              }
            }

            return { id, symbol, name, tokenUri, reserve0, reserve1, balance } as TokenMeta;
          } catch (err) {
            console.error(`Failed to get metadata for coin ${id}:`, err);
            return { 
              id, 
              symbol: `C#${id.toString()}`, 
              name: `Coin #${id.toString()}`,
              tokenUri: "",
              reserve0: 0n, 
              reserve1: 0n,
              balance: 0n
            } as TokenMeta;
          }
        });

        console.log("Fetching token metadata, reserves, and balances...");
        const tokenResults = await Promise.all(tokenPromises);
        
        // Filter out any tokens with fetch errors
        const validTokens = tokenResults.filter(token => token && token.id);
        
        // Sort tokens by ETH reserves (reserve0), from highest to lowest
        const sortedTokens = [...validTokens].sort((a, b) => {
          // Default to 0n if reserve0 is undefined
          const reserveA = a.reserve0 || 0n;
          const reserveB = b.reserve0 || 0n;
          
          // For bigint comparison, subtract b from a and convert to number
          // Negative means b > a, positive means a > b
          // We want descending order (highest first), so we return positive when b > a
          return reserveB > reserveA ? 1 : reserveB < reserveA ? -1 : 0;
        });
        
        // Log the sorted tokens to debug
        console.log("Sorted tokens (by ETH reserves):", 
          sortedTokens.map(t => ({
            symbol: t.symbol,
            id: t.id?.toString(),
            ethReserve: t.reserve0?.toString(),
            userBalance: t.balance?.toString()
          }))
        );
        
        // Get the updated ETH token with balance from current state or use ethBalance directly
        const currentEthToken = tokens.find(token => token.id === null) || ETH_TOKEN;
        
        // Create a new ETH token with balance preserved - ALWAYS prioritize the latest ethBalance
        const ethTokenWithBalance = {
          ...currentEthToken,
          // If we have ethBalance, ALWAYS use it as the most up-to-date value
          balance: ethBalance?.value !== undefined ? ethBalance.value : currentEthToken.balance,
          // Add formatted balance for debugging
          formattedBalance: ethBalance?.formatted || 
            (currentEthToken.balance ? formatEther(currentEthToken.balance) : '0')
        };
        
        // Debug the ETH balance with more detailed logging
        if (ethBalance?.value !== undefined) {
          console.log(`Fresh ETH Balance from wagmi: ${formatEther(ethBalance.value)} ETH (${ethBalance.formatted})`);
          console.log(`Previous ETH Balance: ${currentEthToken.balance ? formatEther(currentEthToken.balance) : '0'} ETH`);
          
          // Log if there's a discrepancy
          if (currentEthToken.balance !== ethBalance.value) {
            console.log(`ETH Balance updated: ${currentEthToken.balance ? formatEther(currentEthToken.balance) : '0'} -> ${formatEther(ethBalance.value)}`);
          }
        }
        
        console.log(`Setting ETH token with balance: ${ethTokenWithBalance.formattedBalance} ETH`);
        
        // ETH is always first
        const allTokens = [ethTokenWithBalance, ...sortedTokens];
        
        console.log(`Final token list has ${allTokens.length} tokens, sorted by ETH reserves`);
        setTokens(allTokens);
      } catch (err) {
        console.error("Error fetching tokens:", err);
        setError("Failed to load tokens");
      } finally {
        setLoading(false);
      }
    };

    fetchTokens();
  }, [publicClient, address]);

  return { tokens, loading, error };
};

/* ────────────────────────────────────────────────────────────────────────────
  ENHANCED TOKEN SELECTOR: With thumbnail display
──────────────────────────────────────────────────────────────────────────── */
const TokenSelector = ({
  selectedToken,
  tokens,
  onSelect,
}: {
  selectedToken: TokenMeta;
  tokens: TokenMeta[];
  onSelect: (token: TokenMeta) => void;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const selectedValue = selectedToken.id?.toString() ?? "eth";
  
  // Handle selection change
  const handleSelect = (token: TokenMeta) => {
    onSelect(token);
    setIsOpen(false);
  };
  
  // Helper functions for formatting and display
  
  // Format token balance for display
  const formatBalance = (token: TokenMeta) => {
    if (token.balance === undefined) return '';
    if (token.balance === 0n) return '0';
    
    try {
      // Convert balance to a number for display formatting
      const balanceValue = token.id === null 
        ? Number(formatEther(token.balance)) 
        : Number(formatUnits(token.balance, 18));
      
      // Format based on size
      if (balanceValue >= 1000) {
        return `${Math.floor(balanceValue).toLocaleString()}`;
      } else if (balanceValue >= 1) {
        return balanceValue.toFixed(3); // Show 3 decimals for values ≥ 1
      } else if (balanceValue >= 0.001) {
        return balanceValue.toFixed(4); // Show 4 decimals for smaller values
      } else if (balanceValue >= 0.0001) {
        return balanceValue.toFixed(6); // Show more precision for tiny values
      } else if (balanceValue > 0) {
        // For ETH (reserve asset), always show a readable value even for tiny amounts
        if (token.id === null) {
          // For extremely small ETH amounts (< 0.0001), show with 8 decimals max
          return balanceValue.toFixed(8);
        }
        // For non-ETH tokens, use scientific notation for extremely small amounts
        return balanceValue.toExponential(2);
      }
      return '0';
    } catch (error) {
      console.error('Error formatting balance:', error);
      return '0';
    }
  };
  
  // Get initials for fallback display
  const getInitials = (symbol: string) => {
    return symbol.slice(0, 2).toUpperCase();
  };
  
  // Color map for token initials - matching your screenshot
  const getColorForSymbol = (symbol: string) => {
    const symbolKey = symbol.toLowerCase();
    const colorMap: Record<string, { bg: string, text: string }> = {
      'eth': { bg: 'bg-black', text: 'text-white' },
      'za': { bg: 'bg-red-500', text: 'text-white' },
      'pe': { bg: 'bg-green-700', text: 'text-white' },
      'ro': { bg: 'bg-red-700', text: 'text-white' },
      '..': { bg: 'bg-gray-800', text: 'text-white' },
    };
    
    const initials = symbolKey.slice(0, 2);
    return colorMap[initials] || { bg: 'bg-yellow-500', text: 'text-white' };
  };
  
  // Custom token image display with JSON metadata handling
  const TokenImage = ({ token }: { token: TokenMeta }) => {
    const [imageLoaded, setImageLoaded] = useState(false);
    const [imageError, setImageError] = useState(false);
    const [actualImageUrl, setActualImageUrl] = useState<string | null>(null);
    const { bg, text } = getColorForSymbol(token.symbol);
    
    // Try to fetch JSON metadata if the token URI might be a metadata URI
    useEffect(() => {
      const fetchMetadata = async () => {
        if (!token.tokenUri) return;
        
        // Skip for data URIs like the ETH SVG
        if (token.tokenUri.startsWith('data:')) {
          setActualImageUrl(token.tokenUri);
          return;
        }
        
        try {
          // Handle IPFS URIs
          const uri = token.tokenUri.startsWith('ipfs://') 
            ? `https://content.wrappr.wtf/ipfs/${token.tokenUri.slice(7)}` 
            : token.tokenUri;
            
          // Try to fetch as JSON (might be metadata)
          const response = await fetch(uri);
          const contentType = response.headers.get('content-type');
          
          // If it's JSON, try to extract image URL
          if (contentType && contentType.includes('application/json')) {
            const data = await response.json();
            if (data && data.image) {
              // Handle IPFS image URL
              const imageUrl = data.image.startsWith('ipfs://') 
                ? `https://content.wrappr.wtf/ipfs/${data.image.slice(7)}` 
                : data.image;
                
              setActualImageUrl(imageUrl);
              return;
            }
          }
          
          // If not valid JSON or no image field, use the URI directly
          setActualImageUrl(uri);
        } catch (err) {
          console.error(`Error fetching metadata for ${token.symbol}:`, err);
          setImageError(true);
        }
      };
      
      fetchMetadata();
    }, [token.tokenUri, token.symbol]);
    
    // If token has no URI, show colored initial
    if (!token.tokenUri) {
      return (
        <div className={`w-8 h-8 flex ${bg} ${text} justify-center items-center rounded-full text-xs font-medium`}>
          {getInitials(token.symbol)}
        </div>
      );
    }
    
    // Show loading placeholder if we don't have the actual image URL yet
    if (!actualImageUrl && !imageError) {
      return (
        <div className="relative w-8 h-8 rounded-full overflow-hidden">
          <div className="w-8 h-8 flex bg-gray-200 justify-center items-center rounded-full">
            <img 
              src="/coinchan-logo.png" 
              alt="Loading" 
              className="w-6 h-6 object-contain opacity-50"
            />
          </div>
        </div>
      );
    }
    
    // Otherwise, try to load the token image
    return (
      <div className="relative w-8 h-8 rounded-full overflow-hidden">
        {/* Show colored initials while loading or on error */}
        {(!imageLoaded || imageError) && (
          <div className={`absolute inset-0 w-8 h-8 flex ${bg} ${text} justify-center items-center rounded-full text-xs font-medium`}>
            {getInitials(token.symbol)}
          </div>
        )}
        
        {/* Actual token image */}
        {actualImageUrl && !imageError && (
          <img
            src={actualImageUrl}
            alt={`${token.symbol} logo`}
            className={`w-8 h-8 object-cover rounded-full ${imageLoaded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-200`}
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageError(true)}
          />
        )}
      </div>
    );
  };
  
  return (
    <div className="relative">
      {/* Selected token display with thumbnail */}
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 cursor-pointer bg-transparent border border-yellow-200 rounded-md px-2 py-1 hover:bg-yellow-50"
      >
        <TokenImage token={selectedToken} />
        <div className="flex flex-col">
          <div className="flex items-center gap-1">
            <span className="font-medium">{selectedToken.symbol}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs font-medium text-gray-700">
              {selectedToken.balance !== undefined ? formatBalance(selectedToken) : ''}
            </span>
          </div>
        </div>
        <svg className="w-4 h-4 ml-1" viewBox="0 0 24 24" stroke="currentColor" fill="none">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
        </svg>
      </div>
      
      {/* Dropdown list with thumbnails */}
      {isOpen && (
        <div className="absolute z-20 mt-1 w-64 max-h-96 overflow-y-auto bg-white border border-yellow-200 shadow-lg rounded-md">
          {tokens.map((token) => {
            const isSelected = 
              (token.id === null && selectedValue === "eth") || 
              (token.id !== null && token.id.toString() === selectedValue);
            
            // Format reserves (if available) to show in the dropdown
            const formatReserves = (token: TokenMeta) => {
              if (token.id === null) return '';
              
              // If no reserves data available or zero reserves
              if (!token.reserve0 || token.reserve0 === 0n) return 'No liquidity';
              
              // Format ETH reserves to a readable format based on size
              const ethValue = Number(formatEther(token.reserve0));
              
              if (ethValue >= 1000) {
                return `${Math.floor(ethValue).toLocaleString()} ETH`;
              } else if (ethValue >= 1.0) {
                // For larger pools, show with 3 decimal places
                return `${ethValue.toFixed(3)} ETH`;
              } else if (ethValue >= 0.001) {
                // For medium pools, show with 4 decimal places
                return `${ethValue.toFixed(4)} ETH`;
              } else if (ethValue >= 0.0001) {
                // Show small amounts with more precision
                return `${ethValue.toFixed(6)} ETH`;
              } else if (ethValue > 0) {
                // For very small pools, show with 8 decimal places
                return `${ethValue.toFixed(8)} ETH`;
              } else {
                return 'No liquidity';
              }
            };
            
            const reserves = formatReserves(token);
            
            const balance = formatBalance(token);
            
            return (
              <div 
                key={token.id?.toString() ?? "eth"}
                onClick={() => handleSelect(token)}
                className={`flex items-center justify-between p-2 hover:bg-yellow-50 cursor-pointer ${
                  isSelected ? "bg-yellow-100" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <TokenImage token={token} />
                  <div className="flex flex-col">
                    <span className="font-medium">{token.symbol}</span>
                    {reserves && (
                      <span className="text-xs text-gray-500">{reserves}</span>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-sm font-medium">
                    {balance || ''}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

/* ────────────────────────────────────────────────────────────────────────────
  Mode types and constants
──────────────────────────────────────────────────────────────────────────── */
type TileMode = "swap" | "liquidity";
type LiquidityMode = "add" | "remove";

/* ────────────────────────────────────────────────────────────────────────────
  SwapTile main component
──────────────────────────────────────────────────────────────────────────── */
export const SwapTile = () => {
  const { tokens, loading, error: loadError } = useAllTokens();
  const [sellToken, setSellToken] = useState<TokenMeta>(ETH_TOKEN);
  const [buyToken, setBuyToken] = useState<TokenMeta | null>(null);
  const [mode, setMode] = useState<TileMode>("swap");
  const [liquidityMode, setLiquidityMode] = useState<LiquidityMode>("add");
  const [lpTokenBalance, setLpTokenBalance] = useState<bigint>(0n);
  const [lpBurnAmount, setLpBurnAmount] = useState<string>("");
  
  // Get wagmi hooks
  const { address, isConnected } = useAccount();
  
  // Get the public client for contract interactions
  const publicClient = usePublicClient({ chainId: mainnet.id });
  
  // Debug info
  const tokenCount = tokens.length;
  
  // Set initial buyToken once tokens are loaded
  useEffect(() => {
    if (!buyToken && tokens.length > 1) {
      console.log("Setting initial buyToken to:", tokens[1]);
      setBuyToken(tokens[1]);
    }
  }, [tokens, buyToken]);

  // Simple hook to keep ETH token state in sync
  useEffect(() => {
    if (tokens.length === 0) return;
    
    const updatedEthToken = tokens.find(token => token.id === null);
    if (!updatedEthToken) return;
    
    // Update sellToken if it's ETH
    if (sellToken.id === null) {
      setSellToken(updatedEthToken);
    }
    
    // Update buyToken if it's ETH
    if (buyToken && buyToken.id === null) {
      setBuyToken(updatedEthToken);
    }
  }, [tokens]);

  // Simple token selection handlers
  const handleSellTokenSelect = (token: TokenMeta) => {
    console.log("Sell token changed:", token);
    setSellToken(token);
  };
  
  const handleBuyTokenSelect = (token: TokenMeta) => {
    console.log("Buy token changed:", token);
    setBuyToken(token);
  };

  const flipTokens = () => {
    if (!buyToken) return;
    console.log("Flipping tokens:", { from: sellToken, to: buyToken });
    
    // Simple flip
    const tempToken = sellToken;
    setSellToken(buyToken);
    setBuyToken(tempToken);
  };

  /* derived flags */
  const canSwap = sellToken && buyToken && (
    // Original cases: ETH → Coin or Coin → ETH
    (sellToken.id === null || buyToken.id === null) ||
    // New case: Coin → Coin (different IDs)
    (sellToken.id !== null && buyToken?.id !== null && sellToken.id !== buyToken.id)
  );
  const isSellETH = sellToken.id === null;
  const isCoinToCoin = sellToken.id !== null && buyToken?.id !== null && buyToken?.id !== undefined && sellToken.id !== buyToken.id;
  const coinId = (isSellETH ? buyToken?.id : sellToken.id) ?? 0n;

  /* user inputs */
  const [sellAmt, setSellAmt] = useState("");
  const [buyAmt, setBuyAmt] = useState("");
  const [txHash, setTxHash] = useState<`0x${string}`>();
  const [txError, setTxError] = useState<string | null>(null);

  /* additional wagmi hooks */
  const { writeContractAsync, isPending, error: writeError } = useWriteContract();
  const { isSuccess } = useWaitForTransactionReceipt({ hash: txHash });
  const chainId = useChainId();
  
  /* Calculate pool reserves */
  const [reserves, setReserves] = useState<{ reserve0: bigint, reserve1: bigint } | null>(null);
  const [targetReserves, setTargetReserves] = useState<{ reserve0: bigint, reserve1: bigint } | null>(null);

  // Fetch reserves directly
  useEffect(() => {
    const fetchReserves = async () => {
      if (!coinId || coinId === 0n || !publicClient) return;
      
      try {
        const poolId = computePoolId(coinId);
        const result = await publicClient.readContract({
          address: ZAAMAddress,
          abi: ZAAMAbi,
          functionName: "pools",
          args: [poolId],
        });
        
        // Handle the returned data structure correctly
        // The contract might return more fields than just the reserves
        // Cast to unknown first, then extract the reserves from the array
        const poolData = result as unknown as readonly bigint[];
        
        setReserves({
          reserve0: poolData[0],
          reserve1: poolData[1]
        });
      } catch (err) {
        console.error("Failed to fetch reserves:", err);
        setReserves(null);
      }
    };
    
    fetchReserves();
  }, [coinId, publicClient]);
  
  // Fetch target reserves for coin-to-coin swaps
  useEffect(() => {
    const fetchTargetReserves = async () => {
      if (!isCoinToCoin || !buyToken?.id || buyToken.id === 0n || !publicClient) return;
      
      try {
        const targetPoolId = computePoolId(buyToken.id);
        const result = await publicClient.readContract({
          address: ZAAMAddress,
          abi: ZAAMAbi,
          functionName: "pools",
          args: [targetPoolId],
        });
        
        const poolData = result as unknown as readonly bigint[];
        
        setTargetReserves({
          reserve0: poolData[0],
          reserve1: poolData[1]
        });
      } catch (err) {
        console.error("Failed to fetch target reserves:", err);
        setTargetReserves(null);
      }
    };
    
    fetchTargetReserves();
  }, [isCoinToCoin, buyToken?.id, publicClient]);
  
  // Fetch LP token balance when a pool is selected and user is connected
  useEffect(() => {
    const fetchLpBalance = async () => {
      if (!address || !publicClient || !coinId || coinId === 0n) return;
      
      try {
        // Calculate the pool ID for the selected pair
        const poolId = computePoolId(coinId);
        
        // Read the user's LP token balance for this pool
        const balance = await publicClient.readContract({
          address: ZAAMAddress,
          abi: ZAAMAbi,
          functionName: "balanceOf",
          args: [address, poolId],
        }) as bigint;
        
        console.log(`LP token balance for pool ${poolId}: ${balance}`);
        setLpTokenBalance(balance);
      } catch (err) {
        console.error("Failed to fetch LP token balance:", err);
        setLpTokenBalance(0n);
      }
    };
    
    fetchLpBalance();
  }, [address, publicClient, coinId]);

  /* Check if user has approved ZAAM as operator */
  const [isOperator, setIsOperator] = useState<boolean | null>(null);
  
  useEffect(() => {
    const checkOperator = async () => {
      if (!address || !publicClient || isSellETH) return;
      
      try {
        const result = await publicClient.readContract({
          address: CoinsAddress,
          abi: CoinsAbi,
          functionName: "isOperator",
          args: [address, ZAAMAddress],
        }) as boolean;
        
        setIsOperator(result);
      } catch (err) {
        console.error("Failed to check operator status:", err);
        setIsOperator(null);
      }
    };
    
    checkOperator();
  }, [address, isSellETH, publicClient]);

  /* helpers to sync amounts */
  const syncFromSell = async (val: string) => {
    // In Remove Liquidity mode, track the LP burn amount separately
    if (mode === "liquidity" && liquidityMode === "remove") {
      setLpBurnAmount(val);
      
      // Calculate the expected token amounts based on the LP amount to burn
      if (!reserves || !val) {
        setSellAmt("");
        setBuyAmt("");
        return;
      }
      
      try {
        // Read the pool's total supply
        const poolId = computePoolId(coinId);
        const poolInfo = await publicClient.readContract({
          address: ZAAMAddress,
          abi: ZAAMAbi,
          functionName: "pools",
          args: [poolId],
        }) as any;
        
        // Ensure we have pool data
        if (!poolInfo) return;
        
        // Extract supply from pool data (the 7th item in the array for this contract, index 6)
        console.log("Pool info:", poolInfo);
        const totalSupply = poolInfo[6] as bigint; // Pool struct has supply at index 6
        
        if (totalSupply === 0n) return;
        
        // Calculate proportional amount of tokens based on removeLiquidity calculation in ZAMM.sol
        const burnAmount = parseUnits(val || "0", 18);
        
        // Calculate amounts: amount0 = liquidity * reserve0 / totalSupply (from ZAMM.sol)
        // This is the mulDiv function in ZAMM.sol converted to TypeScript
        const ethAmount = (burnAmount * reserves.reserve0) / totalSupply;
        const tokenAmount = (burnAmount * reserves.reserve1) / totalSupply;
        
        // Log calculation details for debugging
        console.log("Remove Liquidity Preview Calculation:");
        console.log(`Burn amount: ${formatUnits(burnAmount, 18)} LP tokens`);
        console.log(`Total supply: ${formatUnits(totalSupply, 18)} LP tokens`);
        console.log(`Pool reserves: ${formatEther(reserves.reserve0)} ETH, ${formatUnits(reserves.reserve1, 18)} tokens`);
        console.log(`Expected return: ${formatEther(ethAmount)} ETH, ${formatUnits(tokenAmount, 18)} tokens`);
        
        // Sanity checks
        if (ethAmount > reserves.reserve0 || tokenAmount > reserves.reserve1) {
          console.error("Error: Calculated redemption exceeds pool reserves!");
          setSellAmt("");
          setBuyAmt("");
          return;
        }
        
        // Update the input fields with the calculated values
        setSellAmt(ethAmount === 0n ? "" : formatEther(ethAmount));
        setBuyAmt(tokenAmount === 0n ? "" : formatUnits(tokenAmount, 18));
      } catch (err) {
        console.error("Error calculating remove liquidity amounts:", err);
        setSellAmt("");
        setBuyAmt("");
      }
      return;
    }
    
    // Regular Add Liquidity or Swap mode
    setSellAmt(val);
    if (!canSwap || !reserves) return setBuyAmt("");
    
    try {
      // Different calculation paths based on swap type
      if (isCoinToCoin && targetReserves && buyToken?.id && sellToken.id) {
        // For coin-to-coin swaps, we need to estimate a two-hop swap
        try {
          // Dynamically import helper to avoid circular dependencies
          const { estimateCoinToCoinOutput } = await import('./lib/swapHelper');
          
          const inUnits = parseUnits(val || "0", 18);
          const { amountOut, ethAmountOut } = estimateCoinToCoinOutput(
            sellToken.id,
            buyToken.id,
            inUnits,
            reserves,
            targetReserves
          );
          
          // For debugging purposes, log the estimated ETH intermediary amount
          if (amountOut > 0n) {
            console.log(`Estimated path: ${formatUnits(inUnits, 18)} ${sellToken.symbol} → ${formatEther(ethAmountOut)} ETH → ${formatUnits(amountOut, 18)} ${buyToken.symbol}`);
          }
          
          setBuyAmt(amountOut === 0n ? "" : formatUnits(amountOut, 18));
        } catch (err) {
          console.error("Error estimating coin-to-coin output:", err);
          setBuyAmt("");
        }
      } else if (isSellETH) {
        // ETH → Coin path
        const inWei = parseEther(val || "0");
        const outUnits = getAmountOut(
          inWei,
          reserves.reserve0,
          reserves.reserve1,
          SWAP_FEE,
        );
        setBuyAmt(outUnits === 0n ? "" : formatUnits(outUnits, 18));
      } else {
        // Coin → ETH path
        const inUnits = parseUnits(val || "0", 18);
        const outWei = getAmountOut(
          inUnits,
          reserves.reserve1,
          reserves.reserve0,
          SWAP_FEE,
        );
        setBuyAmt(outWei === 0n ? "" : formatEther(outWei));
      }
    } catch {
      setBuyAmt("");
    }
  };

  const syncFromBuy = async (val: string) => {
    setBuyAmt(val);
    if (!canSwap || !reserves) return setSellAmt("");
    
    try {
      // Different calculation paths based on swap type
      if (isCoinToCoin) {
        // Calculating input from output for coin-to-coin is very complex
        // Would require a recursive solver to find the right input amount
        // For UI simplicity, we'll just clear the input and let the user adjust
        setSellAmt("");
        
        // Optional: Show a notification that this direction is not supported
        console.log("Setting output directly not supported for coin-to-coin swaps");
      } else if (isSellETH) {
        // ETH → Coin path (calculate ETH input)
        const outUnits = parseUnits(val || "0", 18);
        const inWei = getAmountIn(
          outUnits,
          reserves.reserve0,
          reserves.reserve1,
          SWAP_FEE,
        );
        setSellAmt(inWei === 0n ? "" : formatEther(inWei));
      } else {
        // Coin → ETH path (calculate Coin input)
        const outWei = parseEther(val || "0");
        const inUnits = getAmountIn(
          outWei,
          reserves.reserve1,
          reserves.reserve0,
          SWAP_FEE,
        );
        setSellAmt(inUnits === 0n ? "" : formatUnits(inUnits, 18));
      }
    } catch {
      setSellAmt("");
    }
  };

  /* perform swap */
  const nowSec = () => BigInt(Math.floor(Date.now() / 1000));
  
  const executeRemoveLiquidity = async () => {
    // Validate inputs
    if (!reserves || !address || !publicClient) {
      setTxError("Missing required data for transaction");
      return;
    }
    
    if (!lpBurnAmount || parseFloat(lpBurnAmount) <= 0) {
      setTxError("Please enter a valid amount of LP tokens to burn");
      return;
    }
    
    // Check if burn amount exceeds user's balance
    const burnAmount = parseUnits(lpBurnAmount, 18);
    if (burnAmount > lpTokenBalance) {
      setTxError(`You only have ${formatUnits(lpTokenBalance, 18)} LP tokens available`);
      return;
    }
    
    setTxError(null);
    
    try {
      // Check if we're on mainnet
      if (chainId !== mainnet.id) {
        console.log("Not on Ethereum mainnet. Current chainId:", chainId);
        setTxError("Please connect to Ethereum mainnet to perform this action");
        return;
      }
      
      const poolKey = computePoolKey(coinId);
      const deadline = nowSec() + BigInt(DEADLINE_SEC);
      
      // Parse the minimum amounts from the displayed expected return
      const amount0Min = sellAmt ? withSlippage(parseEther(sellAmt)) : 0n;
      const amount1Min = buyAmt ? withSlippage(parseUnits(buyAmt, 18)) : 0n;
      
      console.log(`Removing liquidity - Burning ${formatUnits(burnAmount, 18)} LP tokens`);
      console.log(`Min amounts - ETH: ${formatEther(amount0Min)}, Coin: ${formatUnits(amount1Min, 18)}`);
      
      // Call removeLiquidity on the ZAMM contract
      const hash = await writeContractAsync({
        address: ZAAMAddress,
        abi: ZAAMAbi,
        functionName: "removeLiquidity",
        args: [
          poolKey,
          burnAmount,
          amount0Min,
          amount1Min,
          address,
          deadline,
        ],
      });
      
      setTxHash(hash);
    } catch (err) {
      // Use our utility to handle wallet errors
      const errorMsg = handleWalletError(err);
      if (errorMsg) {
        console.error("Remove liquidity execution error:", err);
        setTxError(errorMsg);
      }
    }
  };

  const executeAddLiquidity = async () => {
    // More specific input validation to catch issues early
    if (!canSwap || !reserves || !address || !publicClient) {
      setTxError("Missing required data for transaction");
      return;
    }
    
    if (!sellAmt || parseFloat(sellAmt) <= 0) {
      setTxError("Please enter a valid sell amount");
      return;
    }
    
    if (!buyAmt || parseFloat(buyAmt) <= 0) {
      setTxError("Please enter a valid buy amount");
      return;
    }
    
    setTxError(null);
    
    try {
      // Check if we're on mainnet
      if (chainId !== mainnet.id) {
        console.log("Not on Ethereum mainnet. Current chainId:", chainId);
        setTxError("Please connect to Ethereum mainnet to perform this action");
        return;
      }
      
      const poolKey = computePoolKey(coinId);
      const deadline = nowSec() + BigInt(DEADLINE_SEC);
      
      // In ZAMM's design, for all pools:
      // - token0 is always ETH (zeroAddress), id0 is 0
      // - token1 is always the Coin contract, id1 is the coinId
      
      // So we need to ensure:
      // - amount0 is the ETH amount (regardless of which input field the user used)
      // - amount1 is the Coin amount
      
      const amount0 = isSellETH ? parseEther(sellAmt) : parseEther(buyAmt); // ETH amount
      const amount1 = isSellETH ? parseUnits(buyAmt, 18) : parseUnits(sellAmt, 18); // Coin amount
      
      // Verify we have valid amounts
      if (amount0 === 0n || amount1 === 0n) {
        setTxError("Invalid liquidity amounts");
        return;
      }
      
      // Calculate minimum amounts with slippage protection
      const amount0Min = withSlippage(amount0);
      const amount1Min = withSlippage(amount1);
      
      // Check if the user needs to approve ZAMM as operator for their Coin token
      // This is needed when the user is providing Coin tokens (not just ETH)
      // Since we're always providing Coin tokens in liquidity, we need approval
      if (isOperator === false) {
        try {
          // First, show a notification about the approval step
          setTxError("Waiting for operator approval. Please confirm the transaction...");
          console.log("Setting ZAMM as operator for Coin tokens");
          
          // Send the approval transaction
          const approvalHash = await writeContractAsync({
            address: CoinsAddress,
            abi: CoinsAbi,
            functionName: "setOperator",
            args: [ZAAMAddress, true],
          });
          
          // Show a waiting message
          setTxError("Operator approval submitted. Waiting for confirmation...");
          
          // Wait for the transaction to be mined
          const receipt = await publicClient.waitForTransactionReceipt({ 
            hash: approvalHash 
          });
          
          // Check if the transaction was successful
          if (receipt.status === 'success') {
            setIsOperator(true);
            setTxError(null); // Clear the message
            console.log("Operator approval confirmed. Proceeding with adding liquidity...");
          } else {
            setTxError("Operator approval failed. Please try again.");
            return;
          }
        } catch (err) {
          // Use our utility to handle wallet errors
          const errorMsg = handleWalletError(err);
          if (errorMsg) {
            console.error("Failed to approve operator:", err);
            setTxError("Failed to approve the liquidity contract as operator");
          }
          return;
        }
      }
      
      console.log(`Adding liquidity - ETH: ${formatEther(amount0)}, Coin: ${formatUnits(amount1, 18)}`);
      console.log(`Min amounts - ETH: ${formatEther(amount0Min)}, Coin: ${formatUnits(amount1Min, 18)}`);
      
      // Use ZAMMHelper to calculate the exact ETH amount to provide
      console.log("Calling ZAMMHelper.calculateRequiredETH to get the exact ETH amount...");
      try {
        // The contract call returns an array of values rather than an object
        const result = await publicClient.readContract({
          address: ZAMMHelperAddress,
          abi: ZAMMHelperAbi,
          functionName: "calculateRequiredETH",
          args: [
            poolKey,
            amount0, // amount0Desired
            amount1, // amount1Desired
          ],
        });
        
        console.log("Raw ZAMMHelper result:", result);
        
        // Extract the values from the result array
        const [ethAmount, calcAmount0, calcAmount1] = result as [bigint, bigint, bigint];
        
        // Detailed logging to help with debugging
        console.log(`==== LIQUIDITY CALCULATION (ZAMMHelper) ====`);
        console.log(`Desired amounts: ${formatEther(amount0)} ETH / ${formatUnits(amount1, 18)} tokens`);
        console.log(`ZAMMHelper calculated: ${formatEther(ethAmount)} ETH to provide`);
        console.log(`ZAMMHelper amounts: ${formatEther(calcAmount0)} ETH / ${formatUnits(calcAmount1, 18)} tokens`);
        console.log(`==============================`);
        
        // Calculate minimum amounts based on the actual amounts that will be used by the contract
        const actualAmount0Min = withSlippage(calcAmount0);
        const actualAmount1Min = withSlippage(calcAmount1);
        
        console.log(`Min amounts adjusted: ${formatEther(actualAmount0Min)} ETH / ${formatUnits(actualAmount1Min, 18)} tokens`);
        
        // Use the ethAmount from ZAMMHelper as the exact value to send
        // IMPORTANT: We should also use the exact calculated amounts for amount0Desired and amount1Desired
        const hash = await writeContractAsync({
          address: ZAAMAddress,
          abi: ZAAMAbi,
          functionName: "addLiquidity",
          args: [
            poolKey,
            calcAmount0, // use calculated amount0 as amount0Desired
            calcAmount1, // use calculated amount1 as amount1Desired
            actualAmount0Min, // use adjusted min based on calculated amount
            actualAmount1Min, // use adjusted min based on calculated amount
            address, // to
            deadline,
          ],
          value: ethAmount, // Use the exact ETH amount calculated by ZAMMHelper
        });
        
        setTxHash(hash);
      } catch (calcErr) {
        // Use our utility to handle wallet errors
        const errorMsg = handleWalletError(calcErr);
        if (errorMsg) {
          console.error("Error calling ZAMMHelper.calculateRequiredETH:", calcErr);
          setTxError("Failed to calculate exact ETH amount");
        }
        return;
      }
    } catch (err) {
      // Handle errors, but don't display errors for user rejections
      // Use our utility to properly handle wallet errors
      const errorMsg = handleWalletError(err);
      if (errorMsg) {
        console.error("Add liquidity execution error:", err);
        
        // More specific error messages based on error type
        if (err instanceof Error) {
          console.log("Error details:", err);
          
          if (err.message.includes("insufficient funds")) {
            setTxError("Insufficient funds for this transaction");
          } else if (err.message.includes("InvalidMsgVal")) {
            // This is our critical error where the msg.value doesn't match what the contract expects
            setTxError("Contract rejected ETH value. Please try again with different amounts.");
            console.error("ZAMM contract rejected the ETH value due to strict msg.value validation.");
          } else {
            setTxError("Transaction failed. Please try again.");
          }
        } else {
          setTxError("Unknown error during liquidity provision");
        }
      }
    }
  };

  const executeSwap = async () => {
    if (!canSwap || !reserves || !address || !sellAmt || !publicClient) return;
    setTxError(null);
    
    try {
      // Check if we're on mainnet
      if (chainId !== mainnet.id) {
        console.log("Not on Ethereum mainnet. Current chainId:", chainId);
        setTxError("Please connect to Ethereum mainnet to perform this action");
        return;
      }

      const poolKey = computePoolKey(coinId);

      if (isSellETH) {
        const amountInWei = parseEther(sellAmt || "0");
        const rawOut = getAmountOut(
          amountInWei,
          reserves.reserve0,
          reserves.reserve1,
          SWAP_FEE,
        );
        
        if (rawOut === 0n) {
          setTxError("Output amount is zero. Check pool liquidity.");
          return;
        }
        
        const hash = await writeContractAsync({
          address: ZAAMAddress,
          abi: ZAAMAbi,
          functionName: "swapExactIn",
          args: [
            poolKey,
            amountInWei,
            withSlippage(rawOut),
            true,
            address,
            nowSec() + BigInt(DEADLINE_SEC),
          ],
          value: amountInWei,
        });
        setTxHash(hash);
      } else {
        const amountInUnits = parseUnits(sellAmt || "0", 18);
        
        // Approve ZAAM as operator if needed
        if (isOperator === false) {
          try {
            // First, show a notification about the approval step
            setTxError("Waiting for operator approval. Please confirm the transaction...");
            
            // Send the approval transaction
            const approvalHash = await writeContractAsync({
              address: CoinsAddress,
              abi: CoinsAbi,
              functionName: "setOperator",
              args: [ZAAMAddress, true],
              chainId: mainnet.id,
            });
            
            // Show a waiting message
            setTxError("Operator approval submitted. Waiting for confirmation...");
            
            // Wait for the transaction to be mined
            const receipt = await publicClient.waitForTransactionReceipt({ 
              hash: approvalHash 
            });
            
            // Check if the transaction was successful
            if (receipt.status === 'success') {
              setIsOperator(true);
              setTxError(null); // Clear the message
              console.log("Operator approval confirmed. Proceeding with swap...");
            } else {
              setTxError("Operator approval failed. Please try again.");
              return;
            }
          } catch (err) {
            // Use our utility to handle wallet errors
            const errorMsg = handleWalletError(err);
            if (errorMsg) {
              console.error("Failed to approve operator:", err);
              setTxError("Failed to approve the swap contract as operator");
            }
            return;
          }
        }
        
        // If we have two different Coin IDs, use the multicall path for Coin to Coin swap
        if (buyToken?.id !== null && sellToken.id !== null && buyToken?.id !== sellToken.id) {
          try {
            // Import our helper dynamically to avoid circular dependencies
            const { createCoinSwapMulticall, estimateCoinToCoinOutput } = await import('./lib/swapHelper');
            
            // Fetch target coin reserves
            const targetPoolId = computePoolId(buyToken.id!);
            const targetPoolResult = await publicClient.readContract({
              address: ZAAMAddress,
              abi: ZAAMAbi,
              functionName: "pools",
              args: [targetPoolId],
            });
            
            const targetPoolData = targetPoolResult as unknown as readonly bigint[];
            const targetReserves = {
              reserve0: targetPoolData[0],
              reserve1: targetPoolData[1]
            };
            
            // Estimate the final output amount and intermediate ETH amount
            const { amountOut, withSlippage: minAmountOut, ethAmountOut } = estimateCoinToCoinOutput(
              sellToken.id!,
              buyToken.id!,
              amountInUnits,
              reserves, // source reserves
              targetReserves // target reserves
            );
            
            if (amountOut === 0n) {
              setTxError("Output amount is zero. Check pool liquidity.");
              return;
            }
            
            console.log(`Swapping ${amountInUnits} of coin ${sellToken.id} through ${ethAmountOut} ETH to minimum ${minAmountOut} of coin ${buyToken.id}`);
            
            // Create the multicall data for coin-to-coin swap via ETH
            const multicallData = createCoinSwapMulticall(
              sellToken.id!,
              buyToken.id!,
              amountInUnits,
              ethAmountOut, // Pass the estimated ETH output for the second swap
              minAmountOut,
              address
            );
            
            // Log the calls we're making for debugging
            console.log("Executing multicall with the following operations:");
            console.log(`1. Swap ${formatUnits(amountInUnits, 18)} ${sellToken.symbol} → ETH`);
            console.log(`2. Swap ~${formatEther(ethAmountOut)} ETH → min ${formatUnits(minAmountOut, 18)} ${buyToken.symbol}`);
            console.log(`3. Recover any leftover ${sellToken.symbol} to ${address} (unlikely)`);
            console.log(`4. Recover any leftover ETH to ${address} (expected)`);
            console.log(`5. Recover any excess ${buyToken.symbol} to ${address} (safety measure)`);
            
            // Execute the multicall transaction
            const hash = await writeContractAsync({
              address: ZAAMAddress,
              abi: ZAAMAbi,
              functionName: "multicall",
              args: [multicallData],
            });
            
            console.log(`Transaction hash: ${hash}`);
            setTxHash(hash);
            return;
          } catch (err) {
            // Use our utility to handle wallet errors
            const errorMsg = handleWalletError(err);
            if (errorMsg) {
              console.error("Error in multicall swap:", err);
              setTxError("Failed to execute coin-to-coin swap");
            }
            return;
          }
        }
        
        // Default path for Coin to ETH swap
        const rawOut = getAmountOut(
          amountInUnits,
          reserves.reserve1,
          reserves.reserve0,
          SWAP_FEE,
        );
        
        if (rawOut === 0n) {
          setTxError("Output amount is zero. Check pool liquidity.");
          return;
        }
        
        const hash = await writeContractAsync({
          address: ZAAMAddress,
          abi: ZAAMAbi,
          functionName: "swapExactIn",
          args: [
            poolKey,
            amountInUnits,
            withSlippage(rawOut),
            false,
            address,
            nowSec() + BigInt(DEADLINE_SEC),
          ],
        });
        setTxHash(hash);
      }
    } catch (err) {
      // Use our utility to handle wallet errors
      const errorMsg = handleWalletError(err);
      if (errorMsg) {
        console.error("Swap execution error:", err);
        setTxError(errorMsg);
      }
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  // Main UI
  return (
    <Card className="w-lg p-6 border-2 border-yellow-100 shadow-md rounded-xl">
      <CardContent className="p-1 flex flex-col space-y-1">
        {/* Info showing token count */}
        <div className="text-xs text-gray-500 mb-2">
          Available tokens: {tokenCount} (ETH + {tokenCount - 1} coins, sorted by liquidity)
        </div>
        
        {/* Mode tabs */}
        <Tabs value={mode} onValueChange={(value) => setMode(value as TileMode)} className="mb-2">
          <TabsList className="w-full bg-yellow-50 p-1 rounded-lg border border-yellow-100">
            <TabsTrigger 
              value="swap" 
              className="flex-1 data-[state=active]:bg-white data-[state=active]:border-yellow-200 data-[state=active]:shadow-sm"
            >
              <ArrowDownUp className="h-4 w-4 mr-1" />
              Swap
            </TabsTrigger>
            <TabsTrigger 
              value="liquidity" 
              className="flex-1 data-[state=active]:bg-white data-[state=active]:border-yellow-200 data-[state=active]:shadow-sm"
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Liquidity
            </TabsTrigger>
          </TabsList>
        </Tabs>
        
        {/* Load error notification */}
        {loadError && (
          <div className="p-2 mb-2 bg-red-50 border border-red-200 rounded text-sm text-red-600">
            {loadError}
          </div>
        )}
        
        {/* SELL + FLIP + BUY panel container */}
        <div className="relative flex flex-col">
          {/* LP Amount Input (only visible in Remove Liquidity mode) */}
          {mode === "liquidity" && liquidityMode === "remove" && (
            <div className="border-2 border-yellow-500 group hover:bg-yellow-50 rounded-t-2xl p-3 pb-4 focus-within:ring-2 focus-within:ring-primary flex flex-col gap-2 bg-yellow-50">
              <div className="flex items-center justify-between">
                <span className="font-medium text-yellow-800">LP Tokens to Burn</span>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-yellow-700">
                    Balance: {formatUnits(lpTokenBalance, 18)}
                  </span>
                  <button
                    className="text-xs bg-yellow-200 hover:bg-yellow-300 text-yellow-800 font-medium px-2 py-0.5 rounded"
                    onClick={() => syncFromSell(formatUnits(lpTokenBalance, 18))}
                  >
                    MAX
                  </button>
                </div>
              </div>
              <input
                type="number"
                min="0"
                step="any"
                placeholder="0.0"
                value={lpBurnAmount}
                onChange={(e) => syncFromSell(e.target.value)}
                className="text-xl font-medium w-full bg-yellow-50 focus:outline-none"
              />
              <div className="text-xs text-yellow-600 mt-1">
                Enter the amount of LP tokens you want to burn to receive ETH and tokens back.
              </div>
            </div>
          )}
          
          {/* SELL/PROVIDE panel */}
          <div className={`border-2 border-yellow-300 group hover:bg-yellow-50 ${mode === "liquidity" && liquidityMode === "remove" ? "rounded-md" : "rounded-t-2xl"} p-2 pb-4 focus-within:ring-2 focus-within:ring-primary flex flex-col gap-2 ${mode === "liquidity" && liquidityMode === "remove" ? "mt-2" : ""}`}>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {mode === "swap" ? "Sell" : 
                  liquidityMode === "add" ? "Provide" : 
                  "You'll Receive (ETH)"}
              </span>
              <TokenSelector
                selectedToken={sellToken}
                tokens={tokens}
                onSelect={handleSellTokenSelect}
              />
            </div>
            <div className="flex justify-between items-center">
              <input
                type="number"
                min="0"
                step="any"
                placeholder="0.0"
                value={sellAmt}
                onChange={(e) => syncFromSell(e.target.value)}
                className="text-xl font-medium w-full focus:outline-none"
                readOnly={mode === "liquidity" && liquidityMode === "remove"}
              />
              {mode === "liquidity" && liquidityMode === "remove" && (
                <span className="text-xs text-yellow-600 font-medium">Preview</span>
              )}
              {/* MAX button for using full balance */}
              {sellToken.balance !== undefined && sellToken.balance > 0n && mode !== "liquidity" && liquidityMode !== "remove" && (
                <button
                  className="text-xs bg-yellow-100 hover:bg-yellow-200 text-yellow-800 font-medium px-2 py-0.5 rounded"
                  onClick={() => {
                    // For ETH, leave a small amount for gas
                    if (sellToken.id === null) {
                      // Get 99% of ETH balance to leave some for gas
                      const ethAmount = (sellToken.balance as bigint * 99n) / 100n;
                      syncFromSell(formatEther(ethAmount));
                    } else {
                      // For other tokens, use the full balance
                      syncFromSell(formatUnits(sellToken.balance as bigint, 18));
                    }
                  }}
                >
                  MAX
                </button>
              )}
            </div>
          </div>
          
          {/* FLIP/PLUS/MINUS button */}
          <button
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 p-2 rounded-full shadow-xl bg-yellow-500 hover:bg-yellow-600 focus:bg-yellow-600 focus:outline-none focus:ring-2 focus:ring-yellow-400 active:scale-95 transition-all z-10"
            onClick={mode === "swap" ? flipTokens : () => setLiquidityMode(liquidityMode === "add" ? "remove" : "add")}
          >
            {mode === "swap" ? (
              <ArrowDownUp className="h-4 w-4 text-white" />
            ) : liquidityMode === "add" ? (
              <Plus className="h-4 w-4 text-white" />
            ) : (
              <Minus className="h-4 w-4 text-white" />
            )}
          </button>

          {/* BUY/RECEIVE panel */}
          {buyToken && (
            <div className="border-2 border-yellow-300 group rounded-b-2xl p-2 pt-3 focus-within:ring-2 hover:bg-yellow-50 focus-within:ring-primary flex flex-col gap-2 mt-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {mode === "swap" ? "Buy" : 
                    liquidityMode === "add" ? "And" : 
                    `You'll Receive (${buyToken.symbol})`}
                </span>
                <TokenSelector
                  selectedToken={buyToken}
                  tokens={tokens}
                  onSelect={handleBuyTokenSelect}
                />
              </div>
              <div className="flex justify-between items-center">
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="0.0"
                  value={buyAmt}
                  onChange={(e) => syncFromBuy(e.target.value)}
                  className="text-xl font-medium w-full focus:outline-none"
                  readOnly={mode === "liquidity" && liquidityMode === "remove"}
                />
                {mode === "liquidity" && liquidityMode === "remove" && (
                  <span className="text-xs text-yellow-600 font-medium">Preview</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Network indicator */}
        {isConnected && chainId !== mainnet.id && (
          <div className="text-xs mt-1 px-2 py-1 bg-yellow-50 border border-yellow-200 rounded text-yellow-700">
            <strong>Wrong Network:</strong> Please switch to Ethereum mainnet in your wallet to {mode === "swap" ? "swap tokens" : "manage liquidity"}
          </div>
        )}
        
        {/* Mode-specific information */}
        {mode === "liquidity" && (
          <div className="text-xs bg-yellow-50 border border-yellow-200 rounded p-2 mt-2 text-yellow-800">
            {liquidityMode === "add" ? (
              <>
                <p className="font-medium mb-1">Adding liquidity provides:</p>
                <ul className="list-disc pl-4 space-y-0.5">
                  <li>LP tokens as a proof of your position</li>
                  <li>Earn {Number(SWAP_FEE) / 100}% fees from trades</li>
                  <li>Withdraw your liquidity anytime</li>
                </ul>
              </>
            ) : (
              <>
                <p className="font-medium mb-1">Remove Liquidity:</p>
                <ul className="list-disc pl-4 space-y-0.5">
                  <li>Your LP balance: {formatUnits(lpTokenBalance, 18)} LP tokens</li>
                  <li>Enter amount of LP tokens to burn</li>
                  <li>Preview shows expected return of ETH and tokens</li>
                </ul>
              </>
            )}
          </div>
        )}
        
        {/* Pool information */}
        {canSwap && reserves && (
          <div className="text-xs text-gray-500 flex justify-between px-1 mt-1">
            {mode === "swap" && isCoinToCoin ? (
              <span className="flex items-center">
                <span className="bg-yellow-200 text-yellow-800 px-1 rounded mr-1">Multi-hop</span>
                {sellToken.symbol} → ETH → {buyToken?.symbol}
              </span>
            ) : (
              <span>Pool: {formatEther(reserves.reserve0).substring(0, 8)} ETH / {formatUnits(reserves.reserve1, 18).substring(0, 8)} {buyToken?.symbol}</span>
            )}
            <span>Fee: {mode === "swap" && isCoinToCoin ? Number(SWAP_FEE) * 2 / 100 : Number(SWAP_FEE) / 100}%</span>
          </div>
        )}

        {/* ACTION BUTTON */}
        <Button
          onClick={
            mode === "swap" 
              ? executeSwap 
              : liquidityMode === "add" 
                ? executeAddLiquidity 
                : executeRemoveLiquidity
          }
          disabled={
            !isConnected || 
            (mode === "swap" && (!canSwap || !sellAmt)) ||
            (mode === "liquidity" && liquidityMode === "add" && (!canSwap || !sellAmt)) ||
            (mode === "liquidity" && liquidityMode === "remove" && (!lpBurnAmount || parseFloat(lpBurnAmount) <= 0 || parseUnits(lpBurnAmount || "0", 18) > lpTokenBalance)) ||
            isPending
          }
          className="w-full text-lg mt-4"
        >
          {isPending ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              {mode === "swap" 
                ? "Swapping…" 
                : liquidityMode === "add" 
                  ? "Adding Liquidity…" 
                  : "Removing Liquidity…"
              }
            </span>
          ) : mode === "swap" 
            ? "Swap" 
            : liquidityMode === "add" 
              ? "Add Liquidity" 
              : "Remove Liquidity"
          }
        </Button>

        {/* Status and error messages */}
        {/* Show transaction statuses */}
        {txError && txError.includes("Waiting for") && (
          <div className="text-sm text-yellow-600 mt-2 flex items-center">
            <Loader2 className="h-3 w-3 animate-spin mr-2" />
            {txError}
          </div>
        )}
        
        {/* Show actual errors (only if not a user rejection) */}
        {((writeError && !isUserRejectionError(writeError)) || (txError && !txError.includes("Waiting for"))) && (
          <div className="text-sm text-red-600 mt-2">
            {writeError && !isUserRejectionError(writeError) ? writeError.message : txError}
          </div>
        )}
        
        {/* Success message */}
        {isSuccess && (
          <div className="text-sm text-green-600 mt-2 flex items-center">
            <svg className="h-3 w-3 mr-2" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            Transaction confirmed!
          </div>
        )}
        
        {/* Subtle explorer link */}
        <div className="text-xs text-gray-400 mt-4 text-center">
          <a 
            href="#" 
            onClick={(e) => {
              e.preventDefault();
              // This assumes App.tsx has access to this function via props
              window.dispatchEvent(new CustomEvent('coinchan:setView', { detail: 'menu' }));
            }} 
            className="hover:text-gray-600 hover:underline"
          >
            View all coins in explorer
          </a>
        </div>
      </CardContent>
    </Card>
  );
};

export default SwapTile;