import { BuySell } from "./BuySell";
import { useCoinMeta } from "./hooks/use-coin-meta";

export const TradeView = ({
  tokenId,
  onBack,
}: {
  tokenId: bigint;
  onBack: () => void;
}) => {
  const { name, symbol } = useCoinMeta(tokenId);

  return (
    <div className="max-w-full mx-auto flex flex-col gap-4 p-6 ">
      <button onClick={onBack} className="text-sm self-start underline">
        ⬅︎ Back to Explorer
      </button>
      {/*
      <div className="flex flex-col items-center gap-2">
        {tokenUri.startsWith("http") ? (
          <img
            src={tokenUri.startsWith("http") ? tokenUri : "/placeholder.png"}
            alt={`${symbol} logo`}
            className="w-12 h-12 rounded-full object-cover"
          />
        ) : (
          <div className="w-12 h-12 flex bg-red-500 text-white justify-center items-center rounded-full">
            {symbol?.slice(0, 3)}
          </div>
        )}
        <h2 className="text-xl font-semibold">
          {name} [{symbol}]
        </h2>
      </div> */}

      {/* buy / sell form from previous answer */}
      <BuySell tokenId={tokenId} name={name} symbol={symbol} />
    </div>
  );
};
