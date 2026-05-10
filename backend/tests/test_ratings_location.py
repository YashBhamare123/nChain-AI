import asyncio
import os

import asyncpg
from fastapi.testclient import TestClient

from app.main import create_app

TEST_DB_URL = os.getenv("TEST_DATABASE_URL", "postgresql://postgres:password@localhost:5432/offchain")


def clean_tables() -> None:
    async def _clean() -> None:
        conn = await asyncpg.connect(TEST_DB_URL)
        try:
            await conn.execute("DELETE FROM ride_ratings")
            await conn.execute("DELETE FROM ride_locations")
            await conn.execute("DELETE FROM driver_offers")
            await conn.execute("DELETE FROM ride_requests")
            await conn.execute("DELETE FROM auth_nonces")
            await conn.execute("DELETE FROM sessions")
            await conn.execute("DELETE FROM drivers")
            await conn.execute("DELETE FROM users")
        finally:
            await conn.close()

    asyncio.run(_clean())


def create_test_client() -> TestClient:
    os.environ["DATABASE_URL"] = TEST_DB_URL
    app = create_app(init_db=True)
    return TestClient(app)


def auth_headers(client: TestClient, wallet: str) -> dict[str, str]:
    nonce = client.post("/api/v1/auth/nonce", json={"wallet": wallet}).json()["nonce"]
    from eth_account import Account
    from eth_account.messages import encode_defunct

    key = "0x59c6995e998f97a5a0044966f094538ce2f5df9d2f95b9f78f4f9f8eb5f5f6d3"
    acct = Account.from_key(key)
    msg = encode_defunct(text=f"Sign this nonce to login: {nonce}")
    sig = Account.sign_message(msg, private_key=key).signature.hex()
    # force wallet to signer address for deterministic auth
    wallet = acct.address.lower()
    verify = client.post("/api/v1/auth/verify", json={"wallet": wallet, "nonce": nonce, "signature": sig})
    token = verify.json()["accessToken"]
    return {"Authorization": f"Bearer {token}"}, wallet


def _seed_ride(conn, ride_id: str, rider_wallet: str, driver_wallet: str, status: str = "COMPLETED"):
    return conn.execute(
        """
        INSERT INTO ride_requests(
            id, rider_wallet, pickup_lat, pickup_lng, pickup_address,
            drop_lat, drop_lng, drop_address, distance_meters, duration_seconds,
            tip_type, tip_value, tip_wei, selected_driver_wallet, status
        ) VALUES($1,$2,12.97,77.59,'A',12.98,77.60,'B',1000,600,'percent',10,'1000',$3,$4)
        """,
        ride_id,
        rider_wallet,
        driver_wallet,
        status,
    )


def test_rate_ride_once_only_and_driver_aggregate_updates() -> None:
    clean_tables()
    with create_test_client() as client:
        headers, rider = auth_headers(client, "0x000000000000000000000000000000000000dEaD")
        driver = "0x1111111111111111111111111111111111111111"

        async def seed():
            conn = await asyncpg.connect(TEST_DB_URL)
            try:
                await conn.execute("INSERT INTO users(wallet_address, role) VALUES($1, 'driver') ON CONFLICT DO NOTHING", driver)
                await conn.execute("INSERT INTO drivers(wallet_address) VALUES($1) ON CONFLICT DO NOTHING", driver)
                await _seed_ride(conn, "ride-rate-1", rider, driver, "COMPLETED")
            finally:
                await conn.close()

        asyncio.run(seed())

        r1 = client.post(
            "/api/v1/rides/ride-rate-1/rate",
            headers=headers,
            json={"rating": 5, "reviewCidHash": "0x" + "11" * 32},
        )
        assert r1.status_code == 200
        assert r1.json()["driverStats"]["ratingCount"] == 1
        assert r1.json()["reviewCidHash"] == "0x" + "11" * 32

        r2 = client.post(
            "/api/v1/rides/ride-rate-1/rate",
            headers=headers,
            json={"rating": 4, "reviewCidHash": "0x" + "22" * 32},
        )
        assert r2.status_code == 409


def test_location_update_auto_completes_when_near_dropoff() -> None:
    clean_tables()
    with create_test_client() as client:
        # rider
        rider_headers, rider = auth_headers(client, "0x000000000000000000000000000000000000dEaD")
        # driver login via known key as well
        driver_headers, driver = auth_headers(client, "0x000000000000000000000000000000000000bEEF")

        async def seed():
            conn = await asyncpg.connect(TEST_DB_URL)
            try:
                await conn.execute("INSERT INTO users(wallet_address, role) VALUES($1, 'driver') ON CONFLICT DO NOTHING", driver)
                await _seed_ride(conn, "ride-loc-1", rider, driver, "STARTED")
            finally:
                await conn.close()

        asyncio.run(seed())

        res = client.post(
            "/api/v1/rides/ride-loc-1/locations",
            headers=driver_headers,
            json={"lat": 12.9800001, "lng": 77.6000001, "speed": 0.5},
        )
        assert res.status_code == 200

        ride = client.get("/api/v1/rides/ride-loc-1", headers=rider_headers)
        assert ride.status_code == 200
        assert ride.json()["status"] == "COMPLETED"
