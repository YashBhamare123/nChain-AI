import { createContext, useContext, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  useAppKit,
  useAppKitAccount,
  useAppKitProvider,
  useAppKitNetwork,
  useDisconnect,
} from "@reown/appkit/react";
import { sepolia } from "@reown/appkit/networks";
import { BrowserProvider } from "ethers";
import { authApi, authStorage, buildNonceSignMessage } from "@/lib/api/auth";
import { toUserFacingError } from "@/lib/api/http";
import "@/lib/appkit"; // ensures createAppKit runs once

interface WalletContextType {
  address: string | null;
  isConnecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  shortAddress: string;
  chainId: number | undefined;
  isOnSepolia: boolean;
  switchToSepolia: () => Promise<void>;
  accessToken: string | null;
  backendWallet: string | null;
  isAuthenticated: boolean;
  isAuthenticating: boolean;
  authError: string | null;
  refreshSession: () => Promise<void>;
  ethBalance: string | null;
}

const WalletContext = createContext<WalletContextType>({
  address: null,
  isConnecting: false,
  connect: async () => {},
  disconnect: async () => {},
  shortAddress: "",
  chainId: undefined,
  isOnSepolia: false,
  switchToSepolia: async () => {},
  accessToken: null,
  backendWallet: null,
  isAuthenticated: false,
  isAuthenticating: false,
  authError: null,
  refreshSession: async () => {},
  ethBalance: null,
});

export const useWallet = () => useContext(WalletContext);

export const WalletProvider = ({ children }: { children: ReactNode }) => {
  const { open } = useAppKit();
  const { address, isConnected, status } = useAppKitAccount();
  const { walletProvider } = useAppKitProvider<unknown>("eip155");
  const { chainId, switchNetwork } = useAppKitNetwork();
  const { disconnect: disconnectWallet } = useDisconnect();

  const [accessToken, setAccessToken] = useState<string | null>(() => authStorage.getAccessToken());
  const [backendWallet, setBackendWallet] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSessionReady, setIsSessionReady] = useState(false);
  const [ethBalance, setEthBalance] = useState<string | null>(null);
  const lastSeenAddressRef = useRef<string | null>(null);
  const attemptedAutoAuthRef = useRef<string | null>(null);

  const addr = isConnected && address ? address : null;
  const normalizedAddress = addr?.toLowerCase() ?? null;
  const shortAddress = addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "";
  const numericChainId = typeof chainId === "string" ? parseInt(chainId) : chainId;
  const isOnSepolia = numericChainId === 11155111;
  const isConnecting = status === "connecting" || status === "reconnecting";
  const isAuthenticated = !!normalizedAddress && !!accessToken && backendWallet === normalizedAddress;

  const persistAccessToken = useCallback((token: string | null) => {
    if (token) {
      authStorage.setAccessToken(token);
    } else {
      authStorage.clearAccessToken();
    }
    setAccessToken(token);
  }, []);

  const refreshSession = useCallback(async () => {
    const token = accessToken ?? authStorage.getAccessToken();
    if (!token) {
      setBackendWallet(null);
      setAuthError(null);
      return;
    }
    try {
      const me = await authApi.me(token);
      setBackendWallet(me.wallet.toLowerCase());
      setAuthError(null);
      persistAccessToken(token);
    } catch (error) {
      persistAccessToken(null);
      setBackendWallet(null);
      setAuthError(toUserFacingError(error, "Session expired"));
      throw error;
    }
  }, [accessToken, persistAccessToken]);

  const authenticateWallet = useCallback(
    async (walletAddress: string) => {
      if (!walletProvider) {
        setAuthError("Wallet provider unavailable");
        return;
      }

      setIsAuthenticating(true);
      setAuthError(null);
      try {
        const nonce = await authApi.requestNonce({ wallet: walletAddress });
        const provider = new BrowserProvider(walletProvider as never);
        const signer = await provider.getSigner();
        const signature = await signer.signMessage(buildNonceSignMessage(nonce.nonce));
        const verify = await authApi.verify({
          wallet: walletAddress,
          nonce: nonce.nonce,
          signature,
        });
        persistAccessToken(verify.accessToken);
        const me = await authApi.me(verify.accessToken);
        setBackendWallet(me.wallet.toLowerCase());
        setAuthError(null);
      } catch (error) {
        persistAccessToken(null);
        setBackendWallet(null);
        setAuthError(toUserFacingError(error, "Wallet authentication failed"));
      } finally {
        setIsAuthenticating(false);
      }
    },
    [persistAccessToken, walletProvider],
  );

  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      const token = authStorage.getAccessToken();
      if (!token) {
        if (!cancelled) {
          setAccessToken(null);
          setBackendWallet(null);
          setAuthError(null);
          setIsSessionReady(true);
        }
        return;
      }
      try {
        const me = await authApi.me(token);
        if (!cancelled) {
          setAccessToken(token);
          setBackendWallet(me.wallet.toLowerCase());
          setAuthError(null);
        }
      } catch {
        if (!cancelled) {
          persistAccessToken(null);
          setBackendWallet(null);
        }
      } finally {
        if (!cancelled) {
          setIsSessionReady(true);
        }
      }
    };

    void restore();
    return () => {
      cancelled = true;
    };
  }, [persistAccessToken]);

  useEffect(() => {
    if (!normalizedAddress) {
      return;
    }
    if (lastSeenAddressRef.current !== normalizedAddress) {
      lastSeenAddressRef.current = normalizedAddress;
      attemptedAutoAuthRef.current = null;
    }
    if (!isSessionReady || isAuthenticating) {
      return;
    }
    if (accessToken && backendWallet === normalizedAddress) {
      return;
    }
    if (attemptedAutoAuthRef.current === normalizedAddress) {
      return;
    }
    attemptedAutoAuthRef.current = normalizedAddress;
    void authenticateWallet(normalizedAddress);
  }, [
    accessToken,
    authenticateWallet,
    backendWallet,
    isAuthenticating,
    isSessionReady,
    normalizedAddress,
  ]);

  const connect = useCallback(async () => {
    setAuthError(null);
    attemptedAutoAuthRef.current = null;
    try {
      await open();
    } catch (error) {
      setAuthError(toUserFacingError(error, "Wallet connection failed"));
    }
  }, [open]);

  const disconnect = useCallback(async () => {
    const token = accessToken ?? authStorage.getAccessToken();
    if (token) {
      try {
        await authApi.logout(token);
      } catch {
        // no-op: local cleanup still happens
      }
    }
    persistAccessToken(null);
    setBackendWallet(null);
    setAuthError(null);
    attemptedAutoAuthRef.current = null;
    lastSeenAddressRef.current = null;
    try {
      await disconnectWallet();
    } catch {
      // no-op: local session already cleared
    }
  }, [accessToken, disconnectWallet, persistAccessToken]);

  const switchToSepolia = useCallback(async () => {
    try {
      await switchNetwork(sepolia);
    } catch (e) {
      console.error("Switch network failed", e);
    }
  }, [switchNetwork]);

  // Fetch and poll wallet ETH balance
  useEffect(() => {
    if (!addr || !walletProvider) {
      setEthBalance(null);
      return;
    }
    let cancelled = false;

    const fetchBalance = async () => {
      try {
        const provider = new BrowserProvider(walletProvider as never);
        const raw = await provider.getBalance(addr);
        // Format to 4 decimal places
        const eth = Number(raw) / 1e18;
        if (!cancelled) setEthBalance(eth.toFixed(4));
      } catch {
        // silently ignore — balance is optional UI sugar
      }
    };

    fetchBalance();
    const interval = setInterval(fetchBalance, 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [addr, walletProvider]);

  return (
    <WalletContext.Provider
      value={{
        address: addr,
        isConnecting,
        connect,
        disconnect,
        shortAddress,
        chainId: numericChainId as number | undefined,
        isOnSepolia,
        switchToSepolia,
        accessToken,
        backendWallet,
        isAuthenticated,
        isAuthenticating,
        authError,
        refreshSession,
        ethBalance,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
};
