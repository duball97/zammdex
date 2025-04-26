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
    <Card className="flex border-2 border-red-900 rounded-md bg-yellow-50 w-fit flex-col items-right p-1 gap-3  shadow">
      <CardContent className="flex flex-col items-center justify-center space-y-2">
        <h3 className="text-center font-extrabold">
          {name} [{symbol}]
        </h3>

        <DisplayTokenUri tokenUri={tokenUri} symbol={symbol} />

        <button
          className="m-0 rounded-full text-red-500 font-extrabold hover:scale-105 hover:underline text-sm"
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
  <>
    <h2 className="mb-4 text-xl font-semibold">
      {total === 0
        ? "NO COINS DEPLOYED"
        : total === 1
          ? "1 COIN DEPLOYED"
          : `${total} COINS DEPLOYED`}
    </h2>

    <div className="coins-grid">
      {coins.map((id) => (
        <CoinCard key={id.toString()} tokenId={id} onTrade={onTrade} />
      ))}
    </div>

    <div className="pagination-buttons flex gap-2 mt-4">
      <button
        onClick={onPrev}
        disabled={!canPrev}
        className={`${!canPrev ? "text-gray-400" : ""}`}
      >
        Previous
      </button>
      <button
        onClick={onNext}
        disabled={!canNext}
        className={`${!canNext ? "text-gray-400" : ""}`}
      >
        Next
      </button>
    </div>
  </>
);
