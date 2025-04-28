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
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
const SWAP_FEE = 100n; // 1 % pool fee
const SLIPPAGE_BPS = 100n; // 1 % slippage tolerance
const DEADLINE_SEC = 20 * 60; // 20 minutes

const withSlippage = (amount: bigint) =>
  (amount * (10000n - SLIPPAGE_BPS)) / 10000n;

export interface TokenMeta {
  id: bigint | null; // null ⇒ ETH pseudo‑token
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

// x*y=k AMM with fee — forward (amountIn → amountOut)
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

// inverse — desired amountOut → required amountIn
const getAmountIn = (
  amountOut: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  swapFee: bigint,
) => {
  const numerator = reserveIn * amountOut * 10000n;
  const denominator = (reserveOut - amountOut) * (10000n - swapFee);
  return numerator / denominator + 1n; // +1 for ceiling rounding
};

/* ────────────────────────────────────────────────────────────────────────────
  HOOK: fetch all Coinchan tokens once
──────────────────────────────────────────────────────────────────────────── */
const useAllTokens = (): { tokens: TokenMeta[]; loading: boolean } => {
  const publicClient = usePublicClient({ chainId: 1 });
  const { data: totalCoins } = useReadContract({
    address: CoinchanAddress,
    abi: CoinchanAbi,
    functionName: "getCoinsCount",
    chainId: 1,
  });

  const [tokens, setTokens] = useState<TokenMeta[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const total = Number(totalCoins ?? 0n);
        if (total === 0) return setTokens([ETH_TOKEN]);

        const ids: bigint[] = (await publicClient.readContract({
          address: CoinchanAddress,
          abi: CoinchanAbi,
          functionName: "getCoins",
          args: [0n, BigInt(total)],
        })) as bigint[];

        const metas = await Promise.all(
          ids.map(async (id) => {
            try {
              const [symbol, name] = (await Promise.all([
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
              ])) as [string, string];
              return { id, name, symbol } satisfies TokenMeta;
            } catch {
              return {
                id,
                name: `Coin #${id}`,
                symbol: `C#${id}`,
              } satisfies TokenMeta;
            }
          }),
        );

        setTokens([ETH_TOKEN, ...metas]);
      } finally {
        setLoading(false);
      }
    })();
  }, [totalCoins, publicClient]);

  return { tokens, loading };
};

/* ────────────────────────────────────────────────────────────────────────────
  Token dropdown component
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
            key={t.id ?? -1n}
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
  const { tokens, loading } = useAllTokens();
  const [sellToken, setSellToken] = useState<TokenMeta>(ETH_TOKEN);
  const [buyToken, setBuyToken] = useState<TokenMeta | null>(null);

  // default buy token once list loads
  useEffect(() => {
    if (!buyToken && tokens.length > 1) setBuyToken(tokens[1]);
  }, [tokens, buyToken]);

  const flipTokens = () => {
    if (!buyToken) return;
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
  const [txHash, setTxHash] = useState<`0x${string}`>();

  /* wagmi hooks */
  const { address, isConnected } = useAccount();
  const { writeContractAsync, isPending, error } = useWriteContract();
  const { isSuccess } = useWaitForTransactionReceipt({ hash: txHash });
  const { switchChain } = useSwitchChain();
  const chainId = useChainId();

  /* on‑chain reserves */
  const poolId = computePoolId(coinId);
  const { data: reserves } = useReadContract({
    address: ZAAMAddress,
    abi: ZAAMAbi,
    functionName: "pools",
    args: [BigInt(poolId)],
    chainId: 1,
    query: {
      enabled: !!canSwap,
      select: ([r0, r1]) => ({ reserve0: r0, reserve1: r1 }),
    },
  });

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
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );

  return (
    <Card className="w-lg  p-6">
      {/* SELL panel */}
      <div className="group rounded-lg p-2 pb-6 focus-within:ring-2 focus-within:ring-primary flex flex-col gap-2">
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

      {/* flip button */}
      <div className="flex justify-center">
        <button
          className="p-2 rounded-full shadow-xl bg-yellow-500"
          onClick={flipTokens}
        >
          <ArrowDownUp className="h-4 w-4" />
        </button>
      </div>

      {/* BUY panel */}
      {buyToken && (
        <div className="group rounded-lg p-2 pb-6 focus-within:ring-2 focus-within:ring-primary flex flex-col gap-2">
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

      {/* ACTION BUTTON */}
      <Button
        onClick={executeSwap}
        disabled={!isConnected || !canSwap || isPending || !sellAmt}
        className="w-full text-lg"
      >
        {isPending ? "Swapping…" : "Swap"}
      </Button>

      {error && <p className="text-sm text-destructive">{error.message}</p>}
      {isSuccess && <p className="text-sm text-green-600">Tx confirmed!</p>}
    </Card>
  );
};

export default SwapTile;
