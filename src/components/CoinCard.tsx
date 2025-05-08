import { Card, CardContent } from "./ui/card";
import { type CoinData } from "@/hooks/metadata";
import { useState, useEffect, useCallback, useRef } from "react";
import { formatImageURL, getAlternativeImageUrls } from "@/hooks/metadata/use-global-coins-data";

interface CoinCardProps {
  coin: CoinData;
  onTrade: (id: bigint) => void;
}

export const CoinCard = ({ coin, onTrade }: CoinCardProps) => {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [currentImageUrl, setCurrentImageUrl] = useState<string | null>(null);
  const alternativeUrlsRef = useRef<string[]>([]);
  const attemptedUrlsRef = useRef<Set<string>>(new Set());

  // Reset states when coin changes
  useEffect(() => {
    setImageLoaded(false);
    setImageError(false);
    setCurrentImageUrl(null);
    alternativeUrlsRef.current = [];
    attemptedUrlsRef.current = new Set();
  }, [coin.coinId]);

  // Display values with fallbacks
  const displayName = coin.name || `Token ${coin.coinId.toString()}`;
  const displaySymbol = coin.symbol?.slice(0, 4) || "TKN";
  const shortCoinId = `${coin.coinId.toString().substring(0, 4)}...${coin.coinId.toString().substring(coin.coinId.toString().length - 4)}`;

  // FIX: Centralized image URL resolution logic for clarity and maintainability.
  // Consolidates multiple potential sources (coin.imageUrl, metadata.image, etc.) into a single prioritized check.
  // Improves render consistency and simplifies fallback image handling.
  function resolveImageUrl(coin: CoinData): { primaryUrl: string | null, baseForFallbacks: string | null } {
    console.log("Resolving image url");
    const candidates = [
      coin.imageUrl,
      coin.metadata?.image,
      coin.metadata?.image_url,
      coin.metadata?.imageUrl
    ];

    for (const rawUrl of candidates) {
      if (rawUrl) {
        return { primaryUrl: formatImageURL(rawUrl), baseForFallbacks: rawUrl };
      }
    }

    return { primaryUrl: null, baseForFallbacks: null };
  }
  // On coin update, resolve and set the best image URL, and reset fallback tracking
  useEffect(() => {
    // Reset state and tracking for the new coin
    setImageLoaded(false);
    setImageError(false);
    setCurrentImageUrl(null);
    alternativeUrlsRef.current = [];
    attemptedUrlsRef.current = new Set();

    // Get the primary image and a base URL for fallbacks (if needed)
    const { primaryUrl, baseForFallbacks } = resolveImageUrl(coin);

    // Generate alternative URLs from the base (e.g., multiple IPFS gateways)
    if (baseForFallbacks) {
      alternativeUrlsRef.current = getAlternativeImageUrls(baseForFallbacks);
      console.log(`Generated fallback URLs for coin ${coin.coinId.toString()}`);
    }

    // Set initial image URL if available, and track it as attempted
    if (primaryUrl) {
      setCurrentImageUrl(primaryUrl);
      attemptedUrlsRef.current.add(primaryUrl);
      console.log(`Set primary image URL for coin ${coin.coinId.toString()}:`, primaryUrl);
    } else {
      console.warn(`No valid image found for coin ${coin.coinId.toString()}`);
    }
  }, [coin]);

  // Handle image load error with fallback attempt
  const handleImageError = useCallback((e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    console.error(`Image failed to load for coin ${coin.coinId.toString()}:`, e);

    // Try next alternative URL if available
    if (alternativeUrlsRef.current.length > 0) {
      // Find the first URL we haven't tried yet
      const nextUrl = alternativeUrlsRef.current.find(url => !attemptedUrlsRef.current.has(url));

      if (nextUrl) {
        console.log(`Trying alternative URL: ${nextUrl}`);
        attemptedUrlsRef.current.add(nextUrl);
        setCurrentImageUrl(nextUrl);
        // Don't set error yet, we're trying an alternative
        return;
      }
    }

    // If we've exhausted all alternatives, mark as error
    console.log(`No more alternative URLs to try for coin ${coin.coinId.toString()}`);
    setImageError(true);
  }, [coin.coinId]);

  return (
    <Card 
      className="flex flex-col h-full bg-[var(--card-background-light)] border border-[var(--card-border-light)] rounded-[var(--radius-xl)] shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden cursor-pointer group" 
      onClick={() => onTrade(coin.coinId)}
      title={`Name: ${displayName}\nSymbol: ${displaySymbol}\nID: ${coin.coinId.toString()}`}
    >
      <CardContent className="flex flex-col items-center justify-between p-3 sm:p-4 space-y-3 flex-grow">
        <div className="w-16 h-16 sm:w-20 sm:h-20 relative flex-shrink-0 mb-1">
          <div className={`absolute inset-0 flex bg-[var(--secondary-light)] text-[var(--secondary-foreground-light)] justify-center items-center rounded-full font-medium text-lg`}>
            {imageError && displaySymbol.slice(0, 3)}
            {!currentImageUrl && !imageError && <div className="w-4 h-4 border-2 border-[var(--muted-foreground-light)] border-t-transparent rounded-full animate-spin"></div>}
          </div>

          {!imageError && currentImageUrl && (
            <img
              key={currentImageUrl}
              src={currentImageUrl}
              alt={`${displaySymbol} logo`}
              className={`absolute inset-0 w-full h-full rounded-full object-cover transition-opacity duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
              onLoad={() => { console.log('Loaded:', currentImageUrl); setImageLoaded(true); setImageError(false); }}
              onError={handleImageError}
              loading="lazy"
            />
          )}
        </div>

        <div className="text-center w-full">
          <h3 className="font-semibold text-sm sm:text-base text-[var(--foreground-light)] dark:text-[var(--foreground-dark)] truncate" title={displayName}>
            {displayName} 
          </h3>
          <p className="text-xs text-[var(--muted-foreground-light)] dark:text-[var(--muted-foreground-dark)] truncate" title={displaySymbol}>
            ({displaySymbol}) 
          </p>
        </div>

        <div
          className="mt-auto rounded-[var(--radius-lg)] bg-[var(--primary-light)] py-1 px-5 text-[var(--primary-foreground-light)] font-semibold text-sm shadow-sm group-hover:brightness-110 transition-all"
        >
          Trade
        </div>
      </CardContent>
    </Card>
  );
};