import os


class Settings:
    def __init__(self) -> None:
        self.database_url = os.getenv(
            "DATABASE_URL",
            "postgresql://postgres:password@localhost:5432/offchain",
        )
        self.jwt_secret = os.getenv("JWT_SECRET", "")
        self.jwt_algorithm = "HS256"
        self.nonce_ttl_seconds = 300
        self.access_token_ttl_seconds = 3600
        self.google_maps_api_key = os.getenv("GOOGLE_MAPS_API_KEY", "")
        self.google_maps_default_country = os.getenv("GOOGLE_MAPS_DEFAULT_COUNTRY", "")
        self.google_maps_timeout_seconds = float(os.getenv("GOOGLE_MAPS_TIMEOUT_SECONDS", "8"))
        self.base_fare_wei = int(os.getenv("BASE_FARE_WEI", "200000000000000"))
        self.per_km_rate_wei = int(os.getenv("PER_KM_RATE_WEI", "70000000000000"))
        self.per_min_rate_wei = int(os.getenv("PER_MIN_RATE_WEI", "10000000000000"))
        self.service_fee_percent = float(os.getenv("SERVICE_FEE_PERCENT", "5"))
        self.min_fare_wei = int(os.getenv("MIN_FARE_WEI", "250000000000000"))
        self.surge_multiplier = float(os.getenv("SURGE_MULTIPLIER", "1.0"))
        self.ceiling_bond_percent = float(os.getenv("CEILING_BOND_PERCENT", "20"))
        self.carpool_contract_address = os.getenv(
            "CARPOOL_CONTRACT_ADDRESS",
            "0x0000000000000000000000000000000000000000",
        )
        self.treasury_private_key = os.getenv("TREASURY_PRIVATE_KEY", "")
        self.chain_rpc_url = os.getenv("CHAIN_RPC_URL", "")
        self.ride_auto_complete_enabled = os.getenv("RIDE_AUTO_COMPLETE_ENABLED", "true").lower() == "true"
        self.ride_auto_complete_radius_meters = float(os.getenv("RIDE_AUTO_COMPLETE_RADIUS_METERS", "60"))
        self.ride_auto_complete_max_speed_mps = float(os.getenv("RIDE_AUTO_COMPLETE_MAX_SPEED_MPS", "3.0"))
        self.pinata_jwt = os.getenv("PINATA_JWT", "")
        self.pinata_base_url = os.getenv("PINATA_BASE_URL", "https://api.pinata.cloud")
        self.pinata_review_name_prefix = os.getenv("PINATA_REVIEW_NAME_PREFIX", "nchain-review")
        self.cors_allowed_origins = self._parse_cors_allowed_origins(
            os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:8080,http://localhost:5173"),
        )
        self._validate_security_settings()

    @staticmethod
    def _parse_cors_allowed_origins(raw: str) -> list[str]:
        origins = [origin.strip() for origin in raw.split(",") if origin.strip()]
        # Defensive fallback for local development if env var is accidentally blank.
        return origins or ["http://localhost:8080", "http://localhost:5173"]

    def _validate_security_settings(self) -> None:
        if not self.jwt_secret:
            raise ValueError("JWT_SECRET is required and cannot be empty")
        if self.jwt_secret.strip().lower() in {"dev-secret", "changeme", "replace-me", "placeholder"}:
            raise ValueError("JWT_SECRET uses an insecure placeholder value")


settings = Settings()
