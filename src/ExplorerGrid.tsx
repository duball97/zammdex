import { CoinCard } from "./components/CoinCard";
import { type CoinData } from "./hooks/metadata";
import { Loader2 } from "lucide-react";

// Default page size
const PAGE_SIZE = 20;

export const ExplorerGrid = ({
  coins,
  total,
  canPrev,
  canNext,
  onPrev,
  onNext,
  onTrade,
  isLoading = false,
  currentPage = 1,
  totalPages = 1,
}: {
  coins: CoinData[];
  total: number;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onTrade: (id: bigint) => void;
  isLoading?: boolean;
  currentPage?: number;
  totalPages?: number;
}) => {
  // Debug: Log coin data for troubleshooting
  console.log(`ExplorerGrid rendering with ${coins.length} coins, page ${currentPage}/${totalPages}`);
  
  // Check if we have metadata and images
  const coinsWithMetadata = coins.filter(coin => coin.metadata !== null).length;
  const coinsWithImages = coins.filter(coin => coin.imageUrl !== null).length;
  console.log(`ExplorerGrid - Coins with metadata: ${coinsWithMetadata}/${coins.length}, Coins with images: ${coinsWithImages}/${coins.length}`);
  
  // Log detailed data about the first few coins
  if (coins.length > 0) {
    const sampleSize = Math.min(3, coins.length);
    for (let i = 0; i < sampleSize; i++) {
      const coin = coins[i];
      console.log(`Coin ${i+1} (ID: ${coin.coinId.toString()})`, {
        name: coin.name,
        symbol: coin.symbol,
        tokenURI: coin.tokenURI,
        hasMetadata: coin.metadata !== null,
        metadata: coin.metadata ? {
          name: coin.metadata.name,
          symbol: coin.metadata.symbol,
          image: coin.metadata.image
        } : null,
        imageUrl: coin.imageUrl
      });
    }
  }

  // Define button styles using CSS vars
  const buttonBase = "px-4 py-1.5 rounded-[var(--radius-md)] text-sm font-medium transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";
  const activeButtonStyle = `${buttonBase} bg-[var(--secondary-light)] border border-[var(--border-light)] text-[var(--secondary-foreground-light)] hover:bg-[var(--border-light)] hover:text-[var(--foreground-light)] focus-visible:outline-[var(--ring-light)]`;
  const disabledButtonStyle = `${buttonBase} bg-transparent border border-transparent text-[var(--muted-foreground-light)] opacity-50 cursor-not-allowed`;

  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-4">
        {/* Style title */}
        <h2 className="text-lg sm:text-xl font-semibold text-[var(--foreground-light)] dark:text-[var(--foreground-dark)]">
          {total === 0
            ? "NO COINS DEPLOYED"
            : total === 1
              ? "1 COIN DEPLOYED"
              : `${total} COINS DEPLOYED`}
        </h2>
        
        {/* Style loading indicator */}
        {isLoading && (
          <div className="flex items-center text-[var(--primary-light)] dark:text-[var(--primary-dark)]">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            <span className="text-sm font-medium">Loading...</span>
          </div>
        )}
      </div>

      {/* Increase grid gap */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 sm:gap-6 min-h-[300px]">
        {coins.map((coin) => (
          <div 
            key={coin.coinId.toString()} 
            className={`transition-opacity duration-300 ${isLoading ? "opacity-50 pointer-events-none" : "opacity-100"}`}
          >
            <CoinCard coin={coin} onTrade={onTrade} />
          </div>
        ))}
        
        {/* Style skeleton loaders */}
        {coins.length === 0 && total > 0 && Array.from({ length: Math.min(total, PAGE_SIZE) }).map((_, index) => (
          <div key={`skeleton-${index}`} className="border border-[var(--card-border-light)] rounded-[var(--radius-lg)] bg-[var(--card-background-light)] w-full h-40 sm:h-48 animate-pulse"></div>
        ))}
      </div>

      {/* Style pagination buttons */}
      <div className="pagination-buttons flex justify-between items-center mt-6 mb-4">
        <button
          onClick={onPrev}
          disabled={!canPrev || isLoading}
          className={`${!canPrev || isLoading ? disabledButtonStyle : activeButtonStyle}`}
        >
          Previous
        </button>
        
        {/* Style page info text */}
        {total > 0 && (
          <span className="text-sm text-[var(--muted-foreground-light)] dark:text-[var(--muted-foreground-dark)]">
            Page {currentPage} of {totalPages}
          </span>
        )}
        
        <button
          onClick={onNext}
          disabled={!canNext || isLoading}
          className={`${!canNext || isLoading ? disabledButtonStyle : activeButtonStyle}`}
        >
          Next
        </button>
      </div>
    </div>
  );
};