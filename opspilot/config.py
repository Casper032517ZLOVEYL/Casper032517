"""Small, explicit environment configuration. No credentials enter web assets."""

import math
import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]


def load_dotenv(path=None):
    """Read simple KEY=VALUE lines; existing process environment always wins."""
    path = Path(path or ROOT / ".env")
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, sep, value = line.partition("=")
        if not sep or not key.strip().replace("_", "a").isalnum():
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        os.environ.setdefault(key.strip(), value)


def optional_price(value):
    if value in (None, ""):
        return None
    number = float(value)
    if not math.isfinite(number) or number < 0:
        raise ValueError("Token prices must be finite nonnegative numbers")
    return number


@dataclass(frozen=True)
class Settings:
    api_key: str = ""
    model: str = ""
    base_url: str = "https://api.openai.com/v1"
    timeout: float = 20
    input_price: float | None = None
    output_price: float | None = None

    @property
    def enabled(self):
        return bool(self.api_key and self.model)

    @classmethod
    def from_env(cls, environ=None):
        env = os.environ if environ is None else environ
        base = env.get("OPSPILOT_BASE_URL", "https://api.openai.com/v1").rstrip("/")
        parsed = urlparse(base)
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("Model endpoint cannot contain credentials, query or fragment")
        if not parsed.hostname or (parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost", "::1"})):
            raise ValueError("Model endpoint requires HTTPS; HTTP is only allowed on loopback")
        timeout = float(env.get("OPSPILOT_TIMEOUT_SECONDS", "20"))
        if not math.isfinite(timeout) or not 1 <= timeout <= 60:
            raise ValueError("Timeout must be between 1 and 60 seconds")
        return cls(
            api_key=env.get("OPSPILOT_API_KEY", ""), model=env.get("OPSPILOT_MODEL", ""),
            base_url=base, timeout=timeout,
            input_price=optional_price(env.get("OPSPILOT_INPUT_USD_PER_MILLION")),
            output_price=optional_price(env.get("OPSPILOT_OUTPUT_USD_PER_MILLION")),
        )
