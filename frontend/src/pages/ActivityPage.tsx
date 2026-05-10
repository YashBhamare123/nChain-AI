import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useWallet } from "@/contexts/WalletContext";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle, XCircle, Clock, Wallet, Loader2, Car, User } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

type Ride = Tables<"ride_requests">;
type Role = "rider" | "driver";

const statusConfig: Record<string, { icon: typeof CheckCircle; color: string; bg: string; label: string }> = {
  completed: { icon: CheckCircle, color: "text-primary", bg: "bg-primary/10", label: "Completed" },
  cancelled: { icon: XCircle, color: "text-destructive", bg: "bg-destructive/10", label: "Cancelled" },
  pending: { icon: Clock, color: "text-accent", bg: "bg-accent/10", label: "Pending" },
  accepted: { icon: Clock, color: "text-accent", bg: "bg-accent/10", label: "Accepted" },
  in_progress: { icon: Clock, color: "text-accent", bg: "bg-accent/10", label: "In Progress" },
};

const shortAddr = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");

const ActivityPage = () => {
  const { address, connect } = useWallet();
  const [role, setRole] = useState<Role>("rider");
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!address) return;
    let active = true;

    const fetchRides = async () => {
      setLoading(true);
      const column = role === "rider" ? "rider_address" : "driver_address";
      const { data, error } = await supabase
        .from("ride_requests")
        .select("*")
        .eq(column, address.toLowerCase())
        .order("created_at", { ascending: false });
      if (!active) return;
      if (!error && data) setRides(data);
      setLoading(false);
    };

    fetchRides();

    const channel = supabase
      .channel(`activity-${role}-${address}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ride_requests" },
        () => fetchRides()
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [address, role]);

  if (!address) {
    return (
      <div className="min-h-screen pt-16 flex items-center justify-center px-4">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="glass rounded-2xl p-8 text-center max-w-md">
          <Wallet size={48} className="text-primary mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">View Activity</h2>
          <p className="text-muted-foreground text-sm mb-6">Connect wallet to see your ride history.</p>
          <button onClick={connect} className="bg-gradient-primary text-primary-foreground px-6 py-3 rounded-xl font-semibold glow-primary">Connect Wallet</button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pt-16">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
          <h1 className="text-2xl font-bold">My <span className="text-gradient">Rides</span></h1>
          <div className="glass rounded-xl p-1 flex">
            <button
              onClick={() => setRole("rider")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${role === "rider" ? "bg-gradient-primary text-primary-foreground" : "text-muted-foreground"}`}
            >
              <User size={14} /> As Rider
            </button>
            <button
              onClick={() => setRole("driver")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${role === "driver" ? "bg-gradient-primary text-primary-foreground" : "text-muted-foreground"}`}
            >
              <Car size={14} /> As Driver
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="animate-spin text-primary" />
          </div>
        ) : rides.length === 0 ? (
          <div className="glass rounded-xl p-8 text-center text-muted-foreground text-sm">
            No rides yet {role === "rider" ? "as a rider" : "as a driver"}.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {rides.map((ride, i) => {
              const cfg = statusConfig[ride.status] ?? statusConfig.pending;
              const Icon = cfg.icon;
              const date = new Date(ride.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
              const counterparty = role === "rider" ? ride.driver_address : ride.rider_address;
              return (
                <motion.div
                  key={ride.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="glass rounded-xl p-4"
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-9 h-9 rounded-lg ${cfg.bg} flex items-center justify-center shrink-0`}>
                      <Icon size={18} className={cfg.color} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{ride.pickup_label} → {ride.dropoff_label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {role === "rider" ? "Driver" : "Rider"}: {shortAddr(counterparty)} • {date} • {cfg.label}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold font-mono text-sm">{ride.fare_eth.toFixed(4)} ETH</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{ride.distance_km.toFixed(1)} km</p>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ActivityPage;
