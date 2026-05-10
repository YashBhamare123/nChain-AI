import { httpRequest } from "@/lib/api/http";
import { authStorage } from "@/lib/api/auth";

export interface RideCreateRequest {
  pickupLat: number;
  pickupLng: number;
  pickupAddress: string;
  dropLat: number;
  dropLng: number;
  dropAddress: string;
  distanceMeters?: number;
  durationSeconds?: number;
  tipType?: string;
  tipValue?: number;
  tipWei?: string;
  rideType?: string;
}

export interface RideResponse {
  id: string;
  riderWallet: string;
  pickupLat: number;
  pickupLng: number;
  pickupAddress: string;
  dropLat: number;
  dropLng: number;
  dropAddress: string;
  distanceMeters: number | null;
  durationSeconds: number | null;
  tipType: string | null;
  tipValue: number | null;
  tipWei: string | null;
  selectedDriverWallet: string | null;
  status: string; // "pending", "DRIVER_SELECTED", etc.
  createdAt: string;
  updatedAt: string;
}

export interface OfferCreateRequest {
  etaSeconds: number;
  quotedFareWei: string;
  message?: string;
  driverSignature?: string;
  driverNonce?: string;
  ceilingEnabled?: boolean;
}

export interface OfferResponse {
  id: string;
  rideRequestId: string;
  driverWallet: string;
  etaSeconds: number;
  quotedFareWei: string;
  message: string | null;
  status: string;
  createdAt: string;
}

export interface OffersListResponse {
  offers: OfferResponse[];
}

export interface OpenRidesResponse {
  rides: RideResponse[];
}
export interface DriverActiveRideResponse {
  ride: RideResponse | null;
}

export interface SelectDriverRequest {
  offerId: string;
}

const getToken = () => authStorage.getAccessToken() || "";

export const ridesApi = {
  createRide(payload: RideCreateRequest): Promise<RideResponse> {
    return httpRequest<RideResponse>("/rides", {
      method: "POST",
      body: payload,
      token: getToken(),
    });
  },

  getRide(rideId: string): Promise<RideResponse> {
    return httpRequest<RideResponse>(`/rides/${rideId}`, {
      method: "GET",
      token: getToken(),
    });
  },

  getOpenRides(): Promise<OpenRidesResponse> {
    return httpRequest<OpenRidesResponse>("/driver-feed/open-rides", {
      method: "GET",
      token: getToken(),
    });
  },

  getDriverActiveRide(): Promise<DriverActiveRideResponse> {
    return httpRequest<DriverActiveRideResponse>("/driver-feed/active-ride", {
      method: "GET",
      token: getToken(),
    });
  },

  getOffers(rideId: string): Promise<OffersListResponse> {
    return httpRequest<OffersListResponse>(`/rides/${rideId}/offers`, {
      method: "GET",
      token: getToken(),
    });
  },

  submitOffer(rideId: string, payload: OfferCreateRequest): Promise<OfferResponse> {
    return httpRequest<OfferResponse>(`/rides/${rideId}/offers`, {
      method: "POST",
      body: payload,
      token: getToken(),
    });
  },

  selectDriver(rideId: string, payload: SelectDriverRequest): Promise<RideResponse> {
    return httpRequest<RideResponse>(`/rides/${rideId}/select-driver`, {
      method: "POST",
      body: payload,
      token: getToken(),
    });
  },

  completeRide(rideId: string): Promise<RideResponse> {
    return httpRequest<RideResponse>(`/rides/${rideId}/complete`, {
      method: "POST",
      token: getToken(),
    });
  },

  cancelRide(rideId: string): Promise<RideResponse> {
    return httpRequest<RideResponse>(`/rides/${rideId}/cancel`, {
      method: "POST",
      token: getToken(),
    });
  },

  onchainAccept(rideId: string): Promise<RideResponse> {
    return httpRequest<RideResponse>(`/rides/${rideId}/onchain-accept`, {
      method: "POST",
      token: getToken(),
    });
  },
};
