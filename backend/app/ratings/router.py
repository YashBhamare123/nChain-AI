from fastapi import APIRouter, Depends, Header, HTTPException, Request, status

from app.ratings.schemas import DriverRatingResponse, RateRideRequest, RideRatingResponse
from app.ratings.service import RatingsService

router = APIRouter(tags=["ratings"])


def get_ratings_service(request: Request) -> RatingsService:
    return request.app.state.ratings_service


async def get_current_wallet(request: Request, authorization: str | None = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1]
    return await request.app.state.auth_service.read_wallet_from_token(token)


@router.post("/rides/{ride_id}/rate", response_model=RideRatingResponse)
async def rate_ride(
    ride_id: str,
    payload: RateRideRequest,
    wallet: str = Depends(get_current_wallet),
    ratings_service: RatingsService = Depends(get_ratings_service),
) -> RideRatingResponse:
    return await ratings_service.rate_ride(
        ride_id=ride_id,
        rider_wallet=wallet,
        rating=payload.rating,
        review_cid_hash=payload.reviewCidHash,
    )


@router.get("/drivers/{driver_wallet}/rating", response_model=DriverRatingResponse)
async def get_driver_rating(
    driver_wallet: str,
    _wallet: str = Depends(get_current_wallet),
    ratings_service: RatingsService = Depends(get_ratings_service),
) -> DriverRatingResponse:
    return await ratings_service.get_driver_rating(driver_wallet)
