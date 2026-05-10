from pydantic import BaseModel, Field


class AcceptRidePrepRequest(BaseModel):
    rideId: str
    driverSignature: str
    ceilingEnabled: bool = False
    chainId: int | None = Field(default=None, ge=1)
    driverNonce: int | None = Field(default=None, ge=0)


class AcceptRidePrepResponse(BaseModel):
    contractAddress: str
    functionName: str
    riderWallet: str
    driverWallet: str
    fareWei: str
    ceilingEnabled: bool
    ceilingBondWei: str
    requiredMsgValueWei: str
    driverSignature: str
    rideId: str
    chainId: int | None
    driverNonce: int | None


class TxRecordCreateRequest(BaseModel):
    txHash: str
    chainId: int = Field(ge=1)
    action: str
    rideRequestId: str | None = None
    status: str = "submitted"


class TxRecordResponse(BaseModel):
    txHash: str
    chainId: int
    action: str
    rideRequestId: str | None = None
    status: str
    blockNumber: int | None = None
    confirmedAt: str | None = None


class CompleteRidePrepRequest(BaseModel):
    rideId: str
    chainId: int | None = Field(default=None, ge=1)


class RateDriverPrepRequest(BaseModel):
    rideId: str
    rating: int = Field(ge=1, le=5)
    reviewCidHash: str = Field(min_length=66, max_length=66, pattern=r"^0x[a-fA-F0-9]{64}$")
    chainId: int | None = Field(default=None, ge=1)


class JoinSharedRidePrepRequest(BaseModel):
    rideId: str
    refundWei: str
    incentiveWei: str
    deadline: int = Field(ge=1)
    rider1Signature: str
    driverSignature: str
    chainId: int | None = Field(default=None, ge=1)


class ResolveDisputePrepRequest(BaseModel):
    rideId: str
    payoutWei: str
    chainId: int | None = Field(default=None, ge=1)


class GenericTxPrepResponse(BaseModel):
    contractAddress: str
    functionName: str
    args: list
    msgValueWei: str = "0"
    rideId: str
    onchainRideId: int
    chainId: int | None
