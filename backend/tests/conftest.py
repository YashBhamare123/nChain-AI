import os
import socket
import pytest

INTEGRATION_FILES = {
    "test_auth.py",
    "test_chain_sync.py",
    "test_db_layer.py",
    "test_e2e_flow.py",
    "test_maps.py",
    "test_marketplace.py",
    "test_ratings_location.py",
    "test_treasury.py",
    "test_tx.py",
}


def _postgres_available() -> bool:
    db_url = os.getenv("DATABASE_URL", "postgresql://postgres:password@localhost:5432/offchain")
    if "localhost:5432" not in db_url and "127.0.0.1:5432" not in db_url:
        return True
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(0.2)
    try:
        return sock.connect_ex(("127.0.0.1", 5432)) == 0
    finally:
        sock.close()


def pytest_collection_modifyitems(config, items):
    if _postgres_available():
        return

    skip_integration = pytest.mark.skip(reason="Postgres not available on localhost:5432; skipping DB integration tests")
    for item in items:
        if item.fspath.basename in INTEGRATION_FILES:
            item.add_marker(skip_integration)
