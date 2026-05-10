import importlib
import os

import pytest


def test_settings_rejects_missing_jwt_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("JWT_SECRET", raising=False)
    import app.config as config_module
    with pytest.raises(ValueError, match="JWT_SECRET is required"):
        importlib.reload(config_module)


def test_settings_rejects_placeholder_jwt_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("JWT_SECRET", "dev-secret")
    import app.config as config_module
    with pytest.raises(ValueError, match="insecure placeholder"):
        importlib.reload(config_module)


def test_settings_accepts_real_jwt_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("JWT_SECRET", "super-long-random-secret-for-tests")
    import app.config as config_module
    reloaded = importlib.reload(config_module)
    assert reloaded.settings.jwt_secret == os.environ["JWT_SECRET"]
