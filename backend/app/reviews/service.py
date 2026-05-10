from datetime import UTC, datetime

import httpx
from eth_utils import keccak
from fastapi import HTTPException, status

from app.config import settings
from app.db import Database
from app.reviews.schemas import UploadReviewRequest, UploadReviewResponse


class ReviewsService:
    def __init__(self, db: Database) -> None:
        self.db = db

    async def upload_review(self, rider_wallet: str, payload: UploadReviewRequest) -> UploadReviewResponse:
        if not self.db.pool:
            raise RuntimeError("Database is not connected")

        rider_wallet = rider_wallet.lower()

        async with self.db.pool.acquire() as connection:
            ride = await connection.fetchrow("SELECT * FROM ride_requests WHERE id = $1", payload.rideId)
            if not ride:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ride not found")

            if str(ride["rider_wallet"]).lower() != rider_wallet:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only ride rider can upload review")

            if ride["status"] != "COMPLETED":
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ride must be completed before review upload")

            existing = await connection.fetchrow("SELECT 1 FROM ride_ratings WHERE ride_request_id = $1", payload.rideId)
            if existing:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ride already rated")

        if not settings.pinata_jwt:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Pinata is not configured")

        review_doc = {
            "version": 1,
            "rideId": payload.rideId,
            "riderWallet": rider_wallet,
            "rating": payload.rating,
            "reviewText": payload.reviewText,
            "createdAt": datetime.now(UTC).isoformat(),
        }

        pinata_payload = {
            "pinataContent": review_doc,
            "pinataMetadata": {
                "name": f"{settings.pinata_review_name_prefix}-{payload.rideId}",
                "keyvalues": {
                    "rideId": payload.rideId,
                    "riderWallet": rider_wallet,
                    "rating": str(payload.rating),
                },
            },
        }

        base_url = settings.pinata_base_url.rstrip("/")
        url = f"{base_url}/pinning/pinJSONToIPFS"
        headers = {
            "Authorization": f"Bearer {settings.pinata_jwt}",
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.post(url, headers=headers, json=pinata_payload)
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Pinata request failed: {exc}") from exc

        if response.status_code >= 400:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Pinata rejected upload: {response.text}")

        body = response.json()
        cid = body.get("IpfsHash")
        if not cid:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Pinata response missing IpfsHash")

        review_cid_hash = "0x" + keccak(text=cid).hex()

        return UploadReviewResponse(
            rideId=payload.rideId,
            cid=cid,
            reviewCidHash=review_cid_hash,
            gatewayUrl=f"https://gateway.pinata.cloud/ipfs/{cid}",
        )
