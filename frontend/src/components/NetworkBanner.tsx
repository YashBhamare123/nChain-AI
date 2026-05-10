import { useWallet } from "@/contexts/WalletContext";
import { AlertTriangle } from "lucide-react";

const NetworkBanner = () => {
  const { address, isOnSepolia, switchToSepolia } = useWallet();
  if (!address || isOnSepolia) return null;
  return (
    <div className="fixed top-16 left-0 right-0 z-40 bg-accent/15 border-b border-accent/30 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between gap-3 text-sm">
        <div className="flex items-center gap-2 text-accent">
          <AlertTriangle size={16} />
          <span className="font-medium">Wrong network — switch to Sepolia testnet to use nChainRide.</span>
        </div>
        <button
          onClick={switchToSepolia}
          className="bg-accent text-accent-foreground px-3 py-1.5 rounded-lg text-xs font-semibold hover:opacity-90 transition-opacity shrink-0"
        >
          Switch to Sepolia
        </button>
      </div>
    </div>
  );
};

export default NetworkBanner;
