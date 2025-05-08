import { BuySell } from "./BuySell";
import { ClaimVested } from "./ClaimVested";
import { useEffect, useState, Component, ReactNode } from "react";
import {
  useAccount,
  usePublicClient,
  useWaitForTransactionReceipt,
} from "wagmi";
import { CoinchanAbi, CoinchanAddress } from "./constants/Coinchan";
import { CoinsAddress } from "./constants/Coins";
import { mainnet } from "viem/chains";
import { useCoinData } from "./hooks/metadata";

// Simple error boundary to prevent crashes
class ErrorBoundary extends Component<
  { children: ReactNode, fallback: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode, fallback: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error("Component Error:", error);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }

    return this.props.children;
  }
}

// Fallback component for BuySell when it crashes
const BuySellFallback = ({ tokenId, name, symbol }: { tokenId: bigint, name: string, symbol: string }) => {
  return (
    <div className="p-4 border border-red-300 bg-red-50 rounded-md">
      <h3 className="font-medium text-red-700">Trading temporarily unavailable</h3>
      <p className="text-sm text-red-600 mt-2">
        We're experiencing issues loading the trading interface for {name} [{symbol}].
        Please try again later.
      </p>
      <div className="mt-4 bg-white p-3 rounded-md text-sm">
        <p className="font-medium">Token Details:</p>
        <p>ID: {tokenId.toString()}</p>
        <p>Name: {name}</p>
        <p>Symbol: {symbol}</p>
      </div>
    </div>
  );
};

export const TradeView = ({
  tokenId,
  onBack,
}: {
  tokenId: bigint;
  onBack: () => void;
}) => {
  // Using our new hook to get coin data
  const { getDisplayValues } = useCoinData(tokenId);
  const { name = "Token", symbol = "TKN" } = getDisplayValues();
  
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: mainnet.id });

  const [isOwner, setIsOwner] = useState(false);
  const [txHash] = useState<`0x${string}`>();
  const { isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  // Safely check ownership with error handling
  useEffect(() => {
    if (!publicClient || !tokenId || !address) {
      console.log('TradeView: Missing prerequisites for ownership check');
      return;
    }

    let isMounted = true; // Guard against setting state after unmount
    
    const checkOwnership = async () => {
      try {
        console.log(`TradeView: Checking ownership for token ${tokenId.toString()}`);
        
        const lockup = await publicClient.readContract({
          address: CoinchanAddress,
          abi: CoinchanAbi,
          functionName: "lockups",
          args: [tokenId],
        }) as readonly [string, number, number, boolean, bigint, bigint];

        if (!isMounted) return;
        
        const [lockupOwner] = lockup;
        const isActualOwner = lockupOwner?.toLowerCase() === address.toLowerCase();
        console.log(`TradeView: Token ${tokenId.toString()} owner check: ${isActualOwner}`);
        setIsOwner(isActualOwner);
      } catch (err) {
        console.error(`TradeView: Failed to fetch lockup owner for token ${tokenId.toString()}:`, err);
        if (isMounted) setIsOwner(false);
      }
    };

    checkOwnership();
    
    // Cleanup function
    return () => {
      isMounted = false;
    };
  }, [publicClient, tokenId, address, isSuccess]);


  return (
    <div className="w-full max-w-lg mx-auto flex flex-col gap-4 px-2 py-4 sm:p-6 bg-[var(--card-background-light)] dark:bg-[var(--card-background-dark)] border border-[var(--card-border-light)] dark:border-[var(--card-border-dark)] rounded-[var(--radius-lg)] shadow-xl">
      <button
        onClick={onBack}
        className="text-sm self-start py-2 px-1 touch-manipulation text-[var(--primary-light)] hover:text-[oklch(from_var(--primary-light)_l_calc(l+0.1))] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-light)] rounded-[var(--radius-sm)]"
      >
        ⬅︎ Back to Explorer
      </button>

      <div className="flex flex-col items-start gap-2">
        <h2 className="text-lg sm:text-xl font-semibold">
          {name} [{symbol}]
        </h2>
        <p className="text-xs text-[var(--muted-foreground-light)] dark:text-[var(--muted-foreground-dark)] break-all">
          Contract: {CoinsAddress}
        </p>
      </div>
      
      {/* Wrap BuySell component in an ErrorBoundary to prevent crashes */}
      <ErrorBoundary fallback={<BuySellFallback tokenId={tokenId} name={name} symbol={symbol} />}>
        <BuySell tokenId={tokenId} name={name} symbol={symbol} />
      </ErrorBoundary>

      {/* Only show ClaimVested if the user is the owner */}
      {isOwner && (
        <div className="mt-4 sm:mt-6">
          <ErrorBoundary fallback={<p className="text-red-500">Vesting claim feature unavailable</p>}>
            <ClaimVested coinId={tokenId} />
          </ErrorBoundary>
        </div>
      )}
    </div>
  );
};