import { useEffect, useRef, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useLocation } from "@/contexts/LocationContext";
import MapView from "@/components/MapView";
import { fetchOsrmRoute } from "@/lib/routing";
import { ridesApi, type RideResponse } from "@/lib/api/rides";
import { txApi } from "@/lib/api/tx";
import { authStorage } from "@/lib/api/auth";
import { httpRequest, toUserFacingError } from "@/lib/api/http";
import { useAppKitProvider, useAppKitNetwork } from "@reown/appkit/react";
import { AbiCoder, BrowserProvider, Contract, getBytes, keccak256 } from "ethers";
import { motion } from "framer-motion";
import {
  Car,
  Wallet,
  MapPin,
  Clock,
  Route as RouteIcon,
  Loader2,
  Power,
  Crosshair,
  Send,
  X,
  KeyRound,
  CheckCircle2,
  ArrowDownToLine,
  ArrowUpFromLine,
} from "lucide-react";
import { toast } from "sonner";
const RIDE_STATUS_ACCEPTED = 1n;
const RIDE_STATUS_STARTED = 2n;
const COORDINATE_SCALE = 1_000_000;
const ONCHAIN_RIDE_LOOKBACK = 200n;

const toScaledCoordinate = (value: number): bigint => BigInt(Math.round(value * COORDINATE_SCALE));

const resolveOnChainRideId = async (
  contract: Contract,
  riderWallet: string,
  driverWallet: string,
  allowedStatuses: bigint[],
): Promise<bigint> => {
  const nextRideId: bigint = await contract.getFunction("nextRideId")();
  if (nextRideId === 0n) {
    throw new Error("No accepted ride found on-chain. Rider needs to run Accept Ride again.");
  }

  const firstRideId = nextRideId > ONCHAIN_RIDE_LOOKBACK ? nextRideId - ONCHAIN_RIDE_LOOKBACK : 0n;
  const normalizedRider = riderWallet.toLowerCase();
  const normalizedDriver = driverWallet.toLowerCase();

  for (let rideId = nextRideId - 1n; rideId >= firstRideId; rideId--) {
    const ride = await contract.getFunction("getRide")(rideId);
    const rideStatus = BigInt(ride.status);
    if (
      String(ride.user).toLowerCase() === normalizedRider
      && String(ride.driver).toLowerCase() === normalizedDriver
      && allowedStatuses.includes(rideStatus)
    ) {
      return rideId;
    }
    if (rideId === firstRideId) {
      break;
    }
  }

  throw new Error("Could not resolve this ride on-chain. Rider may need to retry Accept Ride.");
};


const DriverPage = () => {
  const { address, connect, isAuthenticated } = useWallet();
  const { lat, lng, loading: locLoading, error: locError, requestLocation } = useLocation();
  const { walletProvider } = useAppKitProvider<unknown>("eip155");
  const { chainId } = useAppKitNetwork();
  const [online, setOnline] = useState(false);
  const [pendingRides, setPendingRides] = useState<RideResponse[]>([]);
  
  // To keep it simple for MVP, we just track the active ride we are assigned to
  const [myRide, setMyRide] = useState<RideResponse | null>(null);

  // Ride IDs the driver has dismissed locally — the poll will ignore them
  const dismissedRideIds = useRef<Set<string>>(new Set());

  // Track our own offers (by rideRequestId)
  const [myOffers, setMyOffers] = useState<Set<string>>(new Set());

  // Offer dialog state
  const [offerRide, setOfferRide] = useState<RideResponse | null>(null);
  const [offerEta, setOfferEta] = useState("10");
  const [offerSurcharge, setOfferSurcharge] = useState(false);
  const [submittingOffer, setSubmittingOffer] = useState(false);
  const [startingRide, setStartingRide] = useState(false);
  const [completingRide, setCompletingRide] = useState(false);

  // Approach route driver -> pickup
  const [approachRoute, setApproachRoute] = useState<[number, number][] | null>(null);
  const [rideRoute, setRideRoute] = useState<[number, number][] | null>(null);

  // Collateral deposit state
  const [depositedWei, setDepositedWei] = useState<bigint | null>(null);
  const [minDepositWei, setMinDepositWei] = useState<bigint | null>(null);
  const [depositInput, setDepositInput] = useState("");
  const [withdrawInput, setWithdrawInput] = useState("");
  const [depositing, setDepositing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  // Poll assigned/active ride for this driver
  useEffect(() => {
    if (!isAuthenticated || !address) {
      setMyRide(null);
      return;
    }

    // Fetch collateral info on load
    const fetchDepositInfo = async () => {
      if (!walletProvider) return;
      try {
        const contractAddress = import.meta.env.VITE_CONTRACT_ADDRESS;
        if (!contractAddress) return;
        const provider = new BrowserProvider(walletProvider as never);
        const abi = [
          "function DRIVER_MIN_DEPOSIT() view returns (uint256)",
          "function drivers(address) view returns (address, bytes32, uint256, uint256, uint256, uint8, bool)",
        ];
        const contract = new Contract(contractAddress, abi, provider);
        const [min, driverData] = await Promise.all([
          contract.DRIVER_MIN_DEPOSIT(),
          contract.drivers(address),
        ]);
        setMinDepositWei(BigInt(min));
        setDepositedWei(BigInt(driverData[4])); // amtDeposited is index 4
      } catch (err) {
        console.error("Failed to fetch deposit info", err);
      }
    };
    fetchDepositInfo();
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await ridesApi.getDriverActiveRide();
        if (cancelled) return;
        // Skip rides the driver has dismissed locally
        if (res.ride && dismissedRideIds.current.has(res.ride.id)) return;
        setMyRide((prev) => {
          if (!res.ride) return null;
          if (
            prev
            && prev.id === res.ride.id
            && (prev.status === "STARTED" || prev.status === "in_progress")
            && res.ride.status === "ONCHAIN_ACCEPTED"
          ) {
            return { ...res.ride, status: "STARTED" };
          }
          return res.ride;
        });
        if (res.ride) {
          setOnline(false);
        }
      } catch (err) {
        console.error("Failed to fetch active ride", err);
      }
    };

    poll();
    const interval = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isAuthenticated, address]);

  // Poll open rides
  useEffect(() => {
    if (!isAuthenticated || !online || !!myRide) {
      setPendingRides([]);
      return;
    }
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await ridesApi.getOpenRides();
        if (cancelled) return;
        setPendingRides(res.rides);
      } catch (err) {
        console.error("Failed to fetch open rides", err);
      }
    };

    poll();
    const interval = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isAuthenticated, online, myRide]);

  // Build routes when there's an active ride
  useEffect(() => {
    if (!myRide) {
      setApproachRoute(null);
      setRideRoute(null);
      return;
    }
    let cancelled = false;
    const driverPos: [number, number] | null = lat && lng ? [lat, lng] : null;

    if ((myRide.status === "DRIVER_SELECTED" || myRide.status === "awaiting_pickup") && driverPos) {
      fetchOsrmRoute(driverPos, [myRide.pickupLat, myRide.pickupLng]).then((r) => {
        if (!cancelled && r) setApproachRoute(r.coords);
      });
    } else {
      setApproachRoute(null);
    }

    fetchOsrmRoute(
      [myRide.pickupLat, myRide.pickupLng],
      [myRide.dropLat, myRide.dropLng]
    ).then((r) => {
      if (!cancelled && r) setRideRoute(r.coords);
    });

    return () => {
      cancelled = true;
    };
  }, [myRide?.id, myRide?.status, lat, lng]);

  // Compute base fare from ride metadata using same formula as RidePage
  const computeBaseFareEth = (ride: RideResponse): number => {
    const distanceKm = (ride.distanceMeters ?? 0) / 1000;
    const durationMin = (ride.durationSeconds ?? 0) / 60;
    const base = 0.0008;
    const perKm = 0.00035;
    const perMin = 0.00008;
    return base + perKm * distanceKm + perMin * durationMin;
  };

  const openOfferDialog = (ride: RideResponse) => {
    setOfferRide(ride);
    setOfferEta("10");
    setOfferSurcharge(false);
  };
  const startRideOnChain = async () => {
    if (!myRide || !walletProvider) return;
    setStartingRide(true);
    try {
      const contractAddress = import.meta.env.VITE_CONTRACT_ADDRESS;
      if (!contractAddress) throw new Error("Contract address not configured");

      const provider = new BrowserProvider(walletProvider as never);
      const signer = await provider.getSigner();
      const driverWallet = (await signer.getAddress()).toLowerCase();

      const abi = [
        "function nextRideId() view returns (uint256)",
        "function getRide(uint256 id) view returns ((address user,address driver,(int256 lat,int256 long) start,(int256 lat,int256 long) end,uint256 fare,uint256 finalFare,uint256 ceilingBond,uint256 startTime,uint256 endTime,(address secondUser,uint256 rider1Refund,uint256 driverShareFromR2) sharedInfo,uint256 rating,uint8 status))",
        "function startRide(uint256 id, int256 a, int256 b, int256 c, int256 d, uint256 estimatedTime)",
      ];
      const contract = new Contract(contractAddress, abi, signer);

      const onChainRideId = await resolveOnChainRideId(
        contract,
        myRide.riderWallet,
        driverWallet,
        [RIDE_STATUS_ACCEPTED, RIDE_STATUS_STARTED],
      );
      const currentRide = await contract.getFunction("getRide")(onChainRideId);
      const currentStatus = BigInt(currentRide.status);

      if (currentStatus === RIDE_STATUS_STARTED) {
        setMyRide((prev) => (prev ? { ...prev, status: "STARTED" } : prev));
        toast.message("Ride is already started on-chain.");
        return;
      }
      if (currentStatus !== RIDE_STATUS_ACCEPTED) {
        throw new Error("Ride is not in ACCEPTED state on-chain.");
      }

      const tx = await contract.getFunction("startRide")(
        onChainRideId,
        toScaledCoordinate(myRide.pickupLat),
        toScaledCoordinate(myRide.pickupLng),
        toScaledCoordinate(myRide.dropLat),
        toScaledCoordinate(myRide.dropLng),
      );
      toast.success("Start ride submitted! Waiting for confirmation...");
      const receipt = await tx.wait();
      const txSucceeded = receipt?.status === 1;

      await txApi.recordTx({
        txHash: tx.hash,
        chainId: Number(chainId) || 11155111,
        action: "startRide",
        rideRequestId: myRide.id,
        status: txSucceeded ? "confirmed" : "failed",
      });
      if (txSucceeded) {
        setMyRide((prev) => (prev ? { ...prev, status: "STARTED" } : prev));
        toast.success("Ride started on-chain. You can now complete it.");
      } else {
        toast.error("Start ride transaction failed on-chain.");
      }
    } catch (err) {
      toast.error(toUserFacingError(err, "Could not start ride on-chain"));
    } finally {
      setStartingRide(false);
    }
  };

  const completeRideOnChain = async () => {
    if (!myRide || !walletProvider) return;
    setCompletingRide(true);
    try {
      const contractAddress = import.meta.env.VITE_CONTRACT_ADDRESS;
      if (!contractAddress) throw new Error("Contract address not configured");
      const provider = new BrowserProvider(walletProvider as never);
      const signer = await provider.getSigner();
      const driverWallet = (await signer.getAddress()).toLowerCase();
      const abi = [
        "function nextRideId() view returns (uint256)",
        "function getRide(uint256 id) view returns ((address user,address driver,(int256 lat,int256 long) start,(int256 lat,int256 long) end,uint256 fare,uint256 finalFare,uint256 ceilingBond,uint256 startTime,uint256 endTime,(address secondUser,uint256 rider1Refund,uint256 driverShareFromR2) sharedInfo,uint256 rating,uint8 status))",
        "function completeRide(uint256 id)",
      ];
      const contract = new Contract(contractAddress, abi, signer);

      const onChainRideId = await resolveOnChainRideId(
        contract,
        myRide.riderWallet,
        driverWallet,
        [RIDE_STATUS_ACCEPTED, RIDE_STATUS_STARTED],
      );
      const currentRide = await contract.getFunction("getRide")(onChainRideId);
      const currentStatus = BigInt(currentRide.status);
      if (currentStatus !== RIDE_STATUS_STARTED) {
        throw new Error("Start ride on-chain first, then complete it.");
      }
      if (onChainRideId > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error("Ride ID is too large to encode safely.");
      }
      const onChainRideIdNumber = Number(onChainRideId);


      // 1. Get treasury signature
      const signRes = await txApi.completeRideSign({
        rideId: myRide.id,
        chainId: Number(chainId) || 11155111,
      });
      if (signRes.onChainRideId !== onChainRideIdNumber || signRes.functionName !== "completeRide") {
        throw new Error("Backend returned mismatched on-chain ride ID.");
      }

      const tx = await contract.getFunction("completeRide")(signRes.onChainRideId);
      toast.success("Complete ride submitted! Waiting for confirmation...");

      // 4. Wait for confirmation
      const receipt = await tx.wait();
      const txSucceeded = receipt?.status === 1;

      // 5. Record
      await txApi.recordTx({
        txHash: tx.hash,
        chainId: signRes.chainId || (Number(chainId) || 11155111),
        action: "completeRide",
        rideRequestId: myRide.id,
        status: txSucceeded ? "confirmed" : "failed",
      });
      if (txSucceeded) {
        toast.success("Ride completed on-chain! Payment released.");
        try {
          await ridesApi.completeRide(myRide.id);
        } catch (e) {
          console.error("Failed to eagerly update backend status:", e);
        }
        setMyRide(null);
        setApproachRoute(null);
        setRideRoute(null);
      } else {
        toast.error("Transaction failed on-chain.");
      }
    } catch (err) {
      toast.error(toUserFacingError(err, "Could not complete ride on-chain"));
    } finally {
      setCompletingRide(false);
    }
  };

  const [cancellingRide, setCancellingRide] = useState(false);

  const depositCollateral = async () => {
    if (!walletProvider || !depositInput) return;
    setDepositing(true);
    try {
      const contractAddress = import.meta.env.VITE_CONTRACT_ADDRESS;
      if (!contractAddress) throw new Error("Contract address not configured");
      const provider = new BrowserProvider(walletProvider as never);
      const signer = await provider.getSigner();
      const contract = new Contract(
        contractAddress,
        ["function depositDriverCollateral() payable"],
        signer
      );
      const valueWei = BigInt(Math.round(parseFloat(depositInput) * 1e18));
      const tx = await contract.getFunction("depositDriverCollateral")({ value: valueWei });
      toast.success("Deposit submitted! Waiting for confirmation...");
      await tx.wait();
      setDepositedWei((prev) => (prev ?? 0n) + valueWei);
      setDepositInput("");
      toast.success("Collateral deposited successfully!");
    } catch (err) {
      toast.error(toUserFacingError(err, "Deposit failed"));
    } finally {
      setDepositing(false);
    }
  };

  const withdrawCollateral = async () => {
    if (!walletProvider || !withdrawInput) return;
    setWithdrawing(true);
    try {
      const contractAddress = import.meta.env.VITE_CONTRACT_ADDRESS;
      if (!contractAddress) throw new Error("Contract address not configured");
      const provider = new BrowserProvider(walletProvider as never);
      const signer = await provider.getSigner();
      const contract = new Contract(
        contractAddress,
        ["function withdrawCollateral(uint256 amount)"],
        signer
      );
      const valueWei = BigInt(Math.round(parseFloat(withdrawInput) * 1e18));
      const tx = await contract.getFunction("withdrawCollateral")(valueWei);
      toast.success("Withdrawal submitted! Waiting for confirmation...");
      await tx.wait();
      setDepositedWei((prev) => (prev !== null ? prev - valueWei : null));
      setWithdrawInput("");
      toast.success("Collateral withdrawn!");
    } catch (err) {
      toast.error(toUserFacingError(err, "Withdrawal failed"));
    } finally {
      setWithdrawing(false);
    }
  };

  const [registering, setRegistering] = useState(false);

  const registerOnChain = async () => {
    if (!address) return;
    setRegistering(true);
    try {
      // The backend uses the owner (treasury) key to call registerDriver() on-chain.
      // The driver does NOT need to sign anything — just authenticated via JWT.
      const token = authStorage.getAccessToken() || "";
      const res = await httpRequest<{ tx_hash: string; driver_address: string }>("/admin/register-driver", {
        method: "POST",
        body: { driver_address: address },
        token,
      });
      toast.success(`Driver registered! Tx: ${res.tx_hash.slice(0, 10)}…`);
      // After the tx mines, depositDriverCollateral() will become available.
    } catch (err: any) {
      toast.error(toUserFacingError(err, "Registration failed"));
    } finally {
      setRegistering(false);
    }
  };

  const cancelActiveRide = async () => {
    if (!myRide) return;
    setCancellingRide(true);
    try {
      await ridesApi.cancelRide(myRide.id);
      setMyRide(null);
      setApproachRoute(null);
      setRideRoute(null);
      toast.success("Ride cancelled.");
    } catch (err) {
      toast.error(toUserFacingError(err, "Could not cancel ride"));
    } finally {
      setCancellingRide(false);
    }
  };

  const submitOffer = async () => {
    if (!isAuthenticated || !offerRide) return;
    if (!walletProvider) {
      toast.error("Wallet provider not available");
      return;
    }
    const eta = Number(offerEta);
    if (!Number.isFinite(eta) || eta <= 0) {
      toast.error("Enter a valid ETA");
      return;
    }
    setSubmittingOffer(true);

    try {
      // Compute fare: base fare from ride metadata, optionally apply 20% surcharge
      const baseFareEth = computeBaseFareEth(offerRide);
      const finalFareEth = offerSurcharge ? baseFareEth * 1.2 : baseFareEth;
      const fareWei = Math.round(finalFareEth * 1e18).toString();
      const fareWeiBig = BigInt(fareWei);

      // Sign the acceptRide payload with the driver wallet so the rider's
      // on-chain acceptRide call can recover this signer.
      const contractAddress = import.meta.env.VITE_CONTRACT_ADDRESS;
      if (!contractAddress) throw new Error("VITE_CONTRACT_ADDRESS is not configured");

      const provider = new BrowserProvider(walletProvider as never);
      const signer = await provider.getSigner();
      const driverAddress = (await signer.getAddress()).toLowerCase();
      const riderAddress = offerRide.riderWallet.toLowerCase();

      const carpool = new Contract(
        contractAddress,
        ["function driverNonces(address) view returns (uint256)"],
        provider,
      );
      const nonce: bigint = await carpool.driverNonces(driverAddress);
      const chainIdNum = 11155111n; // Sepolia
      const ceiling = false; // MVP: match the flag enforced on the rider side

      const innerHash = keccak256(
        AbiCoder.defaultAbiCoder().encode(
          ["address", "address", "uint256", "bool", "uint256", "uint256"],
          [riderAddress, driverAddress, fareWeiBig, ceiling, nonce, chainIdNum],
        ),
      );
      const signature = await signer.signMessage(getBytes(innerHash));

      await ridesApi.submitOffer(offerRide.id, {
        etaSeconds: eta * 60,
        quotedFareWei: fareWei,
        driverSignature: signature,
        driverNonce: nonce.toString(),
        ceilingEnabled: ceiling,
      });

      setMyOffers(prev => new Set(prev).add(offerRide.id));
      toast.success("Offer sent! Waiting for the rider to pick.");
      setOfferRide(null);
    } catch (err) {
      toast.error(toUserFacingError(err, "Could not send offer"));
    } finally {
      setSubmittingOffer(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen pt-16 flex items-center justify-center px-4">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="glass rounded-2xl p-8 text-center max-w-md">
          <Car size={48} className="text-primary mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">Start Driving</h2>
          <p className="text-muted-foreground text-sm mb-6">Connect your wallet to register as a driver.</p>
          <button onClick={connect} className="bg-primary text-primary-foreground px-6 py-3 rounded-xl font-semibold w-full sm:w-auto">
            Connect & Sign In
          </button>
        </motion.div>
      </div>
    );
  }

  const mapPickup: [number, number] | null = myRide ? [myRide.pickupLat, myRide.pickupLng] : null;
  const mapDropoff: [number, number] | null = myRide ? [myRide.dropLat, myRide.dropLng] : null;
  const mapDriver: [number, number] | null = lat && lng ? [lat, lng] : null;

  return (
    <div className="min-h-screen pt-16">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 h-[calc(100vh-7rem)]">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="lg:col-span-2 flex flex-col gap-4 overflow-y-auto"
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight">Driver Feed</h1>
              <div className="flex items-center gap-2">
                <button
                  onClick={registerOnChain}
                  disabled={registering}
                  className="text-xs bg-secondary/80 text-foreground px-3 py-1.5 rounded-full font-medium hover:bg-secondary flex items-center gap-1.5 transition-colors disabled:opacity-50"
                  title="Register your driver wallet on-chain once before accepting rides"
                >
                  {registering ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />}
                  {registering ? "Registering..." : "Register on Blockchain"}
                </button>
                <button
                  onClick={() => {
                    requestLocation();
                    toast.message("Fetching your current location…");
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-secondary text-foreground border border-border hover:bg-secondary/70"
                >
                  <Crosshair size={12} className={locLoading ? "animate-pulse" : ""} />
                  {locLoading ? "Locating…" : lat && lng ? "Recenter" : "Locate me"}
                </button>
                <button
                  onClick={() => setOnline(!online)}
                  disabled={!!myRide}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    online ? "bg-primary/15 text-primary border border-primary/30" : "bg-secondary text-muted-foreground border border-transparent"
                  } disabled:opacity-50`}
                >
                  <Power size={12} /> {online ? "Online" : "Offline"}
                </button>
              </div>
            </div>
            {locError && !lat && (
              <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
                Location error: {locError}. Tap "Locate me" to retry.
              </div>
            )}

            {/* Collateral Panel */}
            <div className="glass rounded-xl p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Driver Collateral</span>
                {depositedWei !== null && minDepositWei !== null && (
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    depositedWei >= minDepositWei
                      ? "bg-primary/15 text-primary"
                      : "bg-destructive/15 text-destructive"
                  }`}>
                    {depositedWei >= minDepositWei ? "Sufficient" : "Insufficient"}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-secondary/50 rounded-lg px-3 py-2">
                  <p className="text-muted-foreground mb-0.5">Deposited</p>
                  <p className="font-mono font-semibold">
                    {depositedWei !== null ? (Number(depositedWei) / 1e18).toFixed(4) : "—"} ETH
                  </p>
                </div>
                <div className="bg-secondary/50 rounded-lg px-3 py-2">
                  <p className="text-muted-foreground mb-0.5">Minimum</p>
                  <p className="font-mono font-semibold">
                    {minDepositWei !== null ? (Number(minDepositWei) / 1e18).toFixed(4) : "—"} ETH
                  </p>
                </div>
              </div>

              <div className="flex gap-2">
                <input
                  value={depositInput}
                  onChange={(e) => setDepositInput(e.target.value.replace(/[^\d.]/g, ""))}
                  inputMode="decimal"
                  placeholder="Amount (ETH)"
                  className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-primary"
                />
                <button
                  onClick={depositCollateral}
                  disabled={depositing || !depositInput}
                  className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-50"
                >
                  {depositing ? <Loader2 size={12} className="animate-spin" /> : <ArrowDownToLine size={12} />}
                  Deposit
                </button>
              </div>

              <div className="flex gap-2">
                <input
                  value={withdrawInput}
                  onChange={(e) => setWithdrawInput(e.target.value.replace(/[^\d.]/g, ""))}
                  inputMode="decimal"
                  placeholder="Amount (ETH)"
                  className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-primary"
                />
                <button
                  onClick={withdrawCollateral}
                  disabled={withdrawing || !withdrawInput}
                  className="flex items-center gap-1.5 bg-secondary text-foreground border border-border px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-50"
                >
                  {withdrawing ? <Loader2 size={12} className="animate-spin" /> : <ArrowUpFromLine size={12} />}
                  Withdraw
                </button>
              </div>
            </div>

            {myRide && (
              <div className="glass rounded-xl p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">Active Ride</span>
                  <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-primary/15 text-primary">
                    {myRide.status.replace("_", " ")}
                  </span>
                </div>
                <div>
                  <div className="flex items-start gap-2 text-sm mb-1">
                    <MapPin size={14} className="text-primary mt-0.5 shrink-0" />
                    <span className="line-clamp-1">{myRide.pickupAddress}</span>
                  </div>
                  <div className="flex items-start gap-2 text-sm">
                    <MapPin size={14} className="text-accent mt-0.5 shrink-0" />
                    <span className="line-clamp-1">{myRide.dropAddress}</span>
                  </div>
                </div>

                <div className="bg-secondary/60 rounded-lg p-3 flex flex-col gap-2">
                  {myRide.status === "DRIVER_SELECTED" || myRide.status === "awaiting_pickup" ? (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Rider selected your offer. Waiting for them to confirm on-chain...
                      </p>
                      <div className="py-2 text-center text-sm font-medium text-muted-foreground flex items-center justify-center gap-2">
                        <Loader2 size={14} className="animate-spin" />
                        Pending blockchain tx
                      </div>
                      <button
                        onClick={cancelActiveRide}
                        disabled={cancellingRide}
                        className="w-full bg-destructive/15 text-destructive border border-destructive/30 px-3 py-2 rounded-lg text-xs font-semibold hover:bg-destructive/25 flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                      >
                        {cancellingRide ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                        {cancellingRide ? "Cancelling..." : "Cancel ride"}
                      </button>
                    </>
                  ) : myRide.status === "ONCHAIN_ACCEPTED" ? (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Ride accepted on-chain. Start the ride first, then complete it at drop-off.
                      </p>
                      <button
                        onClick={startRideOnChain}
                        disabled={startingRide}
                        className="bg-primary text-primary-foreground px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5"
                      >
                        {startingRide ? <Loader2 size={12} className="animate-spin" /> : <RouteIcon size={12} />}
                        {startingRide ? "Starting on-chain..." : "Start Ride"}
                      </button>
                      <button
                        onClick={cancelActiveRide}
                        disabled={cancellingRide}
                        className="w-full bg-destructive/15 text-destructive border border-destructive/30 px-3 py-2 rounded-lg text-xs font-semibold hover:bg-destructive/25 flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                      >
                        {cancellingRide ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                        {cancellingRide ? "Cancelling..." : "Cancel ride"}
                      </button>
                    </>
                  ) : myRide.status === "STARTED" || myRide.status === "in_progress" ? (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Ride started on-chain. Complete it to release payment to your wallet.
                      </p>
                      <button
                        onClick={completeRideOnChain}
                        disabled={completingRide || startingRide}
                        className="bg-primary text-primary-foreground px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5"
                      >
                        {completingRide ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                        {completingRide ? "Confirming on-chain..." : "Complete Ride"}
                      </button>
                      <button
                        onClick={cancelActiveRide}
                        disabled={cancellingRide}
                        className="w-full bg-destructive/15 text-destructive border border-destructive/30 px-3 py-2 rounded-lg text-xs font-semibold hover:bg-destructive/25 flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                      >
                        {cancellingRide ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                        {cancellingRide ? "Cancelling..." : "Cancel ride"}
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Waiting for ride state sync before the next on-chain action.
                      </p>
                      <button
                        onClick={cancelActiveRide}
                        disabled={cancellingRide}
                        className="w-full bg-destructive/15 text-destructive border border-destructive/30 px-3 py-2 rounded-lg text-xs font-semibold hover:bg-destructive/25 flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                      >
                        {cancellingRide ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                        {cancellingRide ? "Cancelling..." : "Cancel ride"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            <div className="glass rounded-xl p-4 flex-1 min-h-0 flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Open Ride Requests</span>
                <span className="text-xs font-mono text-primary">{pendingRides.length}</span>
              </div>

              {myRide ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  Finish the active ride to receive new requests.
                </div>
              ) : !online ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  Go Online to see open ride requests.
                </div>
              ) : pendingRides.length === 0 && !myRide ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  <Loader2 size={14} className="animate-spin mx-auto mb-2" />
                  Looking for rides...
                </div>
              ) : (
                <div className="flex flex-col gap-2 overflow-y-auto -mx-1 px-1">
                  {pendingRides.map((r) => {
                    const alreadyOffered = myOffers.has(r.id);
                    return (
                      <motion.div
                        key={r.id}
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-secondary rounded-lg p-3"
                      >
                        <div className="flex items-start gap-2 text-sm mb-1">
                          <MapPin size={12} className="text-primary mt-1 shrink-0" />
                          <span className="line-clamp-1">{r.pickupAddress}</span>
                        </div>
                        <div className="flex items-start gap-2 text-sm mb-2">
                          <MapPin size={12} className="text-accent mt-1 shrink-0" />
                          <span className="line-clamp-1">{r.dropAddress}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2">
                          <span className="flex items-center gap-1"><RouteIcon size={11} /> {((r.distanceMeters ?? 0) / 1000).toFixed(1)} km</span>
                          <span className="flex items-center gap-1"><Clock size={11} /> {Math.round((r.durationSeconds ?? 0) / 60)} min</span>
                        </div>
                        <div className="flex items-center justify-end">
                          <button
                            onClick={() => openOfferDialog(r)}
                            disabled={!online || !!myRide || alreadyOffered}
                            className="bg-primary text-primary-foreground px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40 flex items-center gap-1.5"
                          >
                            <Send size={11} />
                            {alreadyOffered ? "Offer sent" : "Send offer"}
                          </button>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>

          <div className="lg:col-span-3 min-h-[300px]">
            <MapView
              pickup={mapPickup}
              dropoff={mapDropoff}
              driver={mapDriver}
              approachRoute={approachRoute}
              rideRoute={rideRoute}
              className="w-full h-full"
            />
          </div>
        </div>
      </div>

      {/* Offer Dialog */}
      {offerRide && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={() => setOfferRide(null)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="glass rounded-2xl p-6 max-w-sm w-full border border-border"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Send your offer</h3>
              <button onClick={() => setOfferRide(null)} className="text-muted-foreground hover:text-foreground">
                <X size={18} />
              </button>
            </div>

            <label className="block mb-4">
              <span className="text-xs text-muted-foreground">ETA to pickup (minutes)</span>
              <input
                value={offerEta}
                onChange={(e) => setOfferEta(e.target.value.replace(/[^\d.]/g, ""))}
                inputMode="decimal"
                className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-primary"
              />
            </label>

            {/* Surcharge toggle */}
            <div className="mb-5 bg-secondary/50 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">20% Surcharge</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Apply for high demand or long distance</p>
                </div>
                <button
                  type="button"
                  onClick={() => setOfferSurcharge(!offerSurcharge)}
                  className={`w-10 h-6 rounded-full transition-colors flex items-center px-0.5 shrink-0 ${
                    offerSurcharge ? "bg-primary" : "bg-secondary border border-border"
                  }`}
                >
                  <div className={`w-5 h-5 rounded-full transition-transform ${
                    offerSurcharge ? "bg-primary-foreground translate-x-4" : "bg-muted-foreground"
                  }`} />
                </button>
              </div>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="text-xs text-muted-foreground">Your fare:</span>
                <span className="font-mono font-semibold text-sm">
                  {offerRide ? (
                    offerSurcharge
                      ? (computeBaseFareEth(offerRide) * 1.2).toFixed(4)
                      : computeBaseFareEth(offerRide).toFixed(4)
                  ) : "—"}
                </span>
                <span className="text-xs text-muted-foreground">SepoliaETH</span>
                {offerSurcharge && (
                  <span className="text-xs text-muted-foreground line-through ml-1">
                    {offerRide ? computeBaseFareEth(offerRide).toFixed(4) : ""}
                  </span>
                )}
              </div>
            </div>

            <button
              onClick={submitOffer}
              disabled={submittingOffer}
              className="w-full bg-primary text-primary-foreground py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submittingOffer ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Send offer
            </button>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default DriverPage;
