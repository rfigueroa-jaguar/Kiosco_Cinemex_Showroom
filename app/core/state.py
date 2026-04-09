"""Estado global en memoria (PRD §3.3)."""

from typing import Any

app_state: dict[str, Any] = {
    "services": {
        "cpi": {"available": False, "status": "unknown"},
        "im30": {"available": False, "status": "unknown"},
        "printer": {"available": False, "status": "unknown"},
    },
    "active_transaction": None,
    "recovery": None,
}
