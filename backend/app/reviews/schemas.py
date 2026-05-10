from pydantic import BaseModel, Field


class UploadReviewRequest(BaseModel):
    rideId: str
    rating: int = Field(ge=1, le=5)
    reviewText: str = Field(min_length=1, max_length=4000)


class UploadReviewResponse(BaseModel):
    rideId: str
    cid: str
    reviewCidHash: str
    gatewayUrl: str
