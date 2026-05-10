# nChainRide Frontend

React + TypeScript + Vite dApp frontend for the Carpool smart contract + FastAPI backend.

## Features (Rubric-facing)
- Wallet connection (Reown AppKit + Ethers).
- Contract interactions from UI with status feedback:
  - Rider: `registerUser`, `acceptRide`
  - Driver: `startRide`, `completeRide`, collateral deposit/withdraw
- Ride lifecycle UX with polling and tx status feedback.

## Contract Compatibility
This frontend is aligned with the new Carpool contract function shape:
- `acceptRide(address,uint256,bool,bytes)`
- `startRide(uint256,int256,int256,int256,int256,uint256)`
- `completeRide(uint256)`
- `rateDriver(uint256,uint256)` (backend tx prep support)
- `joinSharedRide(...)` and `resolveDispute(...)` (backend tx prep support)

## Setup
1. Install dependencies
```bash
npm install
```
2. Configure env
```bash
cp .env.example .env
```
Required:
- `VITE_API_BASE_URL`
- `VITE_CONTRACT_ADDRESS`
- `VITE_WALLETCONNECT_PROJECT_ID`

3. Run
```bash
npm run dev
```

## Tests
```bash
npm run test
```

## Notes
- Backend is source of truth for off-chain ride state and tx prep payloads.
- Contract txs are still signed and broadcast from browser wallet.
