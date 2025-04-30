import { useState, useEffect } from "react";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Check, ChevronDown, Loader2, ArrowDownUp } from "lucide-react";
import { mainnet } from "viem/chains";

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
  HOOK: fetch all Coinchan tokens once - ROBUST VERSION
──────────────────────────────────────────────────────────────────────────── */
const useAllTokens = (): { tokens: TokenMeta[]; loading: boolean; error: string | null } => {
  const publicClient = usePublicClient({ chainId: mainnet.id });
  const chainId = useChainId();
  const [tokens, setTokens] = useState<TokenMeta[]>([ETH_TOKEN]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch coin count directly - don't use useReadContract to avoid cached results
  const fetchTokens = async () => {
    console.log("Starting token fetch process");
    setLoading(true);
    setError(null);
    
    if (!publicClient) {
      console.error("No public client available");
      setError("No wallet connection available");
      setLoading(false);
      return;
    }
    
    if (chainId !== mainnet.id) {
      console.log(`Connected to chain ${chainId}, need mainnet (1)`);
      setError("Please connect to Ethereum mainnet");
      setLoading(false);
      return;
    }
    
    try {
      // Step 1: Get the total number of coins
      console.log("Fetching coin count...");
      const totalCoins = await publicClient.readContract({
        address: CoinchanAddress,
        abi: CoinchanAbi,
        functionName: "getCoinsCount",
      });
      
      const total = Number(totalCoins);
      console.log(`Total coins in contract: ${total}`);
      
      if (total === 0) {
        console.log("No coins found in contract");
        setTokens([ETH_TOKEN]);
        setLoading(false);
        return;
      }
      
      // Step 2: Fetch all coins in batches to prevent timeout
      const BATCH_SIZE = 10;
      let allIds: bigint[] = [];
      
      for (let start = 0; start < total; start += BATCH_SIZE) {
        const end = Math.min(start + BATCH_SIZE - 1, total - 1);
        console.log(`Fetching coins from ${start} to ${end}...`);
        
        try {
          const batchIds = await publicClient.readContract({
            address: CoinchanAddress,
            abi: CoinchanAbi,
            functionName: "getCoins",
            args: [BigInt(start), BigInt(end)],
          }) as bigint[];
          
          console.log(`Retrieved ${batchIds.length} coins from batch ${start}-${end}:`, batchIds);
          allIds = [...allIds, ...batchIds];
        } catch (err) {
          console.error(`Failed to fetch coins batch ${start}-${end}:`, err);
          
          // Fallback to individual coin fetching for this batch
          for (let i = start; i <= end; i++) {
            try {
              const id = await publicClient.readContract({
                address: CoinchanAddress,
                abi: CoinchanAbi,
                functionName: "coins",
                args: [BigInt(i)],
              }) as bigint;
              
              console.log(`Retrieved individual coin at index ${i}:`, id);
              allIds.push(id);
            } catch (coinErr) {
              console.error(`Failed to get coin at index ${i}:`, coinErr);
            }
          }
        }
      }
      
      console.log(`Successfully retrieved ${allIds.length} coin IDs out of ${total} total`);
      
      if (allIds.length === 0) {
        console.log("No valid coin IDs retrieved");
        setTokens([ETH_TOKEN]);
        setLoading(false);
        return;
      }
      
      // Step 3: Get metadata for each coin ID in parallel batches
      const METADATA_BATCH_SIZE = 5;
      const allTokens: TokenMeta[] = [ETH_TOKEN];
      const uniqueIds = new Set<string>();
      
      for (let i = 0; i < allIds.length; i += METADATA_BATCH_SIZE) {
        const batch = allIds.slice(i, i + METADATA_BATCH_SIZE);
        const batchPromises = batch.map(async (id) => {
          const idStr = id.toString();
          
          // Skip duplicates
          if (uniqueIds.has(idStr)) {
            console.log(`Skipping duplicate coin ID: ${idStr}`);
            return null;
          }
          
          uniqueIds.add(idStr);
          
          try {
            console.log(`Fetching metadata for coin ID ${idStr}...`);
            
            // Try to get symbol and name in parallel
            const [symbolResult, nameResult] = await Promise.allSettled([
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
            ]);
            
            // Extract results with fallbacks
            const symbol = symbolResult.status === "fulfilled" 
              ? symbolResult.value as string 
              : `C#${idStr}`;
              
            const name = nameResult.status === "fulfilled" 
              ? nameResult.value as string 
              : `Coin #${idStr}`;
            
            console.log(`Metadata for ${idStr}: ${symbol} (${name})`);
            return { id, symbol, name } as TokenMeta;
          } catch (err) {
            console.error(`Failed to get metadata for coin ${idStr}:`, err);
            // Still return a token with fallback metadata
            return { 
              id, 
              symbol: `C#${idStr}`, 
              name: `Coin #${idStr}` 
            } as TokenMeta;
          }
        });
        
        const batchResults = await Promise.all(batchPromises);
        const validTokens = batchResults.filter(Boolean) as TokenMeta[];
        allTokens.push(...validTokens);
        
        // Update tokens incrementally as we go
        setTokens([...allTokens]);
      }
      
      console.log(`Final token list: ${allTokens.length} tokens`);
      setTokens(allTokens);
    } catch (err) {
      console.error("Fatal error in token loading:", err);
      setError("Failed to load tokens. Check console for details.");
    } finally {
      setLoading(false);
    }
  };

  // Run token fetching on component mount and when chain changes
  useEffect(() => {
    fetchTokens();
  }, [chainId, publicClient]);

  return { tokens, loading, error };
};

/* ────────────────────────────────────────────────────────────────────────────
  Token dropdown component using Shadcn UI
──────────────────────────────────────────────────────────────────────────── */
const TokenSelector = ({
  token,
  tokens,
  onSelect,
}: {
  token: TokenMeta;
  tokens: TokenMeta[];
  onSelect: (t: TokenMeta) => void;
}) => (
  <Popover>
    <PopoverTrigger asChild>
      <Button variant="ghost" size="sm" className="gap-1 px-2 text-base">
        {token.symbol}
        <ChevronDown className="h-4 w-4 opacity-60" />
      </Button>
    </PopoverTrigger>
    <PopoverContent side="bottom" align="start" className="p-0 w-48">
      <ScrollArea className="h-64">
        {tokens.length <= 1 ? (
          <div className="p-2 text-sm text-center text-gray-500">No tokens available</div>
        ) : (
          tokens.map((t) => (
            <button
              key={t.id?.toString() ?? "eth"}
              className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-muted"
              onClick={() => onSelect(t)}
            >
              <span>{t.symbol}</span>
              {t.symbol === token.symbol && <Check className="h-4 w-4" />}
            </button>
          ))
        )}
      </ScrollArea>
    </PopoverContent>
  </Popover>
);

/* ────────────────────────────────────────────────────────────────────────────
  SwapTile main component
──────────────────────────────────────────────────────────────────────────── */
export const SwapTile = () => {
  /* token list */
  const { tokens, loading, error: loadError } = useAllTokens();
  const [sellToken, setSellToken] = useState<TokenMeta>(ETH_TOKEN);
  const [buyToken, setBuyToken] = useState<TokenMeta | null>(null);
  
  // Add a debug state to show token count
  const tokenCount = tokens.length;

  // Default buy token once list loads
  useEffect(() => {
    if (!buyToken && tokens.length > 1) {
      console.log("Setting initial buyToken to:", tokens[1]);
      setBuyToken(tokens[1]);
    }
  }, [tokens, buyToken]);

  const flipTokens = () => {
    if (!buyToken) return;
    setSellToken(buyToken);
    setBuyToken(sellToken);
  };

  /* derived flags */
  // Use the same logic as your earlier version - require one token to be ETH
  const canSwap = sellToken && buyToken && (sellToken.id === null || buyToken.id === null);
  const isSellETH = sellToken.id === null;
  const coinId = (isSellETH ? buyToken?.id : sellToken.id) ?? 0n;

  /* user inputs */
  const [sellAmt, setSellAmt] = useState("");
  const [buyAmt, setBuyAmt] = useState("");
  const [txHash, setTxHash] = useState<`0x${string}`>();
  const [txError, setTxError] = useState<string | null>(null);

  /* wagmi hooks */
  const { address, isConnected } = useAccount();
  const { writeContractAsync, isPending, error } = useWriteContract();
  const { isSuccess } = useWaitForTransactionReceipt({ hash: txHash });
  const { switchChain } = useSwitchChain();
  const chainId = useChainId();

  /* on‑chain reserves */
  const poolId = computePoolId(coinId);
  const { data: rawReserves } = useReadContract({
    address: ZAAMAddress,
    abi: ZAAMAbi,
    functionName: "pools",
    args: [poolId],
    chainId: mainnet.id,
    query: {
      enabled: Boolean(canSwap && coinId),
    },
  });
  
  const reserves = rawReserves
    ? { reserve0: rawReserves[0], reserve1: rawReserves[1] }
    : undefined;

  /* allowance for token sales */
  const { data: isOperator } = useReadContract({
    address: CoinsAddress,
    abi: CoinsAbi,
    functionName: "isOperator",
    args: address && !isSellETH ? [address, ZAAMAddress] : undefined,
    chainId: mainnet.id,
    query: {
      enabled: Boolean(address && !isSellETH),
    },
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
        setBuyAmt(outUnits === 0n ? "" : formatUnits(outUnits, 18));
      } else {
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
        setSellAmt(inWei === 0n ? "" : formatEther(inWei));
      } else {
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

  const executeSwap = async () => {
    if (!canSwap || !reserves || !address || !sellAmt) return;
    setTxError(null);
    
    try {
      // Switch to mainnet if needed
      if (chainId !== mainnet.id) {
        try {
          await switchChain({ chainId: mainnet.id });
        } catch (err) {
          console.error("Failed to switch to Ethereum mainnet:", err);
          setTxError("Failed to switch to Ethereum mainnet");
          return;
        }
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
          chainId: mainnet.id,
        });
        setTxHash(hash);
      } else {
        const amountInUnits = parseUnits(sellAmt || "0", 18);
        
        // Approve ZAAM as operator if needed
        if (!isOperator) {
          try {
            await writeContractAsync({
              address: CoinsAddress,
              abi: CoinsAbi,
              functionName: "setOperator",
              args: [ZAAMAddress, true],
              chainId: mainnet.id,
            });
          } catch (err) {
            console.error("Failed to approve operator:", err);
            setTxError("Failed to approve the swap contract as operator");
            return;
          }
        }
        
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
          chainId: mainnet.id,
        });
        setTxHash(hash);
      }
    } catch (err) {
      console.error("Swap execution error:", err);
      setTxError(err instanceof Error ? err.message : "Unknown error during swap");
    }
  };

  /* UI */
  // Simple loading spinner like your earlier version
  if (loading)
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );

  // Streamlined UI similar to your earlier version
  return (
    <Card className="w-lg p-6 border-2 border-yellow-100 shadow-md rounded-xl">
      <CardContent className="p-1 flex flex-col space-y-1">
        {/* Debug info showing token count */}
        <div className="text-xs text-gray-500 mb-2">
          Available tokens: {tokenCount}
        </div>
        
        {/* Load error notification (minimal) */}
        {loadError && (
          <div className="p-2 mb-2 bg-red-50 border border-red-200 rounded text-sm text-red-600">
            {loadError}
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
              onChange={(e) => syncFromSell(e.target.value)}
              className="text-xl font-medium w-full focus:outline-none"
            />
          </div>
          
          {/* FLIP button */}
          <button
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 p-2 rounded-full shadow-xl bg-yellow-500 hover:bg-yellow-600 focus:bg-yellow-600 focus:outline-none focus:ring-2 focus:ring-yellow-400 active:scale-95 transition-all z-10"
            onClick={flipTokens}
          >
            <ArrowDownUp className="h-4 w-4 text-white" />
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
                onChange={(e) => syncFromBuy(e.target.value)}
                className="text-xl font-medium w-full focus:outline-none"
              />
            </div>
          )}
        </div>

        {/* Show simplified network indicator instead of blocking error */}
        {isConnected && chainId !== mainnet.id && (
          <div className="text-xs mt-1 px-1 text-yellow-600">
            Please connect to Ethereum mainnet (will auto-switch when swapping)
          </div>
        )}
        
        {/* Pool information - helpful addition */}
        {canSwap && reserves && (
          <div className="text-xs text-gray-500 flex justify-between px-1 mt-1">
            <span>Pool: {formatEther(reserves.reserve0).substring(0, 8)} ETH / {formatUnits(reserves.reserve1, 18).substring(0, 8)} {buyToken?.symbol}</span>
            <span>Fee: {Number(SWAP_FEE) / 100}%</span>
          </div>
        )}

        {/* ACTION BUTTON */}
        <Button
          onClick={executeSwap}
          disabled={!isConnected || !canSwap || isPending || !sellAmt}
          className="w-full text-lg mt-4"
        >
          {isPending ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Swapping…
            </span>
          ) : "Swap"}
        </Button>

        {/* Compact error handling */}
        {(error || txError) && (
          <div className="text-sm text-red-600 mt-2">{error?.message || txError}</div>
        )}
        
        {isSuccess && (
          <div className="text-sm text-green-600 mt-2">Transaction confirmed!</div>
        )}
      </CardContent>
    </Card>
  );
};

export default SwapTile;
