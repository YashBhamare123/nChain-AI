from fastapi import APIRouter, Depends, Header, HTTPException, Request, status

from app.tx.schemas import (
    AcceptRidePrepRequest,
    AcceptRidePrepResponse,
    CompleteRidePrepRequest,
    DisputeRidePrepRequest,
    GenericTxPrepResponse,
    JoinSharedRidePrepRequest,
    RateDriverPrepRequest,
    ResolveDisputePrepRequest,
    TxRecordCreateRequest,
    TxRecordResponse,
)
from app.tx.service import TxService

router = APIRouter(tags=["tx"])


def get_tx_service(request: Request) -> TxService:
    return request.app.state.tx_service


async def get_current_wallet(request: Request, authorization: str | None = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1]
    return await request.app.state.auth_service.read_wallet_from_token(token)


@router.post("/tx/accept-ride", response_model=AcceptRidePrepResponse)
async def prepare_accept_ride(
    payload: AcceptRidePrepRequest,
    wallet: str = Depends(get_current_wallet),
    tx_service: TxService = Depends(get_tx_service),
) -> AcceptRidePrepResponse:
    return await tx_service.prepare_accept_ride(wallet, payload)


@router.post("/tx/record", response_model=TxRecordResponse)
async def record_tx(
    payload: TxRecordCreateRequest,
    wallet: str = Depends(get_current_wallet),
    tx_service: TxService = Depends(get_tx_service),
) -> TxRecordResponse:
    return await tx_service.record_tx(wallet, payload)


@router.post("/tx/complete-ride", response_model=GenericTxPrepResponse)
async def prepare_complete_ride(
    payload: CompleteRidePrepRequest,
    wallet: str = Depends(get_current_wallet),
    tx_service: TxService = Depends(get_tx_service),
) -> GenericTxPrepResponse:
    return await tx_service.prepare_complete_ride(wallet, payload)


@router.post("/tx/rate-driver", response_model=GenericTxPrepResponse)
async def prepare_rate_driver(
    payload: RateDriverPrepRequest,
    wallet: str = Depends(get_current_wallet),
    tx_service: TxService = Depends(get_tx_service),
) -> GenericTxPrepResponse:
    return await tx_service.prepare_rate_driver(wallet, payload)


@router.post("/tx/join-shared-ride", response_model=GenericTxPrepResponse)
async def prepare_join_shared_ride(
    payload: JoinSharedRidePrepRequest,
    wallet: str = Depends(get_current_wallet),
    tx_service: TxService = Depends(get_tx_service),
) -> GenericTxPrepResponse:
    return await tx_service.prepare_join_shared_ride(wallet, payload)


@router.post("/tx/resolve-dispute", response_model=GenericTxPrepResponse)
async def prepare_resolve_dispute(
    payload: ResolveDisputePrepRequest,
    wallet: str = Depends(get_current_wallet),
    tx_service: TxService = Depends(get_tx_service),
) -> GenericTxPrepResponse:
    _ = wallet
    return await tx_service.prepare_resolve_dispute(payload)


@router.post("/tx/dispute-ride", response_model=GenericTxPrepResponse)
async def prepare_dispute_ride(
    payload: DisputeRidePrepRequest,
    wallet: str = Depends(get_current_wallet),
    tx_service: TxService = Depends(get_tx_service),
) -> GenericTxPrepResponse:
    return await tx_service.prepare_dispute_ride(wallet, payload)
