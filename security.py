from __future__ import annotations

import os
import time
from pathlib import Path

import jwt
from jwt import ExpiredSignatureError, InvalidTokenError

from models import StatePayload


class StateTokenError(ValueError):
    pass


def load_env_file(env_path: str = ".env") -> None:
    path = Path(env_path)
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


load_env_file()


def get_jwt_secret() -> str:
    secret = os.getenv("JWT_STATE_SECRET", "").strip()
    if not secret:
        raise RuntimeError("La variable d'environnement JWT_STATE_SECRET est obligatoire.")
    return secret


def sign_state(payload: dict[str, str], expires_in_seconds: int = 7200) -> str:
    now = int(time.time())
    token_payload = {
        **payload,
        "ts": now,
        "exp": now + expires_in_seconds,
    }
    return jwt.encode(token_payload, get_jwt_secret(), algorithm="HS256")


def verify_state(token: str) -> StatePayload:
    try:
        decoded = jwt.decode(token, get_jwt_secret(), algorithms=["HS256"])
        return StatePayload.model_validate(decoded)
    except ExpiredSignatureError as exc:
        raise StateTokenError("Le lien de confirmation a expiré. Merci de recommencer l'inscription.") from exc
    except InvalidTokenError as exc:
        raise StateTokenError("Le paramètre state est invalide.") from exc
    except Exception as exc:
        raise StateTokenError("Impossible de valider le paramètre state.") from exc