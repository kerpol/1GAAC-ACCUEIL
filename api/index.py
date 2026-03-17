from __future__ import annotations

import importlib.util
from pathlib import Path


def _load_backend_app():
    root = Path(__file__).resolve().parent.parent
    backend_path = root / "app.py"

    spec = importlib.util.spec_from_file_location("backend_app", backend_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Impossible de charger le backend FastAPI.")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.app


app = _load_backend_app()
