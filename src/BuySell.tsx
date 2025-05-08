import { useState, useMemo, useEffect, useCallback, useRef } from "react";
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
  zeroAddress,
} from "viem";
import { formatNumber } from "./lib/utils";
import { CoinsAbi, CoinsAddress } from "./constants/Coins";
import { ZAAMAbi, ZAAMAddress } from "./constants/ZAAM";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { mainnet } from "viem/chains";
import { handleWalletError } from "./utils";
import { useCoinData } from "./hooks/metadata";
import { formatImageURL, getAlternativeImageUrls } from "./hooks/metadata/use-global-coins-data";

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
  
  // Fetch coin data using our new hook
  const { coinData, marketCapEth, getDisplayValues } = useCoinData(tokenId);
  
  // Get display values with fallbacks
  const { name, symbol, description } = getDisplayValues();
  
  // We already have reserves in the coinData, no need for a separate fetch
  const reserves = coinData ? {
    reserve0: coinData.reserve0,
    reserve1: coinData.reserve1
  } : null;
  
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
    if (!reserves || !reserves.reserve0 || !reserves.reserve1) return "0";
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

      const poolKey = computePoolKey(tokenId);
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

      const poolKey = computePoolKey(tokenId);
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
  
  // Use the display name and symbol 
  const displayName = name || propName;
  const displaySymbol = symbol || propSymbol;
  
  // State for tracking image loading and errors
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [currentImageUrl, setCurrentImageUrl] = useState<string | null>(null);
  const alternativeUrlsRef = useRef<string[]>([]);
  const attemptedUrlsRef = useRef<Set<string>>(new Set());
  
  // Determine the best image URL to use
  useEffect(() => {
    if (coinData?.imageUrl) {
      const initialUrl = formatImageURL(coinData.imageUrl);
      setCurrentImageUrl(initialUrl);
      attemptedUrlsRef.current.add(initialUrl);
      alternativeUrlsRef.current = getAlternativeImageUrls(coinData.imageUrl);
    } else if (coinData?.metadata?.image) {
      const initialUrl = formatImageURL(coinData.metadata.image);
      setCurrentImageUrl(initialUrl);
      attemptedUrlsRef.current.add(initialUrl);
      alternativeUrlsRef.current = getAlternativeImageUrls(coinData.metadata.image);
    } else {
      setCurrentImageUrl(null);
      alternativeUrlsRef.current = [];
    }
    setImageLoaded(false);
    setImageError(false);
    // Reset attempted URLs when coinData changes, except for the new initialUrl
    const newAttempted = new Set<string>();
    if (currentImageUrl) newAttempted.add(currentImageUrl);
    attemptedUrlsRef.current = newAttempted;

  }, [coinData?.imageUrl, coinData?.metadata?.image]);
  
  // Handle image load error with fallback attempt
  const handleImageError = useCallback(() => {
    if (alternativeUrlsRef.current.length > 0) {
      const nextUrl = alternativeUrlsRef.current.find(url => !attemptedUrlsRef.current.has(url));
      if (nextUrl) {
        setCurrentImageUrl(nextUrl);
        attemptedUrlsRef.current.add(nextUrl);
        return;
      }
    }
    setImageError(true);
  }, []);

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* Coin Info Box */}
      {coinData && (
        <div className="flex items-start gap-4 p-4 bg-[var(--card-background-light)] dark:bg-[var(--card-background-dark)] border border-[var(--primary-light)] dark:border-[var(--primary-dark)] rounded-[var(--radius-lg)] shadow-lg">
          <div className="flex-shrink-0">
            <div className="w-16 h-16 relative">
              {!imageError && currentImageUrl ? (
                <img
                  key={currentImageUrl}
                  src={currentImageUrl}
                  alt={`${displaySymbol} logo`}
                  className={`absolute inset-0 w-full h-full rounded-full object-cover transition-opacity duration-200 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
                  onLoad={() => setImageLoaded(true)}
                  onError={handleImageError}
                  loading="lazy"
                  style={{ zIndex: 1 }}
                />
              ) : (
                 <div className="w-full h-full flex bg-[var(--secondary-light)] text-[var(--secondary-foreground-light)] justify-center items-center rounded-full font-semibold text-xl">
                  {displaySymbol?.slice(0, 3).toUpperCase() || "N/A"}
                </div>
              )}
               {/* Fallback/Loading state for image */}
              {(!currentImageUrl || !imageLoaded) && !imageError && (
                <div className="absolute inset-0 w-full h-full flex bg-[var(--secondary-light)] text-[var(--secondary-foreground-light)] justify-center items-center rounded-full">
                   {/* Optional: Simple spinner or placeholder */}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col flex-grow overflow-hidden">
            <div className="flex items-baseline space-x-2">
              <h3 className="text-lg font-medium truncate text-[var(--foreground-light)] dark:text-[var(--foreground-dark)]" title={displayName}>
                {displayName}
              </h3>
              <span className="text-sm text-[var(--muted-foreground-light)] dark:text-[var(--muted-foreground-dark)]">
                [{displaySymbol}]
              </span>
            </div>
            {description && (
              <p className="text-sm text-[var(--muted-foreground-light)] dark:text-[var(--muted-foreground-dark)] mt-1 overflow-y-auto max-h-20 scrollbar-thin scrollbar-thumb-[var(--border-light)] dark:scrollbar-thumb-[var(--border-dark)] scrollbar-track-transparent">
                {description}
              </p>
            )}
            <div className="mt-2 text-xs text-[var(--muted-foreground-light)] dark:text-[var(--muted-foreground-dark)]">
              {marketCapEth !== null && marketCapEth !== undefined && marketCapEth > 0 && (
                <div className="flex items-center gap-1">
                  <span className="text-[var(--foreground-light)] dark:text-[var(--foreground-dark)]">Est. Market Cap:</span>
                  <span>
                    {`${formatNumber(Number(marketCapEth))} ETH`}
                    <span className="text-[var(--muted-foreground-light)] dark:text-[var(--muted-foreground-dark)] ml-1">
                      {` (~$ ${(Number(marketCapEth) * 2000).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })})`}
                    </span>
                  </span>
                </div>
              )}
              {coinData?.metadata?.tokenURI && (
                <div className="mt-1">
                  <a
                    href={formatImageURL(coinData.metadata.tokenURI)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[var(--primary-light)] hover:text-[oklch(from_var(--primary-light)_l_calc(l+0.1))] dark:text-[var(--primary-dark)] dark:hover:text-[oklch(from_var(--primary-dark)_l_calc(l+0.1))] hover:underline"
                  >
                    View Token Metadata
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <Tabs value={tab} onValueChange={(value) => setTab(value as "buy" | "sell")} className="w-full">
        <TabsList className="grid w-full grid-cols-2 bg-[var(--secondary-light)] dark:bg-[var(--secondary-dark)] p-1 rounded-[var(--radius-md)] h-auto">
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
              <span className="text-sm">
                You will receive ~ {estimated} ETH
                {(estimated && parseFloat(estimated) > 0) && (
                  <span className="text-[var(--muted-foreground-light)] dark:text-[var(--muted-foreground-dark)] ml-1">
                    (~$ {(parseFloat(estimated) * 2000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                  </span>
                )}
              </span>
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
    </div>
  );
};