"""Logs diarios en logs/YYYY-MM-DD.log (PRD §14)."""

import logging
from datetime import datetime
from pathlib import Path

# Fragmentos que identifican peticiones de sondeo rutinario.
# Se filtran en TODOS los handlers para no saturar el log.
# Las peticiones siguen enviándose; solo se omite su registro.
_POLLING_SUBSTRINGS = (
    "/api/SystemStatus",  # watchdog CPI
    "/emv/health",        # watchdog IM30
    "GET /api/status ",   # frontend → FastAPI (uvicorn access log)
)


class _PollingFilter(logging.Filter):
    """Suprime entradas de sondeo de alta frecuencia que no aportan valor diagnóstico."""

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        return not any(pat in msg for pat in _POLLING_SUBSTRINGS)


def setup_logging(log_dir: Path) -> None:
    log_dir.mkdir(parents=True, exist_ok=True)
    day = datetime.now().strftime("%Y-%m-%d")
    log_file = log_dir / f"{day}.log"

    fmt = logging.Formatter(
        fmt="[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    noise = _PollingFilter()

    root = logging.getLogger()
    root.setLevel(logging.INFO)

    fh = logging.FileHandler(log_file, encoding="utf-8")
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(fmt)
    fh.addFilter(noise)

    ch = logging.StreamHandler()
    ch.setLevel(logging.INFO)
    ch.setFormatter(fmt)
    ch.addFilter(noise)

    root.handlers.clear()
    root.addHandler(fh)
    root.addHandler(ch)
