import { httpRequest } from "@/lib/api/http";

const ACCESS_TOKEN_STORAGE_KEY = "nchainride_access_token";

export interface NonceRequest {
  wallet: string;
}

export interface NonceResponse {
  nonce: string;
  expiresAt: string;
}

export interface VerifyRequest {
  wallet: string;
  nonce: string;
  signature: string;
}

export interface VerifyResponse {
  accessToken: string;
  tokenType: "Bearer";
}

export interface MeResponse {
  wallet: string;
}

export interface LogoutResponse {
  success: boolean;
}

export const authStorage = {
  getAccessToken(): string | null {
    if (typeof window === "undefined") {
      return null;
    }
    return window.localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
  },
  setAccessToken(token: string): void {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token);
  },
  clearAccessToken(): void {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
  },
};

export function buildNonceSignMessage(nonce: string): string {
  return `Sign this nonce to login: ${nonce}`;
}

export const authApi = {
  requestNonce(payload: NonceRequest): Promise<NonceResponse> {
    return httpRequest<NonceResponse>("/auth/nonce", {
      method: "POST",
      body: payload,
    });
  },
  verify(payload: VerifyRequest): Promise<VerifyResponse> {
    return httpRequest<VerifyResponse>("/auth/verify", {
      method: "POST",
      body: payload,
    });
  },
  me(token: string): Promise<MeResponse> {
    return httpRequest<MeResponse>("/auth/me", {
      method: "GET",
      token,
    });
  },
  logout(token: string): Promise<LogoutResponse> {
    return httpRequest<LogoutResponse>("/auth/logout", {
      method: "POST",
      token,
    });
  },
};
