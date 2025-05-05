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
  
  // Simple function to get a color based on token ID
  const getColorForId = (id: bigint) => {
    const colors = [
      'bg-red-500', 'bg-blue-500', 'bg-green-500', 'bg-yellow-500', 
      'bg-purple-500', 'bg-pink-500', 'bg-indigo-500', 'bg-teal-500'
    ];
    const index = Number(id % BigInt(colors.length));
    return colors[index];
  };
  
  // Display values with fallbacks
  const displayName = coin.name || `Token ${coin.coinId.toString()}`;
  const displaySymbol = coin.symbol || "TKN";
  
  // Determine the best image URL to use
  useEffect(() => {
    // Log complete coin data for debugging
    console.log(`CoinCard for coin ${coin.coinId.toString()} rendering with data:`, {
      name: coin.name,
      symbol: coin.symbol,
      tokenURI: coin.tokenURI,
      hasMetadata: coin.metadata !== null,
      imageUrl: coin.imageUrl,
      imageFromMetadata: coin.metadata?.image || coin.metadata?.image_url || coin.metadata?.imageUrl || null,
    });
    
    let imageUrl = null;
    let imageSourceForAlternatives = '';
    
    // Try different sources in order of preference
    if (coin.imageUrl) {
      imageUrl = coin.imageUrl;
      imageSourceForAlternatives = coin.imageUrl;
      console.log(`Using direct imageUrl for coin ${coin.coinId.toString()}:`, imageUrl);
    } else if (coin.metadata?.image) {
      imageUrl = formatImageURL(coin.metadata.image);
      imageSourceForAlternatives = coin.metadata.image;
      console.log(`Using metadata.image for coin ${coin.coinId.toString()}:`, imageUrl);
    } else if (coin.metadata?.image_url) {
      imageUrl = formatImageURL(coin.metadata.image_url);
      imageSourceForAlternatives = coin.metadata.image_url;
      console.log(`Using metadata.image_url for coin ${coin.coinId.toString()}:`, imageUrl);
    } else if (coin.metadata?.imageUrl) {
      imageUrl = formatImageURL(coin.metadata.imageUrl);
      imageSourceForAlternatives = coin.metadata.imageUrl;
      console.log(`Using metadata.imageUrl for coin ${coin.coinId.toString()}:`, imageUrl);
    } else {
      console.warn(`No image found for coin ${coin.coinId.toString()} in any expected location`);
      
      // If we have metadata but no image field was found, log the metadata to help debug
      if (coin.metadata) {
        console.log(`Metadata for coin ${coin.coinId.toString()} without standard image field:`, coin.metadata);
      }
    }
    
    // Generate alternative URLs for fallback
    if (imageSourceForAlternatives) {
      alternativeUrlsRef.current = getAlternativeImageUrls(imageSourceForAlternatives);
      console.log(`Generated ${alternativeUrlsRef.current.length} alternative URLs for fallback for coin ${coin.coinId.toString()}`);
    }
    
    setCurrentImageUrl(imageUrl);
    console.log(`Set currentImageUrl for coin ${coin.coinId.toString()} to:`, imageUrl);
    
    // Mark this URL as attempted
    if (imageUrl) {
      attemptedUrlsRef.current.add(imageUrl);
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
    <Card className="flex border-2 border-red-900 rounded-md bg-yellow-50 w-full flex-col items-right p-1 gap-2 shadow">
      <CardContent className="flex flex-col items-center justify-center p-2 space-y-2">
        <h3 className="text-center font-extrabold text-xs sm:text-sm truncate w-full">
          {displayName} [{displaySymbol}]
        </h3>

        <div className="w-16 h-16 sm:w-20 sm:h-20 relative">
          {/* Base colored circle (always visible) */}
          <div className={`absolute inset-0 flex ${getColorForId(coin.coinId)} text-white justify-center items-center rounded-full`}>
            {displaySymbol.slice(0, 3)}
          </div>
          
          {/* Image (displayed on top if available and loaded successfully) */}
          {!imageError && currentImageUrl && (
            <img
              src={currentImageUrl}
              alt={`${displaySymbol} logo`}
              className={`absolute inset-0 w-full h-full rounded-full object-cover transition-opacity duration-200 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
              style={{ zIndex: 1 }}
              onLoad={() => setImageLoaded(true)}
              onError={handleImageError}
              loading="lazy"
            />
          )}
        </div>

        <button
          className="m-0 rounded-full bg-white py-1 px-3 text-red-500 font-extrabold hover:scale-105 hover:underline text-sm touch-manipulation"
          onClick={() => onTrade(coin.coinId)}
        >
          Trade
        </button>
      </CardContent>
    </Card>
  );
};