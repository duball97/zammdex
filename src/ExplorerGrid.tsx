import { Card, CardContent } from "./components/ui/card";
import { DisplayTokenUri } from "./DisplayTokenUri";
import { useCoinMeta } from "./hooks/use-coin-meta";

export const CoinCard = ({
  tokenId,
  onTrade,
}: {
  tokenId: bigint;
  onTrade: (id: bigint) => void;
}) => {
  const { name, symbol, tokenUri } = useCoinMeta(tokenId); // your hook

  return (
    <Card className="flex border-2 border-red-900 rounded-md bg-yellow-50 w-full flex-col items-right p-1 gap-2 shadow">
      <CardContent className="flex flex-col items-center justify-center p-2 space-y-2">
        <h3 className="text-center font-extrabold text-xs sm:text-sm truncate w-full">
          {name} [{symbol}]
        </h3>

        <div className="w-16 h-16 sm:w-20 sm:h-20">
          <DisplayTokenUri tokenUri={tokenUri} symbol={symbol} />
        </div>

        <button
          className="m-0 rounded-full bg-white py-1 px-3 text-red-500 font-extrabold hover:scale-105 hover:underline text-sm touch-manipulation"
          onClick={() => onTrade(tokenId)}
        >
          Trade
        </button>
      </CardContent>
    </Card>
  );
};

export const ExplorerGrid = ({
  coins,
  total,
  canPrev,
  canNext,
  onPrev,
  onNext,
  onTrade,
}: {
  coins: bigint[];
  total: number;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onTrade: (id: bigint) => void;
}) => (
  <div className="w-full px-2 sm:px-4">
    <h2 className="mb-4 text-lg sm:text-xl font-semibold text-center sm:text-left">
      {total === 0
        ? "NO COINS DEPLOYED"
        : total === 1
          ? "1 COIN DEPLOYED"
          : `${total} COINS DEPLOYED`}
    </h2>

    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 sm:gap-3">
      {coins.map((id) => (
        <CoinCard key={id.toString()} tokenId={id} onTrade={onTrade} />
      ))}
    </div>

    <div className="pagination-buttons flex justify-center sm:justify-start gap-4 mt-6 mb-4">
      <button
        onClick={onPrev}
        disabled={!canPrev}
        className={`px-4 py-2 rounded-md border border-red-300 hover:bg-red-50 touch-manipulation ${
          !canPrev ? "text-gray-400 opacity-50" : "text-red-500 font-bold"
        }`}
      >
        Previous
      </button>
      <button
        onClick={onNext}
        disabled={!canNext}
        className={`px-4 py-2 rounded-md border border-red-300 hover:bg-red-50 touch-manipulation ${
          !canNext ? "text-gray-400 opacity-50" : "text-red-500 font-bold"
        }`}
      >
        Next
      </button>
    </div>
  </div>
);
