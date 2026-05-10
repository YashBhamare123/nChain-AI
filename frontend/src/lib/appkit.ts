import { createAppKit } from "@reown/appkit/react";
import { EthersAdapter } from "@reown/appkit-adapter-ethers";
import { sepolia } from "@reown/appkit/networks";

// Public WalletConnect Cloud project ID (demo). Users can replace later.
const projectId = "5b3e4ad9f1f1d2bca4f0f3a52f25d678";

const metadata = {
  name: "nChainRide",
  description: "Decentralized ride-hailing on Sepolia",
  url: typeof window !== "undefined" ? window.location.origin : "https://nchainride.app",
  icons: ["https://avatars.githubusercontent.com/u/179229932"],
};

export const appKit = createAppKit({
  adapters: [new EthersAdapter()],
  networks: [sepolia],
  defaultNetwork: sepolia,
  metadata,
  projectId,
  features: {
    analytics: false,
    email: false,
    socials: false,
  },
  themeMode: "dark",
});
