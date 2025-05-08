import { useState, useMemo } from "react";
import { ExplorerGrid } from "./ExplorerGrid";
import { TradeView } from "./TradeView";
import { usePagedCoins, type CoinData } from "./hooks/metadata";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

// Page size for pagination
const PAGE_SIZE = 20;

// Define sort types
type SortOrder = 'default' | 'random';

export const Coins = () => {
  // Use our new paged coins hook for efficient data fetching
  const {
    coins: fetchedCoins,
    total,
    page,
    totalPages,
    hasNextPage,
    hasPreviousPage,
    goToNextPage,
    goToPreviousPage,
    isLoading
  } = usePagedCoins(PAGE_SIZE);
  
  // Which coin is being traded
  const [selectedTokenId, setSelectedTokenId] = useState<bigint | null>(null);
  const [filterTerm, setFilterTerm] = useState<string>("");
  const [sortOrder, setSortOrder] = useState<SortOrder>('default');
  
  // Event handlers
  const openTrade = (id: bigint) => setSelectedTokenId(id);
  const closeTrade = () => setSelectedTokenId(null);
  
  // Memoize the filtered and sorted coins
  const processedCoins = useMemo(() => {
    let coinsToProcess: CoinData[] = [...fetchedCoins];

    // Apply filter
    if (filterTerm) {
      coinsToProcess = coinsToProcess.filter((coin: CoinData) =>
        coin.name?.toLowerCase().includes(filterTerm.toLowerCase()) || 
        coin.symbol?.toLowerCase().includes(filterTerm.toLowerCase())
      );
    }

    // Apply sort
    if (sortOrder === 'random') {
      // Simple shuffle algorithm (Fisher-Yates)
      for (let i = coinsToProcess.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [coinsToProcess[i], coinsToProcess[j]] = [coinsToProcess[j], coinsToProcess[i]];
      }
    }
    // 'default' sort is the order from the hook, which might be 'most recent' implicitly

    return coinsToProcess;
  }, [fetchedCoins, filterTerm, sortOrder]);
  
  // If a token is selected, show the trade view
  if (selectedTokenId !== null) {
    return <TradeView tokenId={selectedTokenId} onBack={closeTrade} />;
  }
  
  // Calculate offset for display purposes
  const offset = page * PAGE_SIZE;
  
  // Log data to help with debugging
  console.log(`Coins component rendering: ${fetchedCoins.length} coins on page ${page + 1} of ${totalPages}`);
  
  // Check if we have metadata in the coins
  const coinsWithMetadata = fetchedCoins.filter(coin => coin.metadata !== null).length;
  const coinsWithImages = fetchedCoins.filter(coin => coin.imageUrl !== null).length;
  console.log(`Coins with metadata: ${coinsWithMetadata}/${fetchedCoins.length}, Coins with images: ${coinsWithImages}/${fetchedCoins.length}`);
  
  // Log the first coin data to help debug
  if (fetchedCoins.length > 0) {
    console.log('First coin data:', {
      coinId: fetchedCoins[0].coinId.toString(),
      tokenURI: fetchedCoins[0].tokenURI,
      name: fetchedCoins[0].name,
      symbol: fetchedCoins[0].symbol,
      hasMetadata: fetchedCoins[0].metadata !== null,
      hasImage: fetchedCoins[0].imageUrl !== null,
      imageUrl: fetchedCoins[0].imageUrl,
    });
  }
  
  // Show the explorer grid
  return (
    <>
      {/* Filter and Sort Controls */}
      <div className="mb-4 p-4 bg-[var(--card-background-light)] dark:bg-[var(--card-background-dark)] border border-[var(--card-border-light)] dark:border-[var(--card-border-dark)] rounded-[var(--radius-lg)] shadow-sm">
        <div className="flex flex-col sm:flex-row gap-4">
          <Input 
            type="text"
            placeholder="Filter by name or symbol..."
            value={filterTerm}
            onChange={(e) => setFilterTerm(e.target.value)}
            className="w-full sm:flex-grow bg-[var(--input-background-light)] dark:bg-[var(--input-background-dark)] text-[var(--input-foreground-light)] dark:text-[var(--input-foreground-dark)] border-[var(--input-border-light)] dark:border-[var(--input-border-dark)] rounded-[var(--radius-md)]"
          />
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-sm text-[var(--muted-foreground-light)] dark:text-[var(--muted-foreground-dark)]">Sort by:</span>
            <Button 
              variant={sortOrder === 'default' ? 'default' : 'outline'}
              onClick={() => setSortOrder('default')}
              className="text-xs h-9"
            >
              Default
            </Button>
            <Button 
              variant={sortOrder === 'random' ? 'default' : 'outline'}
              onClick={() => setSortOrder('random')}
              className="text-xs h-9"
            >
              Random
            </Button>
          </div>
        </div>
      </div>

      <div className="text-sm text-[var(--muted-foreground-light)] dark:text-[var(--muted-foreground-dark)] text-center mb-3">
        Page {page + 1} of {totalPages} • 
        Showing items {offset + 1}-{Math.min(offset + processedCoins.length, total)} of {total} 
        {filterTerm && `(filtered from ${fetchedCoins.length} on this page)`}
      </div>
      
      <ExplorerGrid
        coins={processedCoins}
        total={total}
        canPrev={hasPreviousPage}
        canNext={hasNextPage}
        onPrev={goToPreviousPage}
        onNext={goToNextPage}
        onTrade={openTrade}
        isLoading={isLoading}
        currentPage={page + 1}
        totalPages={totalPages}
      />
    </>
  );
};

export default Coins;