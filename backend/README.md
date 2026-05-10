# nChainRide Backend

FastAPI backend for the Carpool dApp. Handles auth, ride marketplace, tx-prep, chain sync, ratings, and location stream.

## Modules
- `auth`: wallet nonce + signature login
- `marketplace`: ride/offer lifecycle
- `tx`: tx-prep endpoints for contract calls
- `chain_sync`: webhook ingestion for on-chain events
- `ratings`: rider -> driver rating API
- `location`: driver location stream + location-triggered completion

## Contract Integration (Carpool)
Supported tx-prep endpoints:
- `POST /api/v1/tx/accept-ride`
- `POST /api/v1/tx/complete-ride`
- `POST /api/v1/tx/rate-driver`
- `POST /api/v1/tx/join-shared-ride`
- `POST /api/v1/tx/resolve-dispute`

Ride rows store `onchain_ride_id` to map off-chain UUID rides to on-chain `uint256` ride IDs.

## Setup
```bash
uv sync
uv run uvicorn app.main:app --reload
```

## Environment
- `DATABASE_URL`
- `JWT_SECRET`
- `CARPOOL_CONTRACT_ADDRESS`
- `CHAIN_RPC_URL`
- `CEILING_BOND_PERCENT`
- `RIDE_AUTO_COMPLETE_ENABLED`
- `RIDE_AUTO_COMPLETE_RADIUS_METERS`
- `RIDE_AUTO_COMPLETE_MAX_SPEED_MPS`

## Tests
```bash
uv run pytest -q
```

## Added Tests For Rubric
- Ratings: one-time rating + driver aggregate update.
- Location triggers: near-dropoff location update auto-completes ride.
