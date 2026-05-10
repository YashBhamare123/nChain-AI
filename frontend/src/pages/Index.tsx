import { useWallet } from "@/contexts/WalletContext";
import { motion } from "framer-motion";
import { Wallet, MapPin, Shield, Users, ArrowRight, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import DotGrid from "@/components/DotGrid";

const features = [
  { icon: Shield, title: "Trustless Escrow", desc: "Fares locked in smart contracts — no middleman fees" },
  { icon: MapPin, title: "Live GPS Tracking", desc: "Real-time location with route optimization" },
  { icon: Users, title: "Carpool & Share", desc: "Split rides on-chain with atomic fare distribution" },
  { icon: Zap, title: "Instant Settlement", desc: "Driver payouts the moment the ride completes" },
];

const Index = () => {
  const { address, connect, isConnecting } = useWallet();

  return (
    <div className="min-h-screen pt-16">
      {/* Hero */}
      <section className="relative overflow-hidden bg-black text-white">
        <DotGrid />
        <div className="max-w-7xl mx-auto px-4 py-32 md:py-48 relative flex flex-col items-center text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
            className="max-w-3xl"
          >
            <h1 className="text-5xl md:text-7xl font-bold leading-tight mb-6 tracking-tight">
              Ride Hailing. Decentralized.
            </h1>
            <p className="text-muted-foreground text-lg md:text-xl mb-10 max-w-lg mx-auto">
              Web3-enabled ride booking. Peer-to-peer cab booking with trustless payments and zero platform fees.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              {address ? (
                <Link
                  to="/ride"
                  className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-none font-semibold hover:opacity-90 transition-opacity w-full sm:w-auto"
                >
                  Book a Ride <ArrowRight size={18} />
                </Link>
              ) : (
                <button
                  onClick={connect}
                  disabled={isConnecting}
                  className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-none font-semibold hover:opacity-90 transition-opacity w-full sm:w-auto"
                >
                  <Wallet size={18} />
                  {isConnecting ? "Connecting…" : "Connect Wallet"}
                </button>
              )}
              <Link
                to="/driver"
                className="flex items-center justify-center gap-2 bg-transparent text-foreground px-8 py-4 rounded-none font-semibold hover:bg-secondary transition-colors border rounded-xl border-border w-full sm:w-auto"
              >
                Drive & Earn
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-7xl mx-auto px-4 py-20">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + i * 0.1 }}
              className="glass rounded-xl p-6 hover:border-primary/30 transition-colors group"
            >
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:glow-primary transition-shadow">
                <f.icon size={20} className="text-primary" />
              </div>
              <h3 className="font-semibold text-foreground mb-2">{f.title}</h3>
              <p className="text-sm text-muted-foreground">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-7xl mx-auto px-4 py-20">
        <h2 className="text-2xl md:text-3xl font-bold mb-12 text-center tracking-tight">How it works</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            { step: "01", title: "Connect Wallet", desc: "Link your MetaMask wallet to get started. No signup needed." },
            { step: "02", title: "Set Destination", desc: "Drop your pickup and destination pins on the map." },
            { step: "03", title: "Ride & Pay", desc: "Fare escrowed on-chain. Released to driver on completion." },
          ].map((s, i) => (
            <motion.div
              key={s.step}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 + i * 0.15 }}
              className="text-center"
            >
              <div className="text-5xl font-bold text-muted mb-4 tracking-tighter">{s.step}</div>
              <h3 className="font-semibold text-lg mb-2">{s.title}</h3>
              <p className="text-sm text-muted-foreground">{s.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <span className="text-sm text-muted-foreground">© 2026 nChainAI — Decentralised Cab Booking</span>
          <span className="text-xs text-muted-foreground font-mono">Built on Ethereum</span>
        </div>
      </footer>
    </div>
  );
};

export default Index;
