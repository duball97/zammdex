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
import { formatNumber } from "./lib/utils";
import { CoinsAbi, CoinsAddress } from "./constants/Coins";
import { ZAAMAbi, ZAAMAddress } from "./constants/ZAAM";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { mainnet } from "viem/chains";
import { useCoinMeta } from "./hooks/use-coin-meta";
import { DisplayTokenUri } from "./DisplayTokenUri";
import { useQuery } from "@tanstack/react-query";
import { handleWalletError } from "./utils";

// CheckTheChain contract ABI for fetching ETH price
const CheckTheChainAbi = [
  {
    inputs: [{ internalType: "string", name: "symbol", type: "string" }],
    name: "checkPrice",
    outputs: [
      { internalType: "uint256", name: "price", type: "uint256" },
      { internalType: "string", name: "priceStr", type: "string" }
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

// CheckTheChain contract address
const CheckTheChainAddress = "0x0000000000cDC1F8d393415455E382c30FBc0a84";

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
  name: propName,
  symbol: propSymbol,
}: {
  tokenId: bigint;
  name: string;
  symbol: string;
}) => {
  const [tab, setTab] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [txHash, setTxHash] = useState<`0x${string}`>();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { address, isConnected } = useAccount();
  const { writeContractAsync, isPending } = useWriteContract();
  const { isSuccess } = useWaitForTransactionReceipt({ hash: txHash });
  const { switchChain } = useSwitchChain();
  const chainId = useChainId();
  
  // Fetch token metadata from blockchain
  const { name, symbol, tokenUri } = useCoinMeta(tokenId);
  
  // Fetch metadata description from token URI
  const { data: tokenData } = useQuery({
    queryKey: ["token-metadata", tokenUri],
    enabled: !!(
      tokenUri &&
      (tokenUri.startsWith("http") || tokenUri.startsWith("ipfs://"))
    ),
    queryFn: async () => {
      let uri;
      if (tokenUri.startsWith("ipfs")) {
        uri = `https://content.wrappr.wtf/ipfs/${tokenUri.slice(7)}`;
      } else if (tokenUri.startsWith("http")) {
        uri = tokenUri;
      } else {
        throw new Error("Invalid token URI");
      }

      const response = await fetch(uri);
      const data = await response.json();
      return data;
    },
  });

  // fetch reserves
  const poolKey = computePoolKey(tokenId);
  const poolId = computePoolId(poolKey);
  const { data: reserves } = useReadContract({
    address: ZAAMAddress,
    abi: ZAAMAbi,
    functionName: "pools",
    args: [BigInt(poolId)],
    chainId: mainnet.id,
    query: {
      enabled: !!poolId,
      select: ([r0, r1]) => ({ reserve0: r0, reserve1: r1 }),
    },
  });
  
  // Fetch ETH price in USD from CheckTheChain
  const { data: ethPriceData } = useReadContract({
    address: CheckTheChainAddress,
    abi: CheckTheChainAbi,
    functionName: "checkPrice",
    args: ["WETH"],
    chainId: mainnet.id,
    query: {
      // Refresh every 60 seconds
      staleTime: 60_000,
    },
  });
  const { data: balance } = useReadContract({
    address: CoinsAddress,
    abi: CoinsAbi,
    functionName: "balanceOf",
    args: address ? [address, tokenId] : undefined,
    chainId: mainnet.id,
  });
  // fetch allowance / operator state
  const { data: isOperator } = useReadContract({
    address: CoinsAddress,
    abi: CoinsAbi,
    functionName: "isOperator",
    args: address ? [address, ZAAMAddress] : undefined,
    chainId: mainnet.id,
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
    
    // Clear any previous error message when starting a new transaction
    setErrorMessage(null);
    
    try {
      // Switch to mainnet if needed
      if (chainId !== mainnet.id) {
        await switchChain({ chainId: mainnet.id });
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
        chainId: mainnet.id,
      });
      setTxHash(hash);
    } catch (err) {
      // Use our utility to handle the error - only set error message for non-rejection errors
      const errorMsg = handleWalletError(err);
      if (errorMsg) {
        setErrorMessage(errorMsg);
      }
    }
  };

  // SELL using token → ETH
  const onSell = async () => {
    if (!reserves || !address) return;
    
    // Clear any previous error message when starting a new transaction
    setErrorMessage(null);
    
    try {
      // Switch to mainnet if needed
      if (chainId !== mainnet.id) {
        await switchChain({ chainId: mainnet.id });
      }
      
      const amountInUnits = parseUnits(amount || "0", 18);

      // ensure approval
      if (!isOperator) {
        try {
          await writeContractAsync({
            address: CoinsAddress,
            abi: CoinsAbi,
            functionName: "setOperator",
            args: [ZAAMAddress, true],
            chainId: mainnet.id,
          });
        } catch (approvalErr) {
          // Handle approval error separately
          const errorMsg = handleWalletError(approvalErr);
          if (errorMsg) {
            setErrorMessage(errorMsg);
          }
          // Exit early if there was an approval error
          return;
        }
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
        chainId: mainnet.id,
      });
      setTxHash(hash);
    } catch (err) {
      // Use our utility to handle the error - only set error message for non-rejection errors
      const errorMsg = handleWalletError(err);
      if (errorMsg) {
        setErrorMessage(errorMsg);
      }
    }
  };

  // Use the name and symbol from blockchain if available, otherwise fall back to props
  const displayName = name !== "N/A" ? name : propName;
  const displaySymbol = symbol !== "N/A" ? symbol : propSymbol;
  
  // Calculate market cap estimation (fixed supply: 21 million coins)
  const FIXED_SUPPLY = 21_000_000;
  
  // Calculate market cap in ETH
  const marketCapEth = useMemo(() => {
    if (!reserves || reserves.reserve0 === 0n || reserves.reserve1 === 0n) return null;
    
    // For an x*y=k AMM, the spot price is determined by the ratio of reserves
    // Price of token in ETH = reserve0 (ETH) / reserve1 (token)
    const pricePerTokenEth = Number(formatEther(reserves.reserve0)) / Number(formatUnits(reserves.reserve1, 18));
    
    // Market cap = price per token * total supply
    return pricePerTokenEth * FIXED_SUPPLY;
  }, [reserves]);
  
  // Calculate market cap in USD
  const marketCapUsd = useMemo(() => {
    if (!marketCapEth || !ethPriceData) return null;
    
    // Log the data for debugging
    console.log('ETH price data from CheckTheChain:', ethPriceData);
    
    // ethPriceData is a tuple [bigint, string] from CheckTheChain
    // Extract the price string (second element of the tuple)
    const priceStr = ethPriceData[1];
    
    // Parse the ETH price from the string
    const ethPriceUsd = parseFloat(priceStr);
    
    // Check if the parsing was successful
    if (isNaN(ethPriceUsd)) return null;
    
    // Market cap in USD = market cap in ETH * ETH price in USD
    return marketCapEth * ethPriceUsd;
  }, [marketCapEth, ethPriceData]);
  
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as "buy" | "sell")}>
      <div className="flex items-start gap-4 mb-4 p-4 bg-gray-50 rounded-lg">
        <div className="flex-shrink-0">
          <div className="w-16 h-16">
            <DisplayTokenUri tokenUri={tokenUri} symbol={displaySymbol} />
          </div>
        </div>
        <div className="flex flex-col flex-grow overflow-hidden">
          <div className="flex items-baseline space-x-2">
            <h3 className="text-lg font-medium truncate">{displayName}</h3>
            <span className="text-sm text-gray-500">[{displaySymbol}]</span>
          </div>
          {tokenData?.description ? (
            <p className="text-sm text-gray-600 mt-1 overflow-y-auto max-h-20">
              {tokenData.description}
            </p>
          ) : tokenUri !== "N/A" ? (
            <p className="text-sm text-gray-400 italic mt-1">Loading metadata...</p>
          ) : (
            <p className="text-sm text-gray-400 italic mt-1">No description available</p>
          )}
          
          {/* Market Cap Estimation */}
          <div className="mt-2 text-xs text-gray-500">
            {marketCapEth !== null && (
              <div className="flex items-center gap-1">
                <span className="text-gray-600">Est. Market Cap:</span>
                <span>{formatNumber(marketCapEth, 2)} ETH</span>
                {marketCapUsd !== null ? (
                  <span className="ml-1">(~${formatNumber(marketCapUsd, 0)})</span>
                ) : ethPriceData ? (
                  <span className="ml-1 text-yellow-500">(USD price processing...)</span>
                ) : (
                  <span className="ml-1 text-yellow-500">(ETH price unavailable)</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      
      <TabsList>
        <TabsTrigger value="buy">
          Buy {displayName} [{displaySymbol}]
        </TabsTrigger>
        <TabsTrigger value="sell">
          Sell {displayName} [{displaySymbol}]
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
            You will receive ~ {estimated} {displaySymbol}
          </span>
          <Button
            onClick={onBuy}
            disabled={!isConnected || isPending || !amount}
            variant="default"
          >
            {isPending ? "Buying…" : `Buy ${displaySymbol}`}
          </Button>
        </div>
      </TabsContent>

      <TabsContent value="sell">
        <div className="flex flex-col gap-2">
          <span className="text-sm text-gray-600">Using {displaySymbol}</span>
          <div className="relative">
            <Input
              type="number"
              placeholder={`Amount ${displaySymbol}`}
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
            {isPending ? "Selling…" : `Sell ${displaySymbol}`}
          </Button>
        </div>
      </TabsContent>

      {errorMessage && <p className="text-destructive text-sm">{errorMessage}</p>}
      {isSuccess && <p className="text-green-600 text-sm">Tx confirmed!</p>}
    </Tabs>
  );
};
