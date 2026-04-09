"""Estado global en memoria (PRD §3.3)."""

from typing import Any

app_state: dict[str, Any] = {
    "services": {
        # Opcional: "message" — texto para mostrar en la UI si available es False
        "cpi": {"available": False, "status": "unknown"},
        "im30": {"available": False, "status": "unknown"},
        "printer": {"available": False, "status": "unknown"},
    },
    "active_transaction": None,
    "recovery": None,
}
