from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.tx.schemas import AcceptRidePrepRequest
from app.tx.service import TxService


class FakeAcquire:
    def __init__(self, conn):
        self.conn = conn

    async def __aenter__(self):
        return self.conn

    async def __aexit__(self, exc_type, exc, tb):
        return False


class FakePool:
    def __init__(self, conn):
        self._conn = conn

    def acquire(self):
        return FakeAcquire(self._conn)


class FakeConnection:
    def __init__(self, ride=None, selected_offer=None):
        self.ride = ride
        self.selected_offer = selected_offer
        self.calls = 0

    async def fetchrow(self, query, *args):
        self.calls += 1
        if "FROM ride_requests" in query:
            return self.ride
        if "FROM driver_offers" in query:
            return self.selected_offer
        return None


@pytest.mark.asyncio
async def test_prepare_accept_ride_happy_path_uses_stored_offer_values(monkeypatch):
    monkeypatch.setattr("app.tx.service.settings", SimpleNamespace(carpool_contract_address="0xabc", ceiling_bond_percent=20))

    ride = {"id": "r1", "rider_wallet": "0xrider", "status": "DRIVER_SELECTED"}
    selected = {
        "driver_wallet": "0xdriver",
        "quoted_fare_wei": "900000000000000",
        "driver_signature": "0xsig",
        "driver_nonce": 7,
        "ceiling_enabled": True,
        "keys": lambda: ["driver_signature", "driver_nonce", "ceiling_enabled"],
    }

    conn = FakeConnection(ride=ride, selected_offer=selected)
    db = SimpleNamespace(pool=FakePool(conn))
    service = TxService(db)

    payload = AcceptRidePrepRequest(
        rideId="r1",
        driverSignature="0xfallback",
        ceilingEnabled=False,
        chainId=11155111,
        driverNonce=0,
    )

    res = await service.prepare_accept_ride("0xRider", payload)

    assert res.functionName == "acceptRide"
    assert res.driverWallet == "0xdriver"
    assert res.driverSignature == "0xsig"
    assert res.driverNonce == 7
    assert res.ceilingEnabled is True
    assert res.ceilingBondWei == "180000000000000"
    assert res.requiredMsgValueWei == "1080000000000000"


@pytest.mark.asyncio
async def test_prepare_accept_ride_rejects_non_owner(monkeypatch):
    monkeypatch.setattr("app.tx.service.settings", SimpleNamespace(carpool_contract_address="0xabc", ceiling_bond_percent=20))

    ride = {"id": "r1", "rider_wallet": "0xrider", "status": "DRIVER_SELECTED"}
    conn = FakeConnection(ride=ride, selected_offer=None)
    service = TxService(SimpleNamespace(pool=FakePool(conn)))

    payload = AcceptRidePrepRequest(
        rideId="r1",
        driverSignature="0xabc",
        ceilingEnabled=False,
        chainId=11155111,
        driverNonce=0,
    )

    with pytest.raises(HTTPException) as exc:
        await service.prepare_accept_ride("0xother", payload)

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_prepare_accept_ride_rejects_wrong_status(monkeypatch):
    monkeypatch.setattr("app.tx.service.settings", SimpleNamespace(carpool_contract_address="0xabc", ceiling_bond_percent=20))

    ride = {"id": "r1", "rider_wallet": "0xrider", "status": "OPEN"}
    conn = FakeConnection(ride=ride, selected_offer=None)
    service = TxService(SimpleNamespace(pool=FakePool(conn)))

    payload = AcceptRidePrepRequest(
        rideId="r1",
        driverSignature="0xabc",
        ceilingEnabled=False,
        chainId=11155111,
        driverNonce=0,
    )

    with pytest.raises(HTTPException) as exc:
        await service.prepare_accept_ride("0xrider", payload)

    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_prepare_accept_ride_requires_selected_offer(monkeypatch):
    monkeypatch.setattr("app.tx.service.settings", SimpleNamespace(carpool_contract_address="0xabc", ceiling_bond_percent=20))

    ride = {"id": "r1", "rider_wallet": "0xrider", "status": "DRIVER_SELECTED"}
    conn = FakeConnection(ride=ride, selected_offer=None)
    service = TxService(SimpleNamespace(pool=FakePool(conn)))

    payload = AcceptRidePrepRequest(
        rideId="r1",
        driverSignature="0xabc",
        ceilingEnabled=False,
        chainId=11155111,
        driverNonce=0,
    )

    with pytest.raises(HTTPException) as exc:
        await service.prepare_accept_ride("0xrider", payload)

    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_prepare_accept_ride_fallback_to_payload_when_offer_fields_absent(monkeypatch):
    monkeypatch.setattr("app.tx.service.settings", SimpleNamespace(carpool_contract_address="0xabc", ceiling_bond_percent=20))

    ride = {"id": "r1", "rider_wallet": "0xrider", "status": "DRIVER_SELECTED"}
    selected = {
        "driver_wallet": "0xdriver",
        "quoted_fare_wei": 1000,
        "keys": lambda: [],
    }

    conn = FakeConnection(ride=ride, selected_offer=selected)
    service = TxService(SimpleNamespace(pool=FakePool(conn)))

    payload = AcceptRidePrepRequest(
        rideId="r1",
        driverSignature="0xpayloadsig",
        ceilingEnabled=True,
        chainId=11155111,
        driverNonce=3,
    )

    res = await service.prepare_accept_ride("0xrider", payload)

    assert res.driverSignature == "0xpayloadsig"
    assert res.driverNonce == 3
    assert res.ceilingEnabled is True
    assert res.ceilingBondWei == "200"
    assert res.requiredMsgValueWei == "1200"
