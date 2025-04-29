import { useState, useMemo } from "react";
import {
  useWriteContract,
  useWaitForTransactionReceipt,
  useAccount,
  useReadContract,
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
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { mainnet } from "viem/chains";

const SWAP_FEE = 100n; // 1 % pool fee
const SLIPPAGE_BPS = 100n; // 100 basis points = 1 %
const DEADLINE_SEC = 20 * 60; // 20 minutes

// apply slippage tolerance to an amount
const withSlippage = (amount: bigint) =>
  (amount * (10000n - SLIPPAGE_BPS)) / 10000n;

type PoolKey = {
  id0: bigint;
  id1: bigint;
  token0: `0x${string}`;
  token1: `0x${string}`;
  swapFee: bigint;
};

const computePoolKey = (coinId: bigint): PoolKey => ({
  id0: 0n,
  id1: coinId,
  token0: zeroAddress,
  token1: CoinsAddress,
  swapFee: SWAP_FEE,
});

const computePoolId = (key: PoolKey): `0x${string}` =>
  keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "uint256 id0, uint256 id1, address token0, address token1, uint96 swapFee",
      ),
      [key.id0, key.id1, key.token0, key.token1, key.swapFee],
    ),
  );

// Unchanged getAmountOut from x*y invariants
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

export const BuySell = ({
  tokenId,
  name,
  symbol,
}: {
  tokenId: bigint;
  name: string;
  symbol: string;
}) => {
  const [tab, setTab] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [txHash, setTxHash] = useState<`0x${string}`>();

  const { address, isConnected } = useAccount();
  const { writeContractAsync, isPending, error } = useWriteContract();
  const { isSuccess } = useWaitForTransactionReceipt({ hash: txHash });
  const { switchChain } = useSwitchChain();
  const chainId = useChainId();

  // fetch reserves
  const poolKey = computePoolKey(tokenId);
  const poolId = computePoolId(poolKey);
  const { data: reserves } = useReadContract({
    address: ZAAMAddress,
    abi: ZAAMAbi,
    functionName: "pools",
    args: [BigInt(poolId)],
    chainId: 1,
    query: {
      enabled: !!poolId,
      select: ([r0, r1]) => ({ reserve0: r0, reserve1: r1 }),
    },
  });
  const { data: balance } = useReadContract({
    address: CoinsAddress,
    abi: CoinsAbi,
    functionName: "balanceOf",
    args: address ? [address, tokenId] : undefined,
    chainId: 1,
  });
  // fetch allowance / operator state
  const { data: isOperator } = useReadContract({
    address: CoinsAddress,
    abi: CoinsAbi,
    functionName: "isOperator",
    args: address ? [address, ZAAMAddress] : undefined,
    chainId: 1,
  });

  const nowSec = () => BigInt(Math.floor(Date.now() / 1000));

  // calculate the slippage‐adjusted estimate shown in the UI
  const estimated = useMemo(() => {
    if (!reserves) return "0";
    try {
      if (tab === "buy") {
        const inWei = parseEther(amount || "0");
        const rawOut = getAmountOut(
          inWei,
          reserves.reserve0,
          reserves.reserve1,
          SWAP_FEE,
        );
        const minOut = withSlippage(rawOut);
        return formatUnits(minOut, 18);
      } else {
        const inUnits = parseUnits(amount || "0", 18);
        const rawOut = getAmountOut(
          inUnits,
          reserves.reserve1,
          reserves.reserve0,
          SWAP_FEE,
        );
        const minOut = withSlippage(rawOut);
        return formatEther(minOut);
      }
    } catch {
      return "0";
    }
  }, [amount, reserves, tab]);

  // BUY using ETH → token
  const onBuy = async () => {
    if (!reserves || !address) return;
    if (chainId !== mainnet.id) {
      switchChain({ chainId: mainnet.id });
    }
    const amountInWei = parseEther(amount || "0");
    const rawOut = getAmountOut(
      amountInWei,
      reserves.reserve0,
      reserves.reserve1,
      SWAP_FEE,
    );
    const amountOutMin = withSlippage(rawOut);
    const deadline = nowSec() + BigInt(DEADLINE_SEC);

    const hash = await writeContractAsync({
      address: ZAAMAddress,
      abi: ZAAMAbi,
      functionName: "swapExactIn",
      args: [poolKey, amountInWei, amountOutMin, true, address, deadline],
      value: amountInWei,
      chainId: 1,
    });
    setTxHash(hash);
  };

  // SELL using token → ETH
  const onSell = async () => {
    if (!reserves || !address) return;
    if (chainId !== mainnet.id) {
      await switchChain({ chainId: mainnet.id });
    }
    const amountInUnits = parseUnits(amount || "0", 18);

    // ensure approval
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
    const amountOutMin = withSlippage(rawOut);
    const deadline = nowSec() + BigInt(DEADLINE_SEC);

    const hash = await writeContractAsync({
      address: ZAAMAddress,
      abi: ZAAMAbi,
      functionName: "swapExactIn",
      args: [poolKey, amountInUnits, amountOutMin, false, address, deadline],
      chainId: 1,
    });
    setTxHash(hash);
  };

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as "buy" | "sell")}>
      <TabsList>
        <TabsTrigger value="buy">
          Buy {name} [{symbol}]
        </TabsTrigger>
        <TabsTrigger value="sell">
          Sell {name} [{symbol}]
        </TabsTrigger>
      </TabsList>

      <TabsContent value="buy">
        <div className="flex flex-col gap-2">
          <span className="text-sm text-gray-600">Using ETH</span>
          <Input
            type="number"
            placeholder="Amount ETH"
            value={amount}
            min="0"
            step="any"
            onChange={(e) => setAmount(e.currentTarget.value)}
          />
          <span className="text-sm">
            You will receive ~ {estimated} {symbol}
          </span>
          <Button
            onClick={onBuy}
            disabled={!isConnected || isPending || !amount}
            variant="default"
          >
            {isPending ? "Buying…" : `Buy ${symbol}`}
          </Button>
        </div>
      </TabsContent>

      <TabsContent value="sell">
        <div className="flex flex-col gap-2">
          <span className="text-sm text-gray-600">Using {symbol}</span>
          <div className="relative">
            <Input
              type="number"
              placeholder={`Amount ${symbol}`}
              value={amount}
              min="0"
              step="any"
              onChange={(e) => setAmount(e.currentTarget.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm">You will receive ~ {estimated} ETH</span>
            {balance !== undefined ? (
              <button
                className="self-end text-sm text-gray-600"
                onClick={() => setAmount(formatUnits(balance, 18))}
              >
                MAX ({formatUnits(balance, 18)})
              </button>
            ) : (
              <button
                className="self-end text-sm text-gray-600"
                disabled={!balance}
              >
                MAX
              </button>
            )}
          </div>
          <Button
            onClick={onSell}
            disabled={!isConnected || isPending || !amount}
            variant="outline"
          >
            {isPending ? "Selling…" : `Sell ${symbol}`}
          </Button>
        </div>
      </TabsContent>

      {error && <p className="text-destructive text-sm">{error.message}</p>}
      {isSuccess && <p className="text-green-600 text-sm">Tx confirmed!</p>}
    </Tabs>
  );
};
