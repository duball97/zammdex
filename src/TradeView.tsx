import { BuySell } from "./BuySell";
import { useCoinMeta } from "./hooks/use-coin-meta";
import { ClaimVested } from "./ClaimVested";
import { useEffect, useState } from "react";
import {
  useAccount,
  usePublicClient,
  useWaitForTransactionReceipt,
} from "wagmi";
import { CoinchanAbi, CoinchanAddress } from "./constants/Coinchan";
import { mainnet } from "viem/chains";

export const TradeView = ({
  tokenId,
  onBack,
}: {
  tokenId: bigint;
  onBack: () => void;
}) => {
  const { name, symbol } = useCoinMeta(tokenId);
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: mainnet.id });

  const [isOwner, setIsOwner] = useState(false);
  const [txHash] = useState<`0x${string}`>();
  const { isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (!publicClient || !tokenId || !address) return;

    const checkOwnership = async () => {
      try {
        const lockup = await publicClient.readContract({
          address: CoinchanAddress,
          abi: CoinchanAbi,
          functionName: "lockups",
          args: [tokenId],
        }) as readonly [string, number, number, boolean, bigint, bigint];

        const [lockupOwner] = lockup;
        setIsOwner(lockupOwner?.toLowerCase() === address.toLowerCase());
      } catch (err) {
        console.error("Failed to fetch lockup owner:", err);
        setIsOwner(false);
      }
    };

    checkOwnership();
  }, [publicClient, tokenId, address, isSuccess]);


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
        <p className="text-sm">ID: {tokenId.toString()}</p>
      </div>

      <BuySell tokenId={tokenId} name={name} symbol={symbol} />

      {isOwner && (
        <div className="mt-4 sm:mt-6">
          <ClaimVested coinId={tokenId} />
        </div>
      )}
    </div>
  );
};
