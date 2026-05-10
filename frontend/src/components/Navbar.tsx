import { useWallet } from "@/contexts/WalletContext";
import { Wallet, LogOut, Menu, X } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";

const navLinks = [
  { to: "/", label: "Home" },
  { to: "/ride", label: "Book Ride" },
  { to: "/driver", label: "Driver" },
  { to: "/activity", label: "Activity" },
];

const Navbar = () => {
  const { address, connect, disconnect, isConnecting, shortAddress, ethBalance } = useWallet();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 glass">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <img src="/image.png" alt="nChainRide Logo" className="w-12 h-12 object-contain" />
          <span className="font-bold text-xl text-foreground tracking-tight">nChainRide</span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-1">
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                location.pathname === link.to
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {address ? (
            <div className="flex items-center gap-2">
              {/* ETH Balance badge */}
              <AnimatePresence>
                {ethBalance !== null && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.85 }}
                    transition={{ duration: 0.2 }}
                    className="hidden sm:flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-xs font-mono font-semibold px-2.5 py-1.5 rounded-lg"
                    title="Wallet ETH balance (Sepolia)"
                  >
                    <Wallet size={11} />
                    {ethBalance} <span className="text-emerald-500/70 font-normal">ETH</span>
                  </motion.div>
                )}
              </AnimatePresence>
              {/* Address pill */}
              <span className="hidden sm:inline font-mono text-sm text-primary bg-primary/10 px-3 py-1.5 rounded-lg">
                {shortAddress}
              </span>
              <button onClick={disconnect} className="p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
                <LogOut size={18} />
              </button>
            </div>
          ) : (
            <button
              onClick={connect}
              disabled={isConnecting}
              className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 font-medium text-sm hover:opacity-90 transition-opacity rounded-sm"
            >
              <Wallet size={16} />
              {isConnecting ? "Connecting…" : "Connect Wallet"}
            </button>
          )}
          <button className="md:hidden p-2 text-foreground" onClick={() => setMobileOpen(!mobileOpen)}>
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="md:hidden overflow-hidden glass border-t border-border"
          >
            <div className="p-4 flex flex-col gap-1">
              {navLinks.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  onClick={() => setMobileOpen(false)}
                  className={`px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                    location.pathname === link.to
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
};

export default Navbar;
