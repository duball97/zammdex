import { useEffect, useState } from "react";
import { useReadContract, usePublicClient } from "wagmi";
import { CoinchanAddress, CoinchanAbi } from "./constants/Coinchan";
import { ExplorerGrid } from "./ExplorerGrid";
import { TradeView } from "./TradeView";

const PAGE_SIZE = 20; // put this near your other constants

export const Coins = () => {
  const publicClient = usePublicClient({ chainId: 1 });

  // ──────────────────────── on-chain counts ────────────────────────
  const { data: totalCoins } = useReadContract({
    address: CoinchanAddress,
    abi: CoinchanAbi,
    functionName: "getCoinsCount",
    chainId: 1,
  }); // BigInt | undefined

  // ───────────────────────── paging state ──────────────────────────
  const [page, setPage] = useState(0); // 0-based page index

  // Derived numbers (always kept in-sync)
  const total = Number(totalCoins ?? 0);
  const offset = page * PAGE_SIZE; // first index on this page
  const end = Math.min(offset + PAGE_SIZE, total); // **exclusive**

  const canPrev = page > 0;
  const canNext = end < total;

  // If the on-chain count shrinks, snap back to the last valid page
  useEffect(() => {
    if (offset >= total && total > 0) {
      setPage(Math.floor((total - 1) / PAGE_SIZE));
    }
  }, [total, offset]);

  // ───────────────────────── fetch IDs ─────────────────────────────
  const [coins, setCoins] = useState<bigint[]>([]);

  useEffect(() => {
    if (!totalCoins) return;

    let cancelled = false;

    (async () => {
      const fetched = await publicClient.readContract({
        address: CoinchanAddress,
        abi: CoinchanAbi,
        functionName: "getCoins", // (start, endExclusive)
        args: [BigInt(offset), BigInt(end)],
      });

      if (!cancelled) setCoins(fetched as bigint[]);
    })();

    return () => {
      cancelled = true; // avoid setting state on unmount
    };
  }, [offset, end, totalCoins, publicClient]);

  // ─── NEW: which coin is being traded? ───────────────────────────
  const [selectedTokenId, setSelectedTokenId] = useState<bigint | null>(null);

  // ─── event handlers ─────────────────────────────────────────────
  const openTrade = (id: bigint) => setSelectedTokenId(id);
  const closeTrade = () => setSelectedTokenId(null);

  // ─── render ─────────────────────────────────────────────────────
  if (selectedTokenId !== null) {
    // full-page trade UI
    return <TradeView tokenId={selectedTokenId} onBack={closeTrade} />;
  }

  // explorer grid (default)
  return (
    <ExplorerGrid
      coins={coins}
      total={Number(totalCoins ?? 0)}
      canPrev={canPrev}
      canNext={canNext}
      onPrev={() => canPrev && setPage((p) => p - 1)}
      onNext={() => canNext && setPage((p) => p + 1)}
      onTrade={openTrade} // 🔑 pass handler down
    />
  );
};

export default Coins;
