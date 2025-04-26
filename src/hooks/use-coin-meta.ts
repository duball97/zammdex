import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import { CoinsAddress, CoinsAbi } from "@/constants/Coins";

type MetaState = {
  name: string;
  symbol: string;
  tokenUri: string;
  isLoading: boolean;
  error?: Error;
};

/**
 * Fetches and returns the on-chain metadata for a single ERC-1155/721 coin.
 * If a field reverts or isn't implemented, `"N/A"` is returned for that field
 * so the caller never crashes.
 */
export const useCoinMeta = (tokenId: bigint): MetaState => {
  // Batch the three read calls so they resolve in a single RPC round-trip
  const { data, error, isLoading } = useReadContracts({
    contracts: [
      {
        address: CoinsAddress,
        abi: CoinsAbi,
        functionName: "name",
        args: [tokenId],
        chainId: 1,
      },
      {
        address: CoinsAddress,
        abi: CoinsAbi,
        functionName: "symbol",
        args: [tokenId],
        chainId: 1,
      },
      {
        address: CoinsAddress,
        abi: CoinsAbi,
        functionName: "tokenURI",
        args: [tokenId],
        chainId: 1,
      },
    ],
    // optional — keep the response fresh for 30 s, then refetch
    query: {
      staleTime: 30_000,
    },
  });

  // Parse once; components receive stable refs unless something changed
  return useMemo<MetaState>(() => {
    const [nameData, symbolData, uriData] = data || [];

    return {
      name: (nameData?.result as string | undefined) ?? "N/A",
      symbol: (symbolData?.result as string | undefined) ?? "N/A",
      tokenUri: (uriData?.result as string | undefined) ?? "N/A",
      isLoading,
      error: error as Error | undefined,
    };
  }, [data, isLoading, error]);
};
