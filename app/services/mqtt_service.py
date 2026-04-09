"""MQTT / RedFox — stub hasta definir payloads (PRD §15)."""

import logging

_logger = logging.getLogger("kiosco.mqtt")


def publish_transaction(transaction_data: dict) -> None:
    """TODO: implementar cuando se definan los payloads."""
    _logger.debug("publish_transaction stub: keys=%s", list(transaction_data.keys()))


def publish_fatal_error(message: str) -> None:
    """Notificación best-effort antes de caer el proceso."""
    _logger.warning("publish_fatal_error stub: %s", message[:500])
