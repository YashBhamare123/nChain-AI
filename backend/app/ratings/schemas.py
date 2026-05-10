from pydantic import BaseModel, Field


class RateRideRequest(BaseModel):
    rating: int = Field(ge=1, le=5)
    reviewCidHash: str = Field(min_length=66, max_length=66, pattern=r"^0x[a-fA-F0-9]{64}$")


class DriverRatingResponse(BaseModel):
    driverWallet: str
    ratingAvg: float
    ratingCount: int


class RideRatingResponse(BaseModel):
    rideId: str
    riderWallet: str
    driverWallet: str
    rating: int
    reviewCidHash: str
    createdAt: str
    driverStats: DriverRatingResponse
