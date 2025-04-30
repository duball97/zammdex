import { useState, useEffect, useRef } from "react";
import {
  useWriteContract,
  useWaitForTransactionReceipt,
  useAccount,
  useReadContract,
  usePublicClient,
  useSwitchChain,
  useChainId,
} from "wagmi";
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
import { CoinchanAbi, CoinchanAddress } from "./constants/Coinchan";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Check, ChevronDown, Loader2, ArrowDownUp } from "lucide-react";
import { mainnet } from "viem/chains";

/* ────────────────────────────────────────────────────────────────────────────
  CONSTANTS & HELPERS
──────────────────────────────────────────────────────────────────────────── */
const SWAP_FEE = 100n; // 1 % pool fee
const SLIPPAGE_BPS = 100n; // 1 % slippage tolerance
const DEADLINE_SEC = 20 * 60; // 20 minutes

const withSlippage = (amount: bigint) =>
  (amount * (10000n - SLIPPAGE_BPS)) / 10000n;

export interface TokenMeta {
  id: bigint | null; // null ⇒ ETH pseudo‑token
  name: string;
  symbol: string;
}

const ETH_TOKEN: TokenMeta = {
  id: null,
  name: "Ether",
  symbol: "ETH",
};

const computePoolKey = (coinId: bigint) => ({
  id0: 0n,
  id1: coinId,
  token0: zeroAddress,
  token1: CoinsAddress,
  swapFee: SWAP_FEE,
});

const computePoolId = (coinId: bigint) =>
  keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "uint256 id0, uint256 id1, address token0, address token1, uint96 swapFee",
      ),
      [0n, coinId, zeroAddress, CoinsAddress, SWAP_FEE],
    ),
  );

// x*y=k AMM with fee — forward (amountIn → amountOut)
const getAmountOut = (
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  swapFee: bigint,
) => {
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
  const numerator = reserveIn * amountOut * 10000n;
  const denominator = (reserveOut - amountOut) * (10000n - swapFee);
  return numerator / denominator + 1n; // +1 for ceiling rounding
};

/* ────────────────────────────────────────────────────────────────────────────
  IMPROVED HOOK: fetch all Coinchan tokens once with better error handling
──────────────────────────────────────────────────────────────────────────── */
const useAllTokens = (): { tokens: TokenMeta[]; loading: boolean; error: Error | null } => {
  const publicClient = usePublicClient({ chainId: 1 });
  const [tokens, setTokens] = useState<TokenMeta[]>([ETH_TOKEN]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [debugInfo, setDebugInfo] = useState<string>("");

  // Get the total count of tokens
  const { data: totalCoins, isLoading: isLoadingCount, isError: isErrorCount } = useReadContract({
    address: CoinchanAddress,
    abi: CoinchanAbi,
    functionName: "getCoinsCount",
    chainId: 1,
  });

  // Debug display for developer use
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.search.includes("debug=true")) {
      setDebugInfo(`Count: ${totalCoins?.toString() || "loading"}, Loading: ${loading}, Tokens: ${tokens.length}`);
    }
  }, [totalCoins, loading, tokens.length]);

  useEffect(() => {
    // Reset error state on refetch
    setError(null);

    // Only proceed if we have the token count and the public client
    if (isLoadingCount || isErrorCount || totalCoins === undefined || !publicClient) {
      if (isErrorCount) {
        console.error("Failed to get token count");
        setError(new Error("Failed to get token count"));
        setLoading(false);
      }
      return;
    }

    const fetchTokens = async () => {
      try {
        console.log(`Fetching tokens from Coinchan. Total count: ${totalCoins}`);
        const total = Number(totalCoins || 0n);
        
        // If no tokens, just return ETH
        if (total === 0) {
          console.log("No tokens found in coinchan contract");
          setTokens([ETH_TOKEN]);
          return;
        }

        // Fetch all coin IDs from coinchan
        console.log(`Fetching coins with range: 0 to ${total - 1}`);
        
        let ids: bigint[] = [];
        try {
          // The contract handles range checking internally
          ids = (await publicClient.readContract({
            address: CoinchanAddress,
            abi: CoinchanAbi,
            functionName: "getCoins",
            args: [0n, BigInt(total - 1)], // Use total-1 as the finish index
          })) as bigint[];
          console.log(`Successfully fetched ${ids.length} token IDs:`, ids.map(id => id.toString()));
        } catch (idsError) {
          console.error("Error fetching coin IDs:", idsError);
          // Try alternative approach - fetch coins one by one if batch failed
          console.log("Attempting to fetch coins individually...");
          const individualIds: bigint[] = [];
          for (let i = 0; i < Math.min(total, 100); i++) { // Limit to first 100 in case of very large lists
            try {
              const coinId = await publicClient.readContract({
                address: CoinchanAddress,
                abi: CoinchanAbi,
                functionName: "coins",
                args: [BigInt(i)],
              }) as bigint;
              individualIds.push(coinId);
            } catch (e) {
              console.warn(`Failed to fetch coin at index ${i}`);
            }
          }
          ids = individualIds;
          console.log(`Fetched ${ids.length} coins individually`);
        }
        
        if (ids.length === 0) {
          console.warn("No coin IDs returned from contract");
          setTokens([ETH_TOKEN]);
          return;
        }

        // Fetch metadata for each token in parallel with batching
        console.log("Fetching metadata for tokens...");
        const BATCH_SIZE = 10; // Process in smaller batches to avoid rate limiting
        const allTokenMetas: TokenMeta[] = [];
        
        for (let i = 0; i < ids.length; i += BATCH_SIZE) {
          const batch = ids.slice(i, i + BATCH_SIZE);
          console.log(`Processing batch ${i/BATCH_SIZE + 1}: ${batch.length} tokens`);
          
          const batchPromises = batch.map(async (id) => {
            try {
              // Query the COINS contract for token metadata
              const [symbol, name] = await Promise.all([
                publicClient.readContract({
                  address: CoinsAddress,
                  abi: CoinsAbi,
                  functionName: "symbol",
                  args: [id],
                }).catch(e => `C#${id.toString()}`), // Fallback symbol
                publicClient.readContract({
                  address: CoinsAddress,
                  abi: CoinsAbi,
                  functionName: "name",
                  args: [id],
                }).catch(e => `Coin #${id.toString()}`) // Fallback name
              ]) as [string, string];
              
              console.log(`Token ${id.toString()} metadata: ${symbol} - ${name}`);
              return { id, name, symbol } satisfies TokenMeta;
            } catch (err) {
              console.warn(`Error fetching metadata for token ${id}:`, err);
              // Fallback with a generic name if metadata fetch fails
              return {
                id,
                name: `Coin #${id.toString()}`,
                symbol: `C#${id.toString()}`,
              } satisfies TokenMeta;
            }
          });
          
          const batchResults = await Promise.all(batchPromises);
          allTokenMetas.push(...batchResults);
          
          // Update tokens incrementally as batches complete
          setTokens(current => {
            const currentIds = new Set(current.map(t => t.id?.toString()));
            const newTokens = batchResults.filter(t => !currentIds.has(t.id?.toString()));
            return [...current, ...newTokens];
          });
        }
        
        console.log(`Completed fetching metadata for ${allTokenMetas.length} tokens`);
        
        // Set the final token list with ETH first and deduplicated
        const uniqueTokens = [ETH_TOKEN];
        const seenIds = new Set<string>(["eth"]);
        
        allTokenMetas.forEach(token => {
          const idStr = token.id?.toString();
          if (idStr && !seenIds.has(idStr)) {
            seenIds.add(idStr);
            uniqueTokens.push(token);
          }
        });
        
        console.log(`Final token list contains ${uniqueTokens.length} unique tokens`);
        setTokens(uniqueTokens);
      } catch (err) {
        console.error("Error in token fetching process:", err);
        setError(err instanceof Error ? err : new Error(String(err)));
        // Ensure we at least have ETH in the list
        if (tokens.length <= 1) {
          setTokens([ETH_TOKEN]);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchTokens();
  }, [totalCoins, publicClient, isLoadingCount, isErrorCount]);
  
  // Add debug output to DOM if enabled
  useEffect(() => {
    if (debugInfo && typeof document !== "undefined") {
      const existingDebug = document.getElementById("token-debug");
      if (!existingDebug) {
        const debugEl = document.createElement("div");
        debugEl.id = "token-debug";
        debugEl.style.position = "fixed";
        debugEl.style.bottom = "0";
        debugEl.style.left = "0";
        debugEl.style.background = "rgba(0,0,0,0.7)";
        debugEl.style.color = "white";
        debugEl.style.padding = "10px";
        debugEl.style.fontSize = "12px";
        debugEl.style.zIndex = "9999";
        debugEl.style.maxWidth = "100%";
        debugEl.style.overflow = "auto";
        document.body.appendChild(debugEl);
      }
      document.getElementById("token-debug")!.textContent = debugInfo;
    }
  }, [debugInfo]);

  return { tokens, loading, error };
};

/* ────────────────────────────────────────────────────────────────────────────
  Custom Token dropdown component (no shadcn Popover)
──────────────────────────────────────────────────────────────────────────── */
const TokenSelector = ({
  token,
  tokens,
  onSelect,
}: {
  token: TokenMeta;
  tokens: TokenMeta[];
  onSelect: (t: TokenMeta) => void;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  // Close the dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    
    // Log the token list whenever the dropdown opens
    if (isOpen) {
      console.log("Custom dropdown opened with tokens:", tokens);
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
    }
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, tokens]);

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => {
          console.log("Token selector button clicked, setting isOpen to", !isOpen);
          setIsOpen(!isOpen);
        }}
        className="inline-flex items-center gap-1 px-2 py-1 text-base rounded-md border border-yellow-200 hover:bg-yellow-50 focus:outline-none focus:ring-2 focus:ring-yellow-300"
      >
        {token.symbol}
        <ChevronDown className="h-4 w-4 opacity-60" />
      </button>
      
      {/* Dropdown Menu */}
      {isOpen && (
        <div 
          className="absolute right-0 z-50 mt-1 w-56 rounded-md border-2 border-yellow-200 bg-white shadow-lg overflow-hidden"
          style={{ maxHeight: '300px', overflowY: 'auto' }}
        >
          {tokens.length <= 1 ? (
            <div className="p-3 text-sm text-center text-gray-500">
              No tokens available
            </div>
          ) : (
            <div className="py-1">
              {tokens.map((t) => (
                <button
                  key={`token-${t.id?.toString() ?? "eth"}`}
                  className="w-full text-left px-4 py-2 hover:bg-yellow-50 flex items-center justify-between"
                  onClick={() => {
                    console.log("Selected token:", t);
                    onSelect(t);
                    setIsOpen(false);
                  }}
                >
                  <div className="flex flex-col">
                    <span className="font-medium">{t.symbol}</span>
                    {t.id !== null && (
                      <span className="text-xs text-gray-500 truncate max-w-[180px]">
                        {t.name}
                      </span>
                    )}
                  </div>
                  {t.symbol === token.symbol && (
                    <Check className="h-4 w-4 text-yellow-500" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* ────────────────────────────────────────────────────────────────────────────
  SwapTile main component
──────────────────────────────────────────────────────────────────────────── */
export const SwapTile = () => {
  /* token list */
  const { tokens, loading, error: tokenLoadError } = useAllTokens();
  const [sellToken, setSellToken] = useState<TokenMeta>(ETH_TOKEN);
  const [buyToken, setBuyToken] = useState<TokenMeta | null>(null);

  // Debug info for development
  useEffect(() => {
    console.log("SwapTile tokens:", tokens);
    console.log("SwapTile loading:", loading);
    console.log("SwapTile error:", tokenLoadError);
  }, [tokens, loading, tokenLoadError]);

  // default buy token once list loads
  useEffect(() => {
    if (!buyToken && tokens.length > 1) {
      console.log("Setting default buy token:", tokens[1]);
      setBuyToken(tokens[1]);
    }
  }, [tokens, buyToken]);

  const flipTokens = () => {
    if (!buyToken) return;
    console.log("Flipping tokens:", { sell: sellToken, buy: buyToken });
    setSellToken(buyToken);
    setBuyToken(sellToken);
  };

  /* derived flags */
  const canSwap =
    sellToken && buyToken && (sellToken.id === null || buyToken.id === null);
  const isSellETH = sellToken.id === null;
  const coinId = (isSellETH ? buyToken?.id : sellToken.id) ?? 0n;

  /* user inputs */
  const [sellAmt, setSellAmt] = useState("");
  const [buyAmt, setBuyAmt] = useState("");
  const [txHash, setTxHash] = useState<string>();

  /* wagmi hooks */
  const { address, isConnected } = useAccount();
  const { writeContractAsync, isPending, error } = useWriteContract();
  const { isSuccess } = useWaitForTransactionReceipt({ hash: txHash as `0x${string}` });
  const { switchChain } = useSwitchChain();
  const chainId = useChainId();

  /* on‑chain reserves */
  const poolId = computePoolId(coinId);
  const { data: rawReserves } = useReadContract({
    address: ZAAMAddress,
    abi: ZAAMAbi,
    functionName: "pools",
    args: [poolId],
    chainId: 1,
  });

  // Process reserves into a more usable format
  const reserves = rawReserves ? {
    reserve0: rawReserves[0],
    reserve1: rawReserves[1]
  } : undefined;

  /* allowance for token sales */
  const { data: isOperator } = useReadContract({
    address: CoinsAddress,
    abi: CoinsAbi,
    functionName: "isOperator",
    args: address ? [address, ZAAMAddress] : undefined,
    chainId: 1,
  });

  /* helpers to sync amounts */
  const syncFromSell = (val: string) => {
    setSellAmt(val);
    if (!canSwap || !reserves) return setBuyAmt("");
    try {
      if (isSellETH) {
        const inWei = parseEther(val || "0");
        const outUnits = getAmountOut(
          inWei,
          reserves.reserve0,
          reserves.reserve1,
          SWAP_FEE,
        );
        setBuyAmt(formatUnits(outUnits, 18));
      } else {
        const inUnits = parseUnits(val || "0", 18);
        const outWei = getAmountOut(
          inUnits,
          reserves.reserve1,
          reserves.reserve0,
          SWAP_FEE,
        );
        setBuyAmt(formatEther(outWei));
      }
    } catch {
      setBuyAmt("");
    }
  };

  const syncFromBuy = (val: string) => {
    setBuyAmt(val);
    if (!canSwap || !reserves) return setSellAmt("");
    try {
      if (isSellETH) {
        const outUnits = parseUnits(val || "0", 18);
        const inWei = getAmountIn(
          outUnits,
          reserves.reserve0,
          reserves.reserve1,
          SWAP_FEE,
        );
        setSellAmt(formatEther(inWei));
      } else {
        const outWei = parseEther(val || "0");
        const inUnits = getAmountIn(
          outWei,
          reserves.reserve1,
          reserves.reserve0,
          SWAP_FEE,
        );
        setSellAmt(formatUnits(inUnits, 18));
      }
    } catch {
      setSellAmt("");
    }
  };

  /* perform swap */
  const nowSec = () => BigInt(Math.floor(Date.now() / 1000));

  const executeSwap = async () => {
    if (!canSwap || !reserves || !address) return;
    if (chainId !== mainnet.id) await switchChain({ chainId: mainnet.id });

    const poolKey = computePoolKey(coinId);

    if (isSellETH) {
      const amountInWei = parseEther(sellAmt || "0");
      const rawOut = getAmountOut(
        amountInWei,
        reserves.reserve0,
        reserves.reserve1,
        SWAP_FEE,
      );
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
        chainId: 1,
      });
      setTxHash(hash);
    } else {
      const amountInUnits = parseUnits(sellAmt || "0", 18);
      if (!isOperator) {
        await writeContractAsync({
          address: CoinsAddress,
          abi: CoinsAbi,
          functionName: "setOperator",
          args: [ZAAMAddress, true],
          chainId: 1,
        });
      }
      const rawOut = getAmountOut(
        amountInUnits,
        reserves.reserve1,
        reserves.reserve0,
        SWAP_FEE,
      );
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
        chainId: 1,
      });
      setTxHash(hash);
    }
  };

  /* UI */
  if (loading)
    return (
      <div className="flex flex-col items-center justify-center p-8 gap-2">
        <div className="flex items-center">
          <Loader2 className="h-5 w-5 animate-spin text-yellow-500" />
          <span className="ml-2 font-medium">Loading tokens...</span>
        </div>
        <p className="text-sm text-muted-foreground">Please wait while we fetch available tokens</p>
      </div>
    );

  return (
    <Card className="w-lg p-6 border-2 border-yellow-100 outline-none shadow-md rounded-xl">
      {/* Debug panel */}
      <div className="mb-4 p-3 text-xs bg-gray-100 rounded-lg border border-gray-300">
        <div className="font-bold mb-1">Debug Info:</div>
        <div>Token Count: {tokens.length}</div>
        <div>Loading: {loading ? 'Yes' : 'No'}</div>
        <div>Error: {tokenLoadError ? tokenLoadError.message : 'None'}</div>
        <div>Selected: {sellToken.symbol} → {buyToken?.symbol || 'None'}</div>
        <div className="mt-2">
          <details>
            <summary className="cursor-pointer">Token List</summary>
            <pre className="text-xs mt-1 p-2 bg-gray-200 rounded overflow-auto max-h-32">
              {JSON.stringify(tokens.map(t => ({ id: t.id?.toString(), symbol: t.symbol })), null, 2)}
            </pre>
          </details>
        </div>
      </div>
      
      <CardContent className="p-1 flex flex-col space-y-1">
        {tokenLoadError && (
          <div className="mb-3 p-3 text-sm text-red-600 bg-red-50 rounded-lg border border-red-200 flex items-start">
            <span className="mr-1">⚠️</span>
            <div>
              <p className="font-medium">Error loading tokens</p>
              <p className="text-xs mt-1">{tokenLoadError.message}</p>
            </div>
          </div>
        )}
        
        {tokens.length <= 1 && !loading && !tokenLoadError && (
          <div className="mb-3 p-3 text-sm text-yellow-700 bg-yellow-50 rounded-lg border border-yellow-200">
            <p className="font-medium">No tokens found</p>
            <p className="text-xs mt-1">Only ETH is available for swapping. Check back later for more tokens.</p>
          </div>
        )}
        
        {tokens.length > 1 && !tokenLoadError && (
          <div className="mb-3 p-3 text-sm text-green-700 bg-green-50 rounded-lg border border-green-200 flex items-center justify-between">
            <div>
              <p className="font-medium">Ready to swap</p>
              <p className="text-xs mt-1">Loaded {tokens.length - 1} tokens successfully</p>
            </div>
            <div className="text-xs py-1 px-2 bg-green-100 rounded-full text-green-800 font-medium">
              {tokens.length - 1} tokens
            </div>
          </div>
        )}

        {/* SELL + FLIP + BUY panel container */}
        <div className="relative flex flex-col">
          {/* SELL panel */}
          <div className="border-2 border-yellow-300 group hover:bg-yellow-50 rounded-t-2xl p-2 pb-4 focus-within:ring-2 focus-within:ring-primary flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Sell</span>
              <TokenSelector
                token={sellToken}
                tokens={tokens}
                onSelect={setSellToken}
              />
            </div>
            <input
              type="number"
              min="0"
              step="any"
              placeholder="0.0"
              value={sellAmt}
              onChange={(e) => syncFromSell(e.currentTarget.value)}
              className="text-xl font-medium w-full focus:outline-none"
            />
          </div>
          {/* FLIP button */}
          <button
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 p-2 rounded-full shadow-xl bg-yellow-500 hover:bg-yellow-600 focus:bg-yellow-600 focus:outline-none focus:ring-2 focus:ring-yellow-400 active:scale-95 transition-all z-10"
            onClick={flipTokens}
          >
            <ArrowDownUp className="h-4 w-4" />
          </button>

          {/* BUY panel */}
          {buyToken && (
            <div className="border-2 border-yellow-300 group rounded-b-2xl p-2 pt-3 focus-within:ring-2 hover:bg-yellow-50 focus-within:ring-primary flex flex-col gap-2 mt-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Buy</span>
                <TokenSelector
                  token={buyToken}
                  tokens={tokens}
                  onSelect={setBuyToken}
                />
              </div>
              <input
                type="number"
                min="0"
                step="any"
                placeholder="0.0"
                value={buyAmt}
                onChange={(e) => syncFromBuy(e.currentTarget.value)}
                className="text-xl font-medium w-full focus:outline-none"
              />
            </div>
          )}
        </div>

        {/* ACTION BUTTON */}
        <Button
          onClick={executeSwap}
          disabled={!isConnected || !canSwap || isPending || !sellAmt}
          className="w-full text-lg mt-4"
        >
          {isPending ? "Swapping…" : "Swap"}
        </Button>

        {error && <p className="text-sm text-destructive">{error.message}</p>}
        {isSuccess && <p className="text-sm text-green-600">Tx confirmed!</p>}
      </CardContent>
    </Card>
  );
};

export default SwapTile;
