from fastapi import APIRouter, Depends, Header, HTTPException, Request, status

from app.reviews.schemas import UploadReviewRequest, UploadReviewResponse
from app.reviews.service import ReviewsService

router = APIRouter(tags=["reviews"])


def get_reviews_service(request: Request) -> ReviewsService:
    return request.app.state.reviews_service


def get_current_wallet(request: Request, authorization: str | None = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1]
    return request.app.state.auth_service.read_wallet_from_token(token)


@router.post("/reviews/upload", response_model=UploadReviewResponse)
async def upload_review(
    payload: UploadReviewRequest,
    wallet: str = Depends(get_current_wallet),
    reviews_service: ReviewsService = Depends(get_reviews_service),
) -> UploadReviewResponse:
    return await reviews_service.upload_review(wallet, payload)
