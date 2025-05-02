import { useQuery } from "@tanstack/react-query";

export const DisplayTokenUri = ({
  tokenUri,
  symbol,
  className = "",
}: {
  tokenUri: string;
  symbol: string;
  className?: string;
}) => {
  const { data: tokenData } = useQuery({
    queryKey: ["token", tokenUri],
    enabled: !!(
      tokenUri &&
      (tokenUri.startsWith("http") || tokenUri.startsWith("ipfs://"))
    ),
    queryFn: async () => {
      let uri;
      if (tokenUri.startsWith("ipfs")) {
        uri = `https://content.wrappr.wtf/ipfs/${tokenUri.slice(7)}`;
      } else if (tokenUri.startsWith("http")) {
        uri = tokenUri;
      } else {
        throw new Error("Invalid token URI");
      }

      const response = await fetch(uri);
      const data = await response.json();
      return data;
    },
  });

  if (
    !tokenUri ||
    !(tokenUri.startsWith("http") || tokenUri.startsWith("ipfs://"))
  ) {
    return (
      <div className={`w-full h-full flex bg-red-500 text-white justify-center items-center rounded-full ${className}`}>
        {symbol?.slice(0, 3)}
      </div>
    );
  }

  return (
    <img
      src={replaceIpfs(tokenData?.image)}
      alt={`${symbol} logo`}
      className={`w-full h-full rounded-full object-cover ${className}`}
    />
  );
};

const replaceIpfs = (ipfsUrl: string) => {
  if (!ipfsUrl) {
    return "/placeholder.png";
  }

  if (!ipfsUrl.startsWith("ipfs://")) {
    return ipfsUrl;
  }
  return `https://content.wrappr.wtf/ipfs/${ipfsUrl.slice(7)}`;
};
