import { httpRequest } from "@/lib/api/http";
import { authStorage } from "@/lib/api/auth";

export interface AcceptRidePrepRequest {
  rideId: string;
  driverSignature: string;
  ceilingEnabled: boolean;
  chainId?: number;
  driverNonce?: number;
}

export interface AcceptRidePrepResponse {
  contractAddress: string;
  functionName: string;
  riderWallet: string;
  driverWallet: string;
  fareWei: string;
  ceilingEnabled: boolean;
  ceilingBondWei: string;
  requiredMsgValueWei: string;
  driverSignature: string;
  rideId: string;
  chainId: number | null;
  driverNonce: number | null;
}

export interface TxRecordCreateRequest {
  txHash: string;
  chainId: number;
  action: string;
  rideRequestId?: string;
  status?: string;
}

export interface TxRecordResponse {
  txHash: string;
  chainId: number;
  action: string;
  rideRequestId: string | null;
  status: string;
  blockNumber: number | null;
  confirmedAt: string | null;
}

export interface TxStatusResponse {
  txHash: string;
  status: string;
  chainId: number;
  action: string;
  rideRequestId: string | null;
  blockNumber: number | null;
  confirmedAt: string | null;
}

export interface CompleteRideSignRequest {
  rideId: string;
  chainId: number;
}

export interface CompleteRideSignResponse {
  contractAddress: string;
  functionName: string;
  args: (string | number)[];
  msgValueWei: string;
  rideId: string;
  onChainRideId: number;
  chainId: number | null;
}

const getToken = () => authStorage.getAccessToken() || "";

export const txApi = {
  prepareAcceptRide(payload: AcceptRidePrepRequest): Promise<AcceptRidePrepResponse> {
    return httpRequest<AcceptRidePrepResponse>("/tx/accept-ride", {
      method: "POST",
      body: payload,
      token: getToken(),
    });
  },

  recordTx(payload: TxRecordCreateRequest): Promise<TxRecordResponse> {
    return httpRequest<TxRecordResponse>("/tx/record", {
      method: "POST",
      body: payload,
      token: getToken(),
    });
  },

  getTxStatus(txHash: string): Promise<TxStatusResponse> {
    return httpRequest<TxStatusResponse>(`/tx/${txHash}`, {
      method: "GET",
      token: getToken(),
    });
  },

  completeRideSign(payload: CompleteRideSignRequest): Promise<CompleteRideSignResponse> {
    return httpRequest<CompleteRideSignResponse>(`/tx/complete-ride`, {
      method: "POST",
      body: payload,
      token: getToken(),
    });
  },
};
