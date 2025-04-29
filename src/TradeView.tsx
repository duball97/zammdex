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

      <div className="flex flex-col items-start gap-2">
        <h2 className="text-xl font-semibold">
          {name} [{symbol}]
        </h2>
        {/* Metadata like tokenId */}
        <p>ID: {tokenId.toString()}</p>
      </div>

      {/* buy / sell form from previous answer */}
      <BuySell tokenId={tokenId} name={name} symbol={symbol} />
    </div>
  );
};
