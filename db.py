from __future__ import annotations

import os
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from psycopg import Connection, connect
from psycopg.rows import dict_row


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


def get_database_url() -> str:
    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        raise RuntimeError("La variable d'environnement DATABASE_URL est obligatoire.")
    return database_url


def get_connection() -> Connection:
    return connect(get_database_url(), row_factory=dict_row)


@contextmanager
def transaction() -> Iterator[Connection]:
    with get_connection() as conn:
        with conn.transaction():
            yield conn