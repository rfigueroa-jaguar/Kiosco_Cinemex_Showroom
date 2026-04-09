"""Carga prod.yaml."""

from pathlib import Path
from typing import Any

import yaml


def load_prod_config(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    with path.open(encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    return data
