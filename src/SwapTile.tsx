import { useState, useEffect } from "react";
import {
  useWriteContract,
  useWaitForTransactionReceipt,
  useAccount,
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
import { Loader2, ArrowDownUp } from "lucide-react";
import { mainnet } from "viem/chains";
import { DisplayTokenUri } from "./DisplayTokenUri";

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
}

const ETH_TOKEN: TokenMeta = {
  id: null,
  name: "Ether",
  symbol: "ETH",
  tokenUri: "https://ethereum.org/static/6b935ac0e6194247347855dc3d328e83/13c43/eth-diamond-black.png", // Ethereum logo
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
  HOOK: Simplified approach to fetch all tokens with tokenUri
──────────────────────────────────────────────────────────────────────────── */
const useAllTokens = () => {
  const publicClient = usePublicClient({ chainId: mainnet.id });
  const [tokens, setTokens] = useState<TokenMeta[]>([ETH_TOKEN]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

        // Step 3: Get metadata for each coin including tokenUri
        const tokenPromises = coinIds.map(async (id) => {
          try {
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
                functionName: "tokenURI", // Added tokenURI fetch
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

            return { id, symbol, name, tokenUri } as TokenMeta;
          } catch (err) {
            console.error(`Failed to get metadata for coin ${id}:`, err);
            return { 
              id, 
              symbol: `C#${id.toString()}`, 
              name: `Coin #${id.toString()}`,
              tokenUri: "" 
            } as TokenMeta;
          }
        });

        console.log("Fetching token metadata...");
        const tokenResults = await Promise.all(tokenPromises);
        const allTokens = [ETH_TOKEN, ...tokenResults];
        
        console.log(`Final token list has ${allTokens.length} tokens`);
        setTokens(allTokens);
      } catch (err) {
        console.error("Error fetching tokens:", err);
        setError("Failed to load tokens");
      } finally {
        setLoading(false);
      }
    };

    fetchTokens();
  }, [publicClient]);

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
  
  return (
    <div className="relative">
      {/* Selected token display with thumbnail */}
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 cursor-pointer bg-transparent border border-yellow-200 rounded-md px-2 py-1 hover:bg-yellow-50"
      >
        <div className="w-6 h-6 flex-shrink-0">
          {selectedToken.tokenUri ? (
            <DisplayTokenUri tokenUri={selectedToken.tokenUri} symbol={selectedToken.symbol} />
          ) : (
            <div className="w-6 h-6 flex bg-yellow-500 text-white justify-center items-center rounded-full text-xs">
              {selectedToken.symbol?.slice(0, 2)}
            </div>
          )}
        </div>
        <span>{selectedToken.symbol}</span>
        <svg className="w-4 h-4 ml-1" viewBox="0 0 24 24" stroke="currentColor" fill="none">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
        </svg>
      </div>
      
      {/* Dropdown list with thumbnails */}
      {isOpen && (
        <div className="absolute z-20 mt-1 w-48 max-h-64 overflow-y-auto bg-white border border-yellow-200 shadow-lg rounded-md">
          {tokens.map((token) => (
            <div 
              key={token.id?.toString() ?? "eth"}
              onClick={() => handleSelect(token)}
              className={`flex items-center gap-2 p-2 hover:bg-yellow-50 cursor-pointer ${
                (token.id === null && selectedValue === "eth") || 
                (token.id !== null && token.id.toString() === selectedValue)
                  ? "bg-yellow-100"
                  : ""
              }`}
            >
              <div className="w-6 h-6 flex-shrink-0">
                {token.tokenUri ? (
                  <DisplayTokenUri tokenUri={token.tokenUri} symbol={token.symbol} />
                ) : (
                  <div className="w-6 h-6 flex bg-yellow-500 text-white justify-center items-center rounded-full text-xs">
                    {token.symbol?.slice(0, 2)}
                  </div>
                )}
              </div>
              <span>{token.symbol}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* ────────────────────────────────────────────────────────────────────────────
  SwapTile main component
──────────────────────────────────────────────────────────────────────────── */
export const SwapTile = () => {
  const { tokens, loading, error: loadError } = useAllTokens();
  const [sellToken, setSellToken] = useState<TokenMeta>(ETH_TOKEN);
  const [buyToken, setBuyToken] = useState<TokenMeta | null>(null);
  
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

  // Handle token selection
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
    setSellToken(buyToken);
    setBuyToken(sellToken);
  };

  /* derived flags */
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
  const { writeContractAsync, isPending, error: writeError } = useWriteContract();
  const { isSuccess } = useWaitForTransactionReceipt({ hash: txHash });
  const { switchChain } = useSwitchChain();
  const chainId = useChainId();
  
  /* Calculate pool reserves */
  const [reserves, setReserves] = useState<{ reserve0: bigint, reserve1: bigint } | null>(null);

  // Fetch reserves directly
  useEffect(() => {
    const fetchReserves = async () => {
      if (!canSwap || !coinId || coinId === 0n || !publicClient) return;
      
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
  }, [coinId, canSwap, publicClient]);

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
    if (!canSwap || !reserves || !address || !sellAmt || !publicClient) return;
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
        if (isOperator === false) {
          try {
            await writeContractAsync({
              address: CoinsAddress,
              abi: CoinsAbi,
              functionName: "setOperator",
              args: [ZAAMAddress, true],
              chainId: mainnet.id,
            });
            setIsOperator(true);
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
        {/* Debug info showing token count */}
        <div className="text-xs text-gray-500 mb-2">
          Available tokens: {tokenCount} (ETH + {tokenCount - 1} coins)
        </div>
        
        {/* Load error notification */}
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
                selectedToken={sellToken}
                tokens={tokens}
                onSelect={handleSellTokenSelect}
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
                  selectedToken={buyToken}
                  tokens={tokens}
                  onSelect={handleBuyTokenSelect}
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

        {/* Network indicator */}
        {isConnected && chainId !== mainnet.id && (
          <div className="text-xs mt-1 px-1 text-yellow-600">
            Please connect to Ethereum mainnet (will auto-switch when swapping)
          </div>
        )}
        
        {/* Pool information */}
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

        {/* Error handling */}
        {(writeError || txError) && (
          <div className="text-sm text-red-600 mt-2">{writeError?.message || txError}</div>
        )}
        
        {/* Success message */}
        {isSuccess && (
          <div className="text-sm text-green-600 mt-2">Transaction confirmed!</div>
        )}
      </CardContent>
    </Card>
  );
};

export default SwapTile;
