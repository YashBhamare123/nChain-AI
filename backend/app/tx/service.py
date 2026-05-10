from fastapi import HTTPException, status

from app.config import settings
from app.db import Database
from app.tx.schemas import (
    AcceptRidePrepRequest,
    AcceptRidePrepResponse,
    CompleteRidePrepRequest,
    GenericTxPrepResponse,
    JoinSharedRidePrepRequest,
    RateDriverPrepRequest,
    ResolveDisputePrepRequest,
    TxRecordCreateRequest,
    TxRecordResponse,
)


class TxService:
    def __init__(self, db: Database) -> None:
        self.db = db

    async def prepare_accept_ride(self, rider_wallet: str, payload: AcceptRidePrepRequest) -> AcceptRidePrepResponse:
        if not self.db.pool:
            raise RuntimeError("Database is not connected")

        rider_wallet = rider_wallet.lower()

        async with self.db.pool.acquire() as connection:
            ride = await connection.fetchrow("SELECT * FROM ride_requests WHERE id = $1", payload.rideId)
            if not ride:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ride not found")
            if ride["rider_wallet"] != rider_wallet:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only ride owner can prepare acceptRide")
            if ride["status"] != "DRIVER_SELECTED":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Ride must be in DRIVER_SELECTED state before acceptRide prep",
                )

            selected_offer = await connection.fetchrow(
                """
                SELECT * FROM driver_offers
                WHERE ride_request_id = $1 AND status = 'SELECTED'
                LIMIT 1
                """,
                payload.rideId,
            )
            if not selected_offer:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No selected offer found")

        driver_wallet = str(selected_offer["driver_wallet"]).lower()
        fare_wei = int(selected_offer["quoted_fare_wei"])

        # Source of truth is what the driver actually signed at offer submission.
        # Fall back to the request payload only if the offer row is missing those values.
        offer_keys = set(selected_offer.keys())
        stored_sig = selected_offer["driver_signature"] if "driver_signature" in offer_keys else None
        stored_nonce = selected_offer["driver_nonce"] if "driver_nonce" in offer_keys else None
        stored_ceiling = selected_offer["ceiling_enabled"] if "ceiling_enabled" in offer_keys else None

        driver_signature = stored_sig or payload.driverSignature
        if stored_nonce is not None:
            driver_nonce = int(stored_nonce)
        else:
            driver_nonce = payload.driverNonce
        ceiling_enabled = bool(stored_ceiling) if stored_ceiling is not None else payload.ceilingEnabled

        # Contract does integer math: fare * BOND / 100.
        bond_percent_int = int(settings.ceiling_bond_percent)
        ceiling_bond_wei = 0
        if ceiling_enabled:
            ceiling_bond_wei = fare_wei * bond_percent_int // 100
        required_msg_value_wei = fare_wei + ceiling_bond_wei

        return AcceptRidePrepResponse(
            contractAddress=settings.carpool_contract_address,
            functionName="acceptRide",
            riderWallet=rider_wallet,
            driverWallet=driver_wallet,
            fareWei=str(fare_wei),
            ceilingEnabled=ceiling_enabled,
            ceilingBondWei=str(ceiling_bond_wei),
            requiredMsgValueWei=str(required_msg_value_wei),
            driverSignature=driver_signature,
            rideId=payload.rideId,
            chainId=payload.chainId,
            driverNonce=driver_nonce,
        )

    async def record_tx(self, wallet: str, payload: TxRecordCreateRequest) -> TxRecordResponse:
        if not self.db.pool:
            raise RuntimeError("Database is not connected")

        normalized_hash = payload.txHash.lower()
        normalized_wallet = wallet.lower()
        confirmed_at = None
        if payload.status == "confirmed":
            from datetime import UTC, datetime

            confirmed_at = datetime.now(UTC)

        async with self.db.pool.acquire() as connection:
            row = await connection.fetchrow(
                """
                INSERT INTO tx_records(ride_request_id, action, tx_hash, chain_id, from_wallet, status, confirmed_at)
                VALUES($1,$2,$3,$4,$5,$6,$7)
                ON CONFLICT (tx_hash)
                DO UPDATE SET
                    ride_request_id = COALESCE(EXCLUDED.ride_request_id, tx_records.ride_request_id),
                    action = EXCLUDED.action,
                    chain_id = EXCLUDED.chain_id,
                    from_wallet = EXCLUDED.from_wallet,
                    status = EXCLUDED.status,
                    confirmed_at = COALESCE(EXCLUDED.confirmed_at, tx_records.confirmed_at)
                RETURNING *
                """,
                payload.rideRequestId,
                payload.action,
                normalized_hash,
                payload.chainId,
                normalized_wallet,
                payload.status,
                confirmed_at,
            )

        return TxRecordResponse(
            txHash=row["tx_hash"],
            chainId=row["chain_id"],
            action=row["action"],
            rideRequestId=row["ride_request_id"],
            status=row["status"],
            blockNumber=row["block_number"],
            confirmedAt=row["confirmed_at"].isoformat() if row["confirmed_at"] else None,
        )

    async def prepare_complete_ride(self, driver_wallet: str, payload: CompleteRidePrepRequest) -> GenericTxPrepResponse:
        ride, selected_offer = await self._load_ride_with_selected_offer(payload.rideId)
        selected_driver = (ride["selected_driver_wallet"] or "").lower()
        if selected_driver != driver_wallet.lower():
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only selected driver can complete ride")
        onchain_ride_id = self._require_onchain_ride_id(ride, payload.rideId)
        return GenericTxPrepResponse(
            contractAddress=settings.carpool_contract_address,
            functionName="completeRide",
            args=[onchain_ride_id],
            msgValueWei="0",
            rideId=payload.rideId,
            onchainRideId=onchain_ride_id,
            chainId=payload.chainId,
        )

    async def prepare_rate_driver(self, rider_wallet: str, payload: RateDriverPrepRequest) -> GenericTxPrepResponse:
        if not self.db.pool:
            raise RuntimeError("Database is not connected")
        async with self.db.pool.acquire() as connection:
            ride = await connection.fetchrow("SELECT * FROM ride_requests WHERE id = $1", payload.rideId)
            if not ride:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ride not found")
            if str(ride["rider_wallet"]).lower() != rider_wallet.lower():
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only ride rider can rate")
            if ride["status"] != "COMPLETED":
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ride must be completed before rating")
            existing = await connection.fetchrow("SELECT 1 FROM ride_ratings WHERE ride_request_id = $1", payload.rideId)
            if existing:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ride already rated")
        onchain_ride_id = self._require_onchain_ride_id(ride, payload.rideId)
        return GenericTxPrepResponse(
            contractAddress=settings.carpool_contract_address,
            functionName="rateDriver",
            args=[onchain_ride_id, payload.rating, payload.reviewCidHash.lower()],
            msgValueWei="0",
            rideId=payload.rideId,
            onchainRideId=onchain_ride_id,
            chainId=payload.chainId,
        )

    async def prepare_join_shared_ride(self, rider2_wallet: str, payload: JoinSharedRidePrepRequest) -> GenericTxPrepResponse:
        if not self.db.pool:
            raise RuntimeError("Database is not connected")
        async with self.db.pool.acquire() as connection:
            ride = await connection.fetchrow("SELECT * FROM ride_requests WHERE id = $1", payload.rideId)
            if not ride:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ride not found")
            if str(ride["rider_wallet"]).lower() == rider2_wallet.lower():
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Primary rider cannot join as second user")
        onchain_ride_id = self._require_onchain_ride_id(ride, payload.rideId)
        msg_value = int(payload.refundWei) + int(payload.incentiveWei)
        return GenericTxPrepResponse(
            contractAddress=settings.carpool_contract_address,
            functionName="joinSharedRide",
            args=[
                onchain_ride_id,
                int(payload.refundWei),
                int(payload.incentiveWei),
                payload.deadline,
                payload.rider1Signature,
                payload.driverSignature,
            ],
            msgValueWei=str(msg_value),
            rideId=payload.rideId,
            onchainRideId=onchain_ride_id,
            chainId=payload.chainId,
        )

    async def prepare_resolve_dispute(self, payload: ResolveDisputePrepRequest) -> GenericTxPrepResponse:
        if not self.db.pool:
            raise RuntimeError("Database is not connected")
        async with self.db.pool.acquire() as connection:
            ride = await connection.fetchrow("SELECT * FROM ride_requests WHERE id = $1", payload.rideId)
            if not ride:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ride not found")
        onchain_ride_id = self._require_onchain_ride_id(ride, payload.rideId)
        return GenericTxPrepResponse(
            contractAddress=settings.carpool_contract_address,
            functionName="resolveDispute",
            args=[onchain_ride_id, int(payload.payoutWei)],
            msgValueWei="0",
            rideId=payload.rideId,
            onchainRideId=onchain_ride_id,
            chainId=payload.chainId,
        )

    async def _load_ride_with_selected_offer(self, ride_id: str):
        if not self.db.pool:
            raise RuntimeError("Database is not connected")
        async with self.db.pool.acquire() as connection:
            ride = await connection.fetchrow("SELECT * FROM ride_requests WHERE id = $1", ride_id)
            if not ride:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ride not found")
            selected_offer = await connection.fetchrow(
                "SELECT * FROM driver_offers WHERE ride_request_id = $1 AND status = 'SELECTED' LIMIT 1", ride_id
            )
        return ride, selected_offer

    def _require_onchain_ride_id(self, ride, ride_id: str) -> int:
        onchain_ride_id = ride["onchain_ride_id"]
        if onchain_ride_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Ride {ride_id} is not linked to an on-chain ride id yet",
            )
        return int(onchain_ride_id)
