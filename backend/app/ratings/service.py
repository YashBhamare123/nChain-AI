from fastapi import HTTPException, status

from app.db import Database
from app.ratings.schemas import DriverRatingResponse, RideRatingResponse


class RatingsService:
    def __init__(self, db: Database) -> None:
        self.db = db

    def _require_pool(self):
        if not self.db.pool:
            raise RuntimeError("Database is not connected")
        return self.db.pool

    async def rate_ride(self, ride_id: str, rider_wallet: str, rating: int, review_cid_hash: str) -> RideRatingResponse:
        pool = self._require_pool()
        rider_wallet = rider_wallet.lower()

        async with pool.acquire() as connection:
            async with connection.transaction():
                ride = await connection.fetchrow("SELECT * FROM ride_requests WHERE id = $1 FOR UPDATE", ride_id)
                if not ride:
                    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ride not found")

                if str(ride["rider_wallet"]).lower() != rider_wallet:
                    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only ride rider can rate")

                if ride["status"] != "COMPLETED":
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ride must be completed before rating")

                driver_wallet = (ride["selected_driver_wallet"] or "").lower()
                if not driver_wallet:
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ride has no selected driver")

                existing = await connection.fetchrow("SELECT id FROM ride_ratings WHERE ride_request_id = $1", ride_id)
                if existing:
                    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ride already rated")

                row = await connection.fetchrow(
                    """
                    INSERT INTO ride_ratings(ride_request_id, rider_wallet, driver_wallet, rating, review_cid_hash)
                    VALUES ($1, $2, $3, $4, $5)
                    RETURNING ride_request_id, rider_wallet, driver_wallet, rating, review_cid_hash, created_at
                    """,
                    ride_id,
                    rider_wallet,
                    driver_wallet,
                    rating,
                    review_cid_hash.lower(),
                )

                driver = await connection.fetchrow("SELECT * FROM drivers WHERE wallet_address = $1 FOR UPDATE", driver_wallet)
                if not driver:
                    driver = await connection.fetchrow(
                        """
                        INSERT INTO drivers(wallet_address, availability, current_status, rating_avg, rating_count)
                        VALUES ($1, 'offline', 'verified', 0, 0)
                        ON CONFLICT (wallet_address) DO UPDATE SET wallet_address = EXCLUDED.wallet_address
                        RETURNING *
                        """,
                        driver_wallet,
                    )

                old_avg = float(driver["rating_avg"])
                old_count = int(driver["rating_count"])
                new_count = old_count + 1
                new_avg = ((old_avg * old_count) + rating) / new_count

                updated_driver = await connection.fetchrow(
                    """
                    UPDATE drivers
                    SET rating_avg = $1,
                        rating_count = $2
                    WHERE wallet_address = $3
                    RETURNING wallet_address, rating_avg, rating_count
                    """,
                    new_avg,
                    new_count,
                    driver_wallet,
                )

        driver_stats = DriverRatingResponse(
            driverWallet=updated_driver["wallet_address"],
            ratingAvg=float(updated_driver["rating_avg"]),
            ratingCount=int(updated_driver["rating_count"]),
        )
        return RideRatingResponse(
            rideId=row["ride_request_id"],
            riderWallet=row["rider_wallet"],
            driverWallet=row["driver_wallet"],
            rating=int(row["rating"]),
            reviewCidHash=row["review_cid_hash"],
            createdAt=row["created_at"].isoformat(),
            driverStats=driver_stats,
        )

    async def get_driver_rating(self, driver_wallet: str) -> DriverRatingResponse:
        pool = self._require_pool()
        driver_wallet = driver_wallet.lower()

        async with pool.acquire() as connection:
            row = await connection.fetchrow(
                "SELECT wallet_address, rating_avg, rating_count FROM drivers WHERE wallet_address = $1",
                driver_wallet,
            )

        if not row:
            return DriverRatingResponse(driverWallet=driver_wallet, ratingAvg=0.0, ratingCount=0)

        return DriverRatingResponse(
            driverWallet=row["wallet_address"],
            ratingAvg=float(row["rating_avg"]),
            ratingCount=int(row["rating_count"]),
        )
