"""sys.excepthook global — se registra desde main.py (PRD §11)."""

import logging
import sys
import traceback
from pathlib import Path
from typing import Callable

_logger = logging.getLogger("kiosco.excepthook")


def install_global_excepthook(log_dir: Path, on_fatal: Callable[[str], None] | None = None) -> None:
    """Instala handler para excepciones no capturadas en el hilo principal."""

    def _hook(exc_type, exc_value, exc_tb) -> None:
        if issubclass(exc_type, KeyboardInterrupt):
            sys.__excepthook__(exc_type, exc_value, exc_tb)
            return
        text = "".join(traceback.format_exception(exc_type, exc_value, exc_tb))
        _logger.error("Unhandled exception:\n%s", text)
        try:
            log_dir.mkdir(parents=True, exist_ok=True)
            from datetime import datetime

            day = datetime.now().strftime("%Y-%m-%d")
            (log_dir / f"{day}.log").open("a", encoding="utf-8").write(
                f"[FATAL] Unhandled exception:\n{text}\n"
            )
        except OSError:
            pass
        if on_fatal:
            try:
                on_fatal(text)
            except Exception:
                pass
        sys.__excepthook__(exc_type, exc_value, exc_tb)

    sys.excepthook = _hook
