import { BuySell } from "./BuySell";
import { useCoinMeta } from "./hooks/use-coin-meta";
import { ClaimVested } from "./ClaimVested";

export const TradeView = ({
  tokenId,
  onBack,
}: {
  tokenId: bigint;
  onBack: () => void;
}) => {
  const { name, symbol } = useCoinMeta(tokenId);

  return (
    <div className="w-full max-w-lg mx-auto flex flex-col gap-4 px-2 py-4 sm:p-6">
      <button 
        onClick={onBack} 
        className="text-sm self-start underline py-2 px-1 touch-manipulation"
      >
        ⬅︎ Back to Explorer
      </button>

      <div className="flex flex-col items-start gap-2">
        <h2 className="text-lg sm:text-xl font-semibold">
          {name} [{symbol}]
        </h2>
        {/* Metadata like tokenId */}
        <p className="text-sm">ID: {tokenId.toString()}</p>
      </div>

      {/* buy / sell form from previous answer */}
      <BuySell tokenId={tokenId} name={name} symbol={symbol} />
      
      {/* Claim vested LP tokens section */}
      <div className="mt-4 sm:mt-6">
        <ClaimVested coinId={tokenId} />
      </div>
    </div>
  );
};
