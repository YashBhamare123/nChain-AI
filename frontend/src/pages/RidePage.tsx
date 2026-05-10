import { useState, useEffect } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useLocation } from "@/contexts/LocationContext";
import MapView from "@/components/MapView";
import LocationSearch from "@/components/LocationSearch";
import RideOffersList, { type RideOffer } from "@/components/RideOffersList";
import { fetchOsrmRoute } from "@/lib/routing";
import { ridesApi, type RideResponse, type OfferResponse } from "@/lib/api/rides";
import { txApi } from "@/lib/api/tx";
import { BrowserProvider, Contract } from "ethers";
import { useAppKitProvider } from "@reown/appkit/react";
import { useAppKitNetwork } from "@reown/appkit/react";
import { motion } from "framer-motion";
import CONTRACT_ABI from "@/lib/abi.json";
import {
  Navigation,
  Users,
  Shield,
  Clock,
  Wallet,
  Route as RouteIcon,
  Loader2,
  CheckCircle2,
  XCircle,
  KeyRound,
} from "lucide-react";
import { toast } from "sonner";
import { toUserFacingError } from "@/lib/api/http";

const RidePage = () => {
  const { address, connect, isAuthenticated, authError } = useWallet();
  const { lat, lng } = useLocation();

  const [pickupText, setPickupText] = useState("Current Location");
  const [pickupCoords, setPickupCoords] = useState<[number, number] | null>(null);
  const [dropoffText, setDropoffText] = useState("");
  const [dropoffCoords, setDropoffCoords] = useState<[number, number] | null>(null);
  const [rideType, setRideType] = useState<"solo" | "shared">("solo");
  const [ceiling, setCeiling] = useState(false);

  const [route, setRoute] = useState<[number, number][] | null>(null);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [durationMin, setDurationMin] = useState<number | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);

  const [activeRide, setActiveRide] = useState<RideResponse | null>(null);
  const [publishing, setPublishing] = useState(false);

  // offers
  const [offers, setOffers] = useState<RideOffer[]>([]);
  const [picking, setPicking] = useState<string | null>(null);

  // approach route (driver -> pickup) when accepted
  const [approachRoute, setApproachRoute] = useState<[number, number][] | null>(null);

  const effectivePickup: [number, number] | null =
    pickupCoords || (lat && lng ? [lat, lng] : null);

  // Quote route
  useEffect(() => {
    if (!effectivePickup || !dropoffCoords) {
      setRoute(null);
      setDistanceKm(null);
      setDurationMin(null);
      return;
    }
    setRouteLoading(true);
    let cancelled = false;
    fetchOsrmRoute(effectivePickup, dropoffCoords).then((r) => {
      if (cancelled || !r) {
        setRouteLoading(false);
        return;
      }
      setRoute(r.coords);
      setDistanceKm(r.distanceKm);
      setDurationMin(r.durationMin);
      setRouteLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [effectivePickup?.[0], effectivePickup?.[1], dropoffCoords?.[0], dropoffCoords?.[1]]);

  const fareEth = (() => {
    if (distanceKm == null || durationMin == null) return null;
    const base = 0.0008;
    const perKm = 0.00035;
    const perMin = 0.00008;
    const raw = base + perKm * distanceKm + perMin * durationMin;
    return raw * (rideType === "shared" ? 0.7 : 1);
  })();

  // Poll for active ride status and offers
  useEffect(() => {
    if (!activeRide?.id) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const [rideRes, offersRes] = await Promise.all([
          ridesApi.getRide(activeRide.id),
          ridesApi.getOffers(activeRide.id),
        ]);
        if (cancelled) return;

        setActiveRide(rideRes);

        // Map OfferResponse to UI RideOffer
        const mappedOffers: RideOffer[] = offersRes.offers.map((o) => ({
          id: o.id,
          ride_id: o.rideRequestId,
          driver_address: o.driverWallet,
          eta_min: Math.round(o.etaSeconds / 60),
          counter_fare_eth: Number(o.quotedFareWei) / 1e18, // Convert from wei for UI
          driver_lat: 0, // Not provided by offers API currently
          driver_lng: 0,
          status: o.status,
          created_at: o.createdAt,
        }));
        
        setOffers(mappedOffers);
      } catch (err) {
        console.error("Failed to poll ride/offers", err);
      }
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeRide?.id]);

  // Compute driver -> pickup approach route once driver location is known
  // Note: For MVP, driver location might not be returned in RideResponse until locations API is integrated
  // Using dummy values or omitting approach route if driver lat/lng is not in RideResponse
  useEffect(() => {
    // Wait for locations API integration to get real driver location
    setApproachRoute(null);
  }, [activeRide?.status]);

  const publishRide = async () => {
    if (!isAuthenticated || !effectivePickup || !dropoffCoords || distanceKm == null || durationMin == null || fareEth == null) return;
    setPublishing(true);
    try {
      const tipWeiStr = (fareEth * 1e18 * 0.1).toFixed(0); // Dummy 10% tip calculation in wei

      const ride = await ridesApi.createRide({
        pickupLat: effectivePickup[0],
        pickupLng: effectivePickup[1],
        pickupAddress: pickupText,
        dropLat: dropoffCoords[0],
        dropLng: dropoffCoords[1],
        dropAddress: dropoffText,
        distanceMeters: Math.round(distanceKm * 1000),
        durationSeconds: Math.round(durationMin * 60),
        tipType: "percent",
        tipValue: 10,
        tipWei: tipWeiStr,
        rideType: rideType,
      });
      setActiveRide(ride);
      setOffers([]);
      toast.success("Ride request published — drivers can now bid.");
    } catch (err) {
      toast.error(toUserFacingError(err, "Failed to publish ride"));
    } finally {
      setPublishing(false);
    }
  };

  const cancelRide = async () => {
    // Assuming backend will have a cancel endpoint later. For MVP, just clearing state.
    setActiveRide(null);
    setOffers([]);
    setApproachRoute(null);
    setTxHash(null);
    setTxPending(false);
    setCompleteTxHash(null);
    setCompleteTxPending(false);
    toast.message("Ride cancelled locally");
  };

  const pickOffer = async (offer: RideOffer) => {
    if (!activeRide) return;
    setPicking(offer.id);
    try {
      const updatedRide = await ridesApi.selectDriver(activeRide.id, {
        offerId: offer.id,
      });
      setActiveRide(updatedRide);
      toast.success("Driver picked! Next: Complete on-chain transaction.");
    } catch (err) {
      toast.error(toUserFacingError(err, "Could not assign driver"));
    } finally {
      setPicking(null);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen pt-16 flex items-center justify-center px-4">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="glass rounded-3xl p-10 text-center max-w-md">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-5">
            <Wallet size={30} className="text-primary" />
          </div>
          <h2 className="text-2xl font-extrabold mb-2 tracking-tight">Connect Your Wallet</h2>
          <p className="text-muted-foreground text-sm mb-6 leading-relaxed">Connect MetaMask, Rainbow or any EVM wallet to sign in and book rides.</p>
          {authError && (
            <div className="bg-destructive/15 border border-destructive/40 text-destructive text-sm rounded-xl p-3 mb-6">
              {authError}
            </div>
          )}
          <button onClick={connect} className="bg-gradient-primary text-primary-foreground px-7 py-3 rounded-2xl font-bold glow-primary hover:opacity-90 transition-opacity">
            Connect & Sign In
          </button>
        </motion.div>
      </div>
    );
  }

  // TX logic
  const [txPending, setTxPending] = useState(false);
  const { walletProvider } = useAppKitProvider<unknown>("eip155");
  const { chainId } = useAppKitNetwork();

  const acceptRideOnChain = async () => {
    if (!activeRide || !walletProvider) return;
    setTxPending(true);
    try {
      // 1. Get prep data from backend. The backend now returns the driver signature
      // that was captured at offer-submit time, so the request body fields here are
      // only used as fallbacks for old offers. We pin ceilingEnabled:false to match
      // the flag the driver signs with.
      const prep = await txApi.prepareAcceptRide({
        rideId: activeRide.id,
        driverSignature: "0x" + "00".repeat(65),
        ceilingEnabled: false,
        chainId: Number(chainId) || 11155111,
        driverNonce: 0,
      });

      // 2. Setup ethers provider
      const provider = new BrowserProvider(walletProvider as never);
      const signer = await provider.getSigner();

      // 3. Ensure the rider is registered on-chain (contract require: users[msg.sender] != 0).
      const registerAbi = [
        "function users(address) view returns (address userAddress, uint256 totalRides, uint256 totalScoreGiven)",
        "function registerUser()",
      ];
      const registerContract = new Contract(prep.contractAddress, registerAbi, signer);
      const riderAddr = await signer.getAddress();
      const onchainUser = await registerContract.users(riderAddr);
      if (onchainUser.userAddress === "0x0000000000000000000000000000000000000000") {
        toast.message("Registering your wallet on-chain (one-time)…");
        const regTx = await registerContract.getFunction("registerUser")();
        await regTx.wait();
        toast.success("Wallet registered on-chain.");
      }

      // 4. Define minimal ABI for acceptRide based on actual contract, including custom errors for better debugging
      const abi = [
        "function acceptRide(address driver, uint256 fare, bool ceiling, bytes sig) payable returns (uint256 id)",
        "error ECDSAInvalidSignatureLength(uint256 length)",
        "error ECDSAInvalidSignature()",
        "error ECDSAInvalidSignatureS(bytes32 s)",
        "error OwnableUnauthorizedAccount(address account)",
        "error ReentrancyGuardReentrantCall()"
      ];
      const contract = new Contract(prep.contractAddress, abi, signer);

      // 5. Send transaction using the driver-signed payload returned by the backend.
      const tx = await contract.getFunction("acceptRide")(
        prep.driverWallet,
        prep.fareWei,
        prep.ceilingEnabled,
        prep.driverSignature,
        { value: prep.requiredMsgValueWei }
      );

      toast.success("Transaction submitted! Waiting for confirmation...");

      // 5. Wait for confirmation directly via ethers
      const receipt = await tx.wait();
      const txSucceeded = receipt?.status === 1;

      // 6. Record confirmed transaction to backend
      await txApi.recordTx({
        txHash: tx.hash,
        chainId: prep.chainId || 11155111,
        action: "acceptRide",
        rideRequestId: activeRide.id,
        status: txSucceeded ? "confirmed" : "failed"
      });

      if (txSucceeded) {
        // Notify backend that the on-chain tx confirmed — transitions status from
        // DRIVER_SELECTED → ONCHAIN_ACCEPTED so the button doesn't reappear
        const updatedRide = await ridesApi.onchainAccept(activeRide.id);
        setActiveRide(updatedRide);
        toast.success("Ride accepted on-chain! Your ride is now in progress.");
      } else {
        toast.error("Transaction failed on-chain.");
      }

    } catch (err) {
      toast.error(toUserFacingError(err, "Transaction failed"));
    } finally {
      setTxPending(false);
    }
  };

  const [registering, setRegistering] = useState(false);

  const registerOnChain = async () => {
    if (!walletProvider) return;
    setRegistering(true);
    try {
      const contractAddress = import.meta.env.VITE_CONTRACT_ADDRESS;
      if (!contractAddress) throw new Error("Contract address not configured in frontend/.env");

      const provider = new BrowserProvider(walletProvider as never);
      const signer = await provider.getSigner();
      
      const abi = [
        "function registerUser()"
      ];
      const contract = new Contract(contractAddress, abi, signer);
      
      const tx = await contract.getFunction("registerUser")();
      toast.success("Registration submitted! Waiting for confirmation...");
      await tx.wait();
      toast.success("You are now registered on the Sepolia contract!");
    } catch (err: any) {
      toast.error(toUserFacingError(err, "Registration failed"));
    } finally {
      setRegistering(false);
    }
  };

  // tx confirmation is now handled inline via tx.wait() in each function

  const searching = activeRide?.status === "OPEN";
  const accepted = activeRide?.status === "DRIVER_SELECTED" || activeRide?.status === "awaiting_pickup";
  const inProgress = ["ONCHAIN_ACCEPTED", "STARTED", "in_progress"].includes(activeRide?.status ?? "");
  const completed = activeRide?.status === "COMPLETED";

  const mapPickup: [number, number] | null = activeRide
    ? [activeRide.pickupLat, activeRide.pickupLng]
    : effectivePickup;
  const mapDropoff: [number, number] | null = activeRide
    ? [activeRide.dropLat, activeRide.dropLng]
    : dropoffCoords;
  const mapDriver: [number, number] | null = null;

  return (
    <div className="min-h-screen pt-16">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 h-[calc(100vh-7rem)]">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="lg:col-span-2 flex flex-col gap-4 overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-bold tracking-tight">Book a Ride</h1>
              <button
                onClick={registerOnChain}
                disabled={registering}
                className="text-xs bg-secondary/80 text-foreground px-3 py-1.5 rounded-full font-medium hover:bg-secondary flex items-center gap-1.5 transition-colors"
                title="If you get 'user' error, you must register your wallet on-chain once"
              >
                {registering ? <Loader2 size={12} className="animate-spin" /> : <Wallet size={12} />}
                {registering ? "Registering..." : "Register on Blockchain"}
              </button>
            </div>

            {!activeRide && (
              <>
                <div className="glass rounded-xl p-4 flex flex-col gap-3 relative z-50">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-primary shrink-0" />
                    <LocationSearch
                      value={pickupText}
                      onChange={(t) => {
                        setPickupText(t);
                        if (t !== "Current Location") setPickupCoords(null);
                      }}
                      onSelect={(la, lo, label) => {
                        setPickupCoords([la, lo]);
                        setPickupText(label);
                      }}
                      placeholder="Pickup location"
                      userLat={lat}
                      userLng={lng}
                    />
                  </div>
                  <div className="ml-1.5 w-px h-4 bg-border" />
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-sm bg-accent shrink-0" />
                    <LocationSearch
                      value={dropoffText}
                      onChange={(t) => {
                        setDropoffText(t);
                        setDropoffCoords(null);
                      }}
                      onSelect={(la, lo, label) => {
                        setDropoffCoords([la, lo]);
                        setDropoffText(label);
                      }}
                      placeholder="Where to?"
                      userLat={lat}
                      userLng={lng}
                    />
                  </div>
                </div>

                <div className="glass rounded-xl p-4 flex flex-col gap-3">
                  <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Ride Type</span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setRideType("solo")}
                      className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                        rideType === "solo" ? "bg-primary/15 text-primary border border-primary/30" : "bg-secondary text-secondary-foreground border border-transparent"
                      }`}
                    >
                      <Navigation size={16} /> Solo
                    </button>
                    <button
                      onClick={() => setRideType("shared")}
                      className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                        rideType === "shared" ? "bg-primary/15 text-primary border border-primary/30" : "bg-secondary text-secondary-foreground border border-transparent"
                      }`}
                    >
                      <Users size={16} /> Shared
                    </button>
                  </div>

                  <label className="flex items-center gap-3 mt-1 cursor-pointer">
                    <div
                      onClick={() => setCeiling(!ceiling)}
                      className={`w-10 h-6 rounded-full transition-colors flex items-center px-0.5 ${ceiling ? "bg-primary" : "bg-secondary"}`}
                    >
                      <div className={`w-5 h-5 rounded-full bg-foreground transition-transform ${ceiling ? "translate-x-4" : ""}`} />
                    </div>
                    <div>
                      <span className="text-sm font-medium">Fare Ceiling</span>
                      <p className="text-xs text-muted-foreground">Cap max fare with 20% bond</p>
                    </div>
                  </label>
                </div>

                <div className="glass rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs text-muted-foreground uppercase tracking-wider">Trip Estimate</span>
                    <Shield size={14} className="text-primary" />
                  </div>

                  {routeLoading ? (
                    <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
                      <Loader2 size={14} className="animate-spin" /> Calculating route…
                    </div>
                  ) : distanceKm != null && durationMin != null ? (
                    <>
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div className="bg-secondary/50 rounded-lg px-3 py-2">
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-0.5">
                            <RouteIcon size={12} /> Distance
                          </div>
                          <p className="text-sm font-semibold font-mono">{distanceKm.toFixed(2)} km</p>
                        </div>
                        <div className="bg-secondary/50 rounded-lg px-3 py-2">
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-0.5">
                            <Clock size={12} /> Duration
                          </div>
                          <p className="text-sm font-semibold font-mono">{Math.round(durationMin)} min</p>
                        </div>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-2xl font-bold font-mono text-gradient">
                          {fareEth!.toFixed(4)}
                        </span>
                        <span className="text-sm text-muted-foreground">SepoliaETH</span>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground py-2">
                      Select a destination to see distance, time and fare.
                    </p>
                  )}
                </div>

                <button
                  onClick={publishRide}
                  disabled={publishing || !dropoffCoords || fareEth == null}
                  className="w-full bg-primary text-primary-foreground py-3.5 rounded-xl font-semibold text-sm disabled:opacity-40 transition-opacity"
                >
                  {publishing ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 size={16} className="animate-spin" /> Publishing…
                    </span>
                  ) : (
                    "Publish Ride Request"
                  )}
                </button>
              </>
            )}

            {searching && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-4 flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <Loader2 size={18} className="animate-spin text-primary" />
                  <div className="flex-1">
                    <p className="font-semibold text-sm">Waiting for driver offers…</p>
                  </div>
                </div>
                <RideOffersList
                  offers={offers}
                  baseFareEth={fareEth || 0}
                  onPick={pickOffer}
                  picking={picking}
                />
                <button onClick={cancelRide} className="w-full bg-secondary text-foreground py-2.5 rounded-lg text-sm font-medium hover:bg-secondary/80 flex items-center justify-center gap-2">
                  <XCircle size={14} /> Cancel Request
                </button>
              </motion.div>
            )}

            {accepted && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-4 flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                    <CheckCircle2 size={20} className="text-primary" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-sm">Driver Selected</p>
                    <p className="text-xs text-muted-foreground font-mono">
                      {activeRide!.selectedDriverWallet?.slice(0, 6)}…{activeRide!.selectedDriverWallet?.slice(-4)}
                    </p>
                  </div>
                </div>

                <div className="text-xs text-muted-foreground text-center mt-2 mb-2">
                  Please proceed to accept the ride on-chain.
                </div>

                <button
                  onClick={acceptRideOnChain}
                  disabled={txPending}
                  className="w-full bg-primary text-primary-foreground py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {txPending ? <Loader2 size={14} className="animate-spin" /> : <Shield size={14} />}
                  {txPending ? "Confirming on-chain..." : "Accept Ride on Blockchain"}
                </button>

                <button
                  onClick={cancelRide}
                  className="w-full bg-secondary text-foreground py-2 rounded-lg text-xs font-medium hover:bg-secondary/80 flex items-center justify-center gap-2"
                >
                  <XCircle size={12} /> Cancel ride
                </button>
              </motion.div>
            )}

            {inProgress && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-4 flex flex-col gap-3">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  <p className="font-semibold text-sm">Ride in progress</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Enjoy the ride. Funds are held in escrow — the driver will release payment on arrival.
                </p>
              </motion.div>
            )}

            {completed && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-4 flex flex-col gap-3">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                    <CheckCircle2 size={20} className="text-primary" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-sm">Ride Completed</p>
                    <p className="text-xs text-muted-foreground">You have arrived safely.</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setActiveRide(null);
                    setRoute(null);
                  }}
                  className="w-full bg-secondary text-foreground py-2.5 rounded-lg text-sm font-medium hover:bg-secondary/80 flex items-center justify-center gap-2"
                >
                  Book Another Ride
                </button>
              </motion.div>
            )}
          </motion.div>

          <div className="lg:col-span-3 min-h-[300px]">
            <MapView
              pickup={mapPickup}
              dropoff={mapDropoff}
              driver={mapDriver}
              approachRoute={approachRoute}
              rideRoute={inProgress || accepted ? route : !activeRide ? route : null}
              className="w-full h-full"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default RidePage;
