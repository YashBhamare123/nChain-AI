# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Commands

Package manager: the repo has both `bun.lock` and `package-lock.json`. Install with whichever you prefer (`bun install` or `npm install`); scripts below use `npm` but work with `bun run` as well.

- Dev server: `npm run dev` — Vite on port **8080** (`host: "::"`), HMR overlay disabled in `vite.config.ts`.
- Production build: `npm run build`
- Development-mode build (keeps `lovable-tagger` plugin): `npm run build:dev`
- Preview built bundle: `npm run preview`
- Lint (flat config, `eslint.config.js`): `npm run lint`
- Run all tests once: `npm run test` (alias for `vitest run`)
- Watch tests: `npm run test:watch`
- Run a single test file: `npx vitest run src/path/to/file.test.ts`
- Run tests matching a name: `npx vitest run -t "partial test name"`

There is no dedicated typecheck script; `vite build` performs type-aware compilation via the SWC/TS pipeline. Run `npx tsc -p tsconfig.app.json --noEmit` if you need an isolated typecheck. Note that `tsconfig*.json` disable `strict`, `strictNullChecks`, `noImplicitAny`, and `noUnusedLocals`/`noUnusedParameters`.

## Environment

Copy `.env.example` → `.env` and fill in values. Keys actually read by the app:

- `VITE_BACKEND_BASE_URL` — FastAPI base URL, defaults to `http://localhost:8000/api/v1` (see `src/lib/api/http.ts`).
- `VITE_MAP_PROVIDER` — `google` (default) or `maplibre`. Determines which map component `src/components/MapView.tsx` re-exports.
- `VITE_GOOGLE_MAPS_API_KEY` — required only when `VITE_MAP_PROVIDER=google`.
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` — consumed by `src/integrations/supabase/client.ts` (the `supabase/` migrations folder is part of a parallel Supabase workflow; the main auth path uses the FastAPI backend, not Supabase Auth).

The WalletConnect / Reown project ID in `src/lib/appkit.ts` is a demo value hardcoded in source.

## Architecture

This is the React + TypeScript + Vite frontend for **nChainRide**, a decentralised cab-booking dApp on Ethereum Sepolia. The app is a thin client: wallet transactions are signed/sent from the browser, and all off-chain state (ride marketplace, pricing, treasury signatures, tx tracking) lives in a separate FastAPI backend at `../backend`. The `Carpool` smart contract is the source of truth for settlement; the backend coordinates off-chain matching and produces the signatures/calldata the frontend needs.

### Provider stack (`src/App.tsx`)

`QueryClientProvider` → `TooltipProvider` → `BrowserRouter` → `WalletProvider` → `LocationProvider` wraps `Navbar`, `NetworkBanner`, and the route tree (`/`, `/ride`, `/driver`, `/activity`, `*`). React Query is used for async state; the `vite.config.ts` `resolve.dedupe` list pins single copies of `react`, `react-dom`, and `@tanstack/react-query` to prevent hook/context duplication from multiple node_modules resolutions.

### Wallet + auth (`src/contexts/WalletContext.tsx`, `src/lib/appkit.ts`)

Wallet connectivity uses **Reown AppKit + Ethers adapter** with `sepolia` as the only/default network. `src/lib/appkit.ts` runs `createAppKit(...)` as a module side effect; importing it (from `WalletContext`) is what bootstraps the modal.

Auth is SIWE-style nonce/verify against the backend:
1. `authApi.requestNonce({ wallet })` → `POST /auth/nonce`
2. Browser wallet signs `buildNonceSignMessage(nonce)` (literal string `"Sign this nonce to login: <nonce>"` — must match backend).
3. `authApi.verify({ wallet, nonce, signature })` → `POST /auth/verify` returns `accessToken`.
4. Token is persisted in `localStorage` under key `nchainride_access_token` via `authStorage` (`src/lib/api/auth.ts`).
5. `authApi.me(token)` confirms the session on mount and on address change.

`isAuthenticated` requires three things to line up: connected wallet address, a stored `accessToken`, and `backendWallet === normalizedAddress`. Auto re-auth is triggered when the connected address changes. Always read auth state via `useWallet()`; do not read the token directly in UI code — use `authStorage.getAccessToken()` only from API layer modules.

### Backend API layer (`src/lib/api/*`)

All HTTP goes through `httpRequest` in `src/lib/api/http.ts`:

- Normalizes paths against `BACKEND_BASE_URL`.
- Adds `Authorization: Bearer <token>` when a token is passed.
- Throws `ApiError(status, detail, payload)` on non-2xx; use `toUserFacingError(err, fallback)` to produce UI strings (also unwraps Ethers `shortMessage`).

Module responsibilities:

- `auth.ts` — nonce/verify/me/logout + `authStorage` + `buildNonceSignMessage`.
- `rides.ts` — ride marketplace: create ride, get ride, driver feed of open rides, submit/list offers, rider selects driver.
- `tx.ts` — contract transaction preparation: `prepareAcceptRide` returns calldata + `requiredMsgValueWei`; `recordTx` persists a submitted tx hash; `getTxStatus` is for polling; `completeRideSign` fetches the treasury signature needed to call `completeRide` on-chain.

Canonical ride/offer lifecycle status strings come from the backend (`OPEN`, `DRIVER_SELECTED`, `ONCHAIN_ACCEPTED`, `STARTED`, `COMPLETED`, `CANCELLED`, `DISPUTED` for rides; `PENDING`, `WITHDRAWN`, `REJECTED`, `SELECTED` for offers). The backend contract is documented in `../backend/integration.MD` and `../backend/context.MD` — consult these before changing request/response shapes.

### End-to-end ride flow the UI implements

1. Rider logs in (wallet connect → nonce → verify).
2. `/ride` page: geocode/autocomplete (backend maps endpoints), route + price estimate, then `ridesApi.createRide(...)`.
3. `/driver` page: `ridesApi.getOpenRides()` → driver submits `ridesApi.submitOffer(...)`.
4. Rider sees offers via `ridesApi.getOffers(rideId)` and calls `ridesApi.selectDriver(...)`.
5. Rider fetches `txApi.prepareAcceptRide({ rideId, driverSignature, ceilingEnabled, ... })`, then uses `ethers.BrowserProvider` from the AppKit `walletProvider` to send the tx with the returned `requiredMsgValueWei`.
6. Frontend calls `txApi.recordTx({ txHash, ... })` and polls `txApi.getTxStatus(hash)` until `confirmed`/`failed`.
7. On completion, one side calls `txApi.completeRideSign(...)`, then submits `completeRide(...)` using the returned treasury signature.

Only `acceptRide` tx prep is exposed by the backend today; additional tx-prep endpoints (start/cancel/rate) are documented as future work in `../backend/context.MD §12` — prefer to add them backend-side rather than reproducing calldata encoding in the frontend.

### Maps

`src/components/MapView.tsx` is a dispatcher that re-exports either `MapViewGoogle` (`@react-google-maps/api`) or `MapViewMapLibre` (`maplibre-gl` + OSM) based on `VITE_MAP_PROVIDER`. Routing polylines for the MapLibre path use `src/lib/routing.ts`, which calls the public OSRM demo server — do not rely on it for production traffic.

### UI

shadcn/ui components live under `src/components/ui/` and are configured via `components.json` (style `default`, base colour `slate`, CSS variables on). Path alias `@/*` → `./src/*` is set in both `tsconfig*.json` and `vite.config.ts`. Tailwind is configured in `tailwind.config.ts` with `tailwindcss-animate` and `@tailwindcss/typography`.

### Tests

Vitest with `jsdom` (see `vitest.config.ts`). `src/test/setup.ts` polyfills `window.matchMedia` and pulls in `@testing-library/jest-dom`. Test files are discovered at `src/**/*.{test,spec}.{ts,tsx}`. Tests run via `vitest` globals (`types: ["vitest/globals"]` in `tsconfig.app.json`), so `describe`/`it`/`expect` do not need to be imported.

### Supabase

`supabase/migrations/` and `src/integrations/supabase/` exist from the original Lovable scaffold. The primary auth + data path is the FastAPI backend; do not assume Supabase is the source of truth for rides/offers/tx state.
