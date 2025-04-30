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
  HOOK: fetch all Coinchan tokens once
──────────────────────────────────────────────────────────────────────────── */
const useAllTokens = (): { tokens: TokenMeta[]; loading: boolean; error: string | null } => {
  const publicClient = usePublicClient({ chainId: mainnet.id });
  const chainId = useChainId();
  const { data: totalCoins } = useReadContract({
    address: CoinchanAddress,
    abi: CoinchanAbi,
    functionName: "getCoinsCount",
    chainId: mainnet.id,
  });

  const [tokens, setTokens] = useState<TokenMeta[]>([ETH_TOKEN]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Reset loading state when starting fresh
    setLoading(true);
    setError(null);
    
    // Check network first
    if (publicClient && chainId !== mainnet.id) {
      setError(`Please connect to Ethereum mainnet`);
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const total = Number(totalCoins ?? 0n);
        
        // If no tokens, just return ETH
        if (total === 0) {
          setTokens([ETH_TOKEN]);
          setLoading(false);
          return;
        }

        // Try to get coins
        let ids: bigint[] = [];
        try {
          ids = (await publicClient?.readContract({
            address: CoinchanAddress,
            abi: CoinchanAbi,
            functionName: "getCoins",
            args: [0n, BigInt(total)],
          })) as bigint[];
        } catch (err) {
          console.error("Failed to get all coins, using fallback", err);
          // Fallback to getting individual coins
          const individual: bigint[] = [];
          for (let i = 0; i < Math.min(total, 100); i++) {
            try {
              const id = (await publicClient?.readContract({
                address: CoinchanAddress,
                abi: CoinchanAbi,
                functionName: "coins",
                args: [BigInt(i)],
              })) as bigint;
              individual.push(id);
            } catch {
              // Skip individual errors
            }
          }
          ids = individual;
        }

        if (!ids.length) {
          setTokens([ETH_TOKEN]);
          setLoading(false);
          return;
        }

        // Get token metadata
        const metas = await Promise.all(
          ids.map(async (id) => {
            try {
              const [symbol, name] = (await Promise.all([
                publicClient?.readContract({
                  address: CoinsAddress,
                  abi: CoinsAbi,
                  functionName: "symbol",
                  args: [id],
                }).catch(() => `C#${id.toString()}`),
                publicClient?.readContract({
                  address: CoinsAddress,
                  abi: CoinsAbi,
                  functionName: "name",
                  args: [id],
                }).catch(() => `Coin #${id.toString()}`),
              ])) as [string, string];
              return { id, name, symbol } satisfies TokenMeta;
            } catch {
              return {
                id,
                name: `Coin #${id}`,
                symbol: `C#${id}`,
              } satisfies TokenMeta;
            }
          }),
        );

        // Set all tokens ensuring no duplicates
        const seen = new Set<string>(["null"]); // ETH is already added
        const uniqueTokens = [ETH_TOKEN];
        
        for (const token of metas) {
          const idStr = token.id?.toString() || "null";
          if (!seen.has(idStr)) {
            seen.add(idStr);
            uniqueTokens.push(token);
          }
        }

        setTokens(uniqueTokens);
      } catch (err) {
        console.error("Error in token loading:", err);
        // Don't set error here to allow UI to still show
      } finally {
        setLoading(false);
      }
    })();
  }, [totalCoins, publicClient, chainId]);

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
        {tokens.map((t) => (
          <button
            key={t.id?.toString() ?? "eth"}
            className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-muted"
            onClick={() => onSelect(t)}
          >
            <span>{t.symbol}</span>
            {t.symbol === token.symbol && <Check className="h-4 w-4" />}
          </button>
        ))}
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

  // Default buy token once list loads
  useEffect(() => {
    if (!buyToken && tokens.length > 1) setBuyToken(tokens[1]);
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
