import farcasterFrame from "@farcaster/frame-wagmi-connector";
import { injected, coinbaseWallet, metaMask } from "wagmi/connectors";
import { http, createConfig } from "wagmi";
import { base, mainnet } from "wagmi/chains";

export const config = createConfig({
  chains: [base, mainnet],
  connectors: [farcasterFrame(), injected(), coinbaseWallet(), metaMask()],
  transports: {
    [base.id]: http(),
    [mainnet.id]: http(),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
