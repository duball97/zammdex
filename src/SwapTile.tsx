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

const computePoolId = (coinId: bigint): bigint => {
  const hex = keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "uint256 id0, uint256 id1, address token0, address token1, uint96 swapFee",
      ),
      [0n, coinId, zeroAddress, CoinsAddress, SWAP_FEE],
    ),
  );
  return BigInt(hex);
};

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

const getAmountIn = (
  amountOut: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  swapFee: bigint,
) => {
  const numerator = reserveIn * amountOut * 10000n;
  const denominator = (reserveOut - amountOut) * (10000n - swapFee);
  return numerator / denominator + 1n;
};

/* ────────────────────────────────────────────────────────────────────────────
  HOOK: fetch all Coinchan tokens
──────────────────────────────────────────────────────────────────────────── */
const useAllTokens = (): { tokens: TokenMeta[]; loading: boolean; error: Error | null } => {
  const publicClient = usePublicClient({ chainId: 1 });
  const [tokens, setTokens] = useState<TokenMeta[]>([ETH_TOKEN]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const { data: totalCoins, isLoading: isLoadingCount, isError: isErrorCount } = useReadContract({
    address: CoinchanAddress,
    abi: CoinchanAbi,
    functionName: "getCoinsCount",
    chainId: 1,
  });

  useEffect(() => {
    setError(null);
    if (isLoadingCount || isErrorCount || totalCoins === undefined || !publicClient) {
      if (isErrorCount) {
        setError(new Error("Failed to get token count"));
        setLoading(false);
      }
      return;
    }

    const fetchTokens = async () => {
      try {
        const total = Number(totalCoins || 0n);
        if (total === 0) {
          setTokens([ETH_TOKEN]);
          setLoading(false);
          return;
        }

        let ids: bigint[] = [];
        try {
          ids = (await publicClient.readContract({
            address: CoinchanAddress,
            abi: CoinchanAbi,
            functionName: "getCoins",
            args: [0n, BigInt(total - 1)],
          })) as bigint[];
        } catch {
          const individual: bigint[] = [];
          for (let i = 0; i < Math.min(total, 100); i++) {
            try {
              const coinId = (await publicClient.readContract({
                address: CoinchanAddress,
                abi: CoinchanAbi,
                functionName: "coins",
                args: [BigInt(i)],
              })) as bigint;
              individual.push(coinId);
            } catch {
              // skip
            }
          }
          ids = individual;
        }

        if (ids.length === 0) {
          setTokens([ETH_TOKEN]);
          setLoading(false);
          return;
        }

        const BATCH_SIZE = 10;
        const allMetas: TokenMeta[] = [];

        for (let i = 0; i < ids.length; i += BATCH_SIZE) {
          const batch = ids.slice(i, i + BATCH_SIZE);
          const promises = batch.map(async (id) => {
            const [symbol, name] = await Promise.all([
              publicClient.readContract({
                address: CoinsAddress,
                abi: CoinsAbi,
                functionName: "symbol",
                args: [id],
              }).catch(() => `C#${id.toString()}`),
              publicClient.readContract({
                address: CoinsAddress,
                abi: CoinsAbi,
                functionName: "name",
                args: [id],
              }).catch(() => `Coin #${id.toString()}`),
            ]) as [string, string];
            return { id, name, symbol } satisfies TokenMeta;
          });

          const results = await Promise.all(promises);
          allMetas.push(...results);
          setTokens((curr) => {
            const seen = new Set(curr.map(t => t.id?.toString()));
            const filtered = results.filter(t => !seen.has(t.id?.toString()));
            return [...curr, ...filtered];
          });
        }

        const unique = [ETH_TOKEN];
        const seenIds = new Set<string>(["eth"]);
        allMetas.forEach((t) => {
          const idStr = t.id?.toString();
          if (idStr && !seenIds.has(idStr)) {
            seenIds.add(idStr);
            unique.push(t);
          }
        });
        setTokens(unique);
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setLoading(false);
      }
    };

    fetchTokens();
  }, [totalCoins, publicClient, isLoadingCount, isErrorCount]);

  return { tokens, loading, error };
};

/* ────────────────────────────────────────────────────────────────────────────
  Custom Token dropdown
──────────────────────────────────────────────────────────────────────────── */
const TokenSelector = ({ token, tokens, onSelect }: {
  token: TokenMeta;
  tokens: TokenMeta[];
  onSelect: (t: TokenMeta) => void;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) document.addEventListener('mousedown', handler);
    else document.removeEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setIsOpen(o => !o)}
        className="inline-flex items-center gap-1 px-2 py-1 text-base rounded-md border border-yellow-200 hover:bg-yellow-50 focus:outline-none focus:ring-2 focus:ring-yellow-300"
      >
        {token.symbol}
        <ChevronDown className="h-4 w-4 opacity-60" />
      </button>
      {isOpen && (
        <div className="absolute right-0 z-50 mt-1 w-56 rounded-md border-2 border-yellow-200 bg-white shadow-lg overflow-auto max-h-60">
          {tokens.length <= 1 ? (
            <div className="p-3 text-sm text-gray-500 text-center">No tokens</div>
          ) : (
            <div className="py-1">
              {tokens.map(t => (
                <button
                  key={`tok-${t.id?.toString()||'eth'}`}
                  className="w-full text-left px-4 py-2 hover:bg-yellow-50 flex justify-between"
                  onClick={() => { onSelect(t); setIsOpen(false); }}
                >
                  <div>
                    <div className="font-medium">{t.symbol}</div>
                    {t.id !== null && <div className="text-xs text-gray-500 truncate max-w-[180px]">{t.name}</div>}
                  </div>
                  {t.symbol === token.symbol && <Check className="h-4 w-4 text-yellow-500" />}
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
  SwapTile Component
──────────────────────────────────────────────────────────────────────────── */
export const SwapTile = () => {
  const { tokens, loading, error: tokenLoadError } = useAllTokens();
  const [sellToken, setSellToken] = useState<TokenMeta>(ETH_TOKEN);
  const [buyToken, setBuyToken] = useState<TokenMeta | null>(null);

  useEffect(() => {
    if (!buyToken && tokens.length > 1) {
      setBuyToken(tokens[1]);
    }
  }, [tokens, buyToken]);

  const flipTokens = () => {
    if (!buyToken) return;
    setSellToken(buyToken);
    setBuyToken(sellToken);
  };

  const canSwap = Boolean(sellToken && buyToken);
  const isSellETH = sellToken.id === null;
  const coinId = isSellETH ? (buyToken?.id||0n) : sellToken.id!;

  const [sellAmt, setSellAmt] = useState("");
  const [buyAmt, setBuyAmt] = useState("");
  const [txHash, setTxHash] = useState<`0x${string}`>();

  const { address, isConnected } = useAccount();
  const { writeContractAsync, isPending, error } = useWriteContract();
  const { isSuccess } = useWaitForTransactionReceipt({ hash: txHash, enabled: Boolean(txHash) });
  const { switchChain } = useSwitchChain();
  const chainId = useChainId();

  const poolId = computePoolId(coinId);
  const { data: rawReserves } = useReadContract({
    address: ZAAMAddress,
    abi: ZAAMAbi,
    functionName: "pools",
    args: [poolId],
    chainId: 1,
  });
  const reserves = rawReserves ? { reserve0: rawReserves[0], reserve1: rawReserves[1] } : undefined;

  const { data: isOperator } = useReadContract({
    address: CoinsAddress,
    abi: CoinsAbi,
    functionName: "isOperator",
    args: address ? [address, ZAAMAddress] : undefined,
    chainId: 1,
  });

  const syncFromSell = (val: string) => {
    setSellAmt(val);
    if (!canSwap || !reserves) return setBuyAmt("");
    try {
      if (isSellETH) {
        const inWei = parseEther(val||"0");
        const out = getAmountOut(inWei, reserves.reserve0, reserves.reserve1, SWAP_FEE);
        setBuyAmt(formatUnits(out, 18));
      } else {
        const inUnits = parseUnits(val||"0", 18);
        const out = getAmountOut(inUnits, reserves.reserve1, reserves.reserve0, SWAP_FEE);
        setBuyAmt(formatEther(out));
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
        const outUnits = parseUnits(val||"0", 18);
        const inWei = getAmountIn(outUnits, reserves.reserve0, reserves.reserve1, SWAP_FEE);
        setSellAmt(formatEther(inWei));
      } else {
        const outWei = parseEther(val||"0");
        const inUnits = getAmountIn(outWei, reserves.reserve1, reserves.reserve0, SWAP_FEE);
        setSellAmt(formatUnits(inUnits, 18));
      }
    } catch {
      setSellAmt("");
    }
  };

  const nowSec = () => BigInt(Math.floor(Date.now()/1000));
  const executeSwap = async () => {
    if (!canSwap || !reserves || !address) return;
    if (chainId !== mainnet.id) await switchChain({ chainId: mainnet.id });
    const poolKey = computePoolKey(coinId);

    let hash: `0x${string}`;
    if (isSellETH) {
      const amtIn = parseEther(sellAmt||"0");
      const rawOut = getAmountOut(amtIn, reserves.reserve0, reserves.reserve1, SWAP_FEE);
      hash = await writeContractAsync({
        address: ZAAMAddress,
        abi: ZAAMAbi,
        functionName: "swapExactIn",
        args: [poolKey, amtIn, withSlippage(rawOut), true, address, nowSec()+BigInt(DEADLINE_SEC)],
        value: amtIn,
        chainId: 1,
      });
    } else {
      const amtIn = parseUnits(sellAmt||"0", 18);
      if (!isOperator) {
        await writeContractAsync({ address: CoinsAddress, abi: CoinsAbi, functionName: "setOperator", args: [ZAAMAddress, true], chainId: 1 });
      }
      const rawOut = getAmountOut(amtIn, reserves.reserve1, reserves.reserve0, SWAP_FEE);
      hash = await writeContractAsync({
        address: ZAAMAddress,
        abi: ZAAMAbi,
        functionName: "swapExactIn",
        args: [poolKey, amtIn, withSlippage(rawOut), false, address, nowSec()+BigInt(DEADLINE_SEC)],
        chainId: 1,
      });
    }
    setTxHash(hash);
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center p-8 gap-2">
      <div className="flex items-center"><Loader2 className="h-5 w-5 animate-spin text-yellow-500"/><span className="ml-2 font-medium">Loading tokens...</span></div>
      <p className="text-sm text-muted-foreground">Please wait while we fetch available tokens</p>
    </div>
  );

  return (
    <Card className="w-lg p-6 border-2 border-yellow-100 shadow-md rounded-xl">
      <CardContent className="p-1 flex flex-col space-y-1">
        {tokenLoadError && (
          <div className="mb-3 p-3 text-sm text-red-600 bg-red-50 rounded-lg border border-red-200">
            <p className="font-medium">Error loading tokens</p>
            <p className="text-xs mt-1">{tokenLoadError.message}</p>
          </div>
        )}
        {tokens.length <= 1 && !loading && !tokenLoadError && (
          <div className="mb-3 p-3 text-sm text-yellow-700 bg-yellow-50 rounded-lg border border-yellow-200">
            <p className="font-medium">No tokens found</p>
            <p className="text-xs mt-1">Only ETH is available for swapping.</p>
          </div>
        )}
        {tokens.length > 1 && !tokenLoadError && (
          <div className="mb-3 p-3 text-sm text-green-700 bg-green-50 rounded-lg border border-green-200 flex items-center justify-between">
            <p className="font-medium">Ready to swap</p>
            <span className="text-xs py-1 px-2 bg-green-100 rounded-full text-green-800 font-medium">{tokens.length-1} tokens</span>
          </div>
        )}

        {/* SELL / FLIP / BUY */}
        <div className="relative flex flex-col">
          <div className="border-2 border-yellow-300 rounded-t-2xl p-2 pb-4 flex flex-col gap-2 focus-within:ring-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Sell</span>
              <TokenSelector token={sellToken} tokens={tokens} onSelect={setSellToken} />
            </div>
            <input type="number" min="0" step="any" placeholder="0.0" value={sellAmt} onChange={e => syncFromSell(e.currentTarget.value)} className="text-xl font-medium w-full focus:outline-none"/>
          </div>
          <button onClick={flipTokens} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 p-2 rounded-full bg-yellow-500 hover:bg-yellow-600 focus:outline-none focus:ring-2 focus:ring-yellow-400 active:scale-95 transition-all z-10">
            <ArrowDownUp className="h-4 w-4" />
          </button>
          {buyToken && (
            <div className="border-2 border-yellow-300 rounded-b-2xl p-2 pt-3 flex flex-col gap-2 focus-within:ring-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Buy</span>
                <TokenSelector token={buyToken} tokens={tokens} onSelect={setBuyToken} />
              </div>
              <input type="number" min="0" step="any" placeholder="0.0" value={buyAmt} onChange={e => syncFromBuy(e.currentTarget.value)} className="text-xl font-medium w-full focus:outline-none"/>
            </div>
          )}
        </div>

        <Button onClick={executeSwap} disabled={!isConnected || !canSwap || isPending || !sellAmt} className="w-full text-lg mt-4">
          {isPending ? "Swapping…" : "Swap"}
        </Button>

        {error && <p className="text-sm text-destructive">{error.message}</p>}
        {isSuccess && <p className="text-sm text-green-600">Tx confirmed!</p>}
      </CardContent>
    </Card>
  );
};

export default SwapTile;
