from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel

from app.admin.service import AdminService

router = APIRouter(tags=["admin"])

_admin_service = AdminService()


async def get_current_wallet(request: Request, authorization: str | None = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1]
    return await request.app.state.auth_service.read_wallet_from_token(token)


class RegisterDriverRequest(BaseModel):
    driver_address: str


class RegisterDriverResponse(BaseModel):
    tx_hash: str
    driver_address: str


@router.post("/admin/register-driver", response_model=RegisterDriverResponse)
async def register_driver(
    payload: RegisterDriverRequest,
    wallet: str = Depends(get_current_wallet),
) -> RegisterDriverResponse:
    """
    Submits a registerDriver() transaction on-chain using the owner key.
    Driver registration requests are accepted only when the requested
    driver_address matches the caller wallet.

    In production, this endpoint is intended to be called only after KYC
    verification is completed. KYC workflow is not implemented in this MVP.
    """
    caller = wallet.lower()
    target = payload.driver_address.lower()
    if caller != target:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Driver registration allowed only for caller wallet",
        )

    tx_hash = await _admin_service.register_driver_onchain(target)
    return RegisterDriverResponse(tx_hash=tx_hash, driver_address=target)
