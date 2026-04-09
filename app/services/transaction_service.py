"""Persistencia transaction_state.json y recuperación (PRD §12)."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

PaymentMethod = Literal["cash", "card"]
Step = Literal["waiting_payment", "printing", "waiting_qr"]


class CartItemRecord(BaseModel):
    id: str
    name: str
    qty: int
    price: float


class TransactionState(BaseModel):
    transaction_id: str
    status: str = "in_progress"
    payment_method: PaymentMethod
    amount: float
    step: Step
    items: list[CartItemRecord]
    timestamp: str
    cpi_transaction_id: str | None = None
    last_four: str | None = None
    authorization: str | None = None
    voucher: str | None = None
    last_four: str | None = None


def transaction_path(base_dir: Path, filename: str) -> Path:
    return base_dir / filename


def load_transaction(base_dir: Path, filename: str) -> TransactionState | None:
    p = transaction_path(base_dir, filename)
    if not p.is_file():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return TransactionState.model_validate(data)
    except (OSError, json.JSONDecodeError, ValueError):
        return None


def save_transaction(base_dir: Path, filename: str, state: TransactionState) -> None:
    p = transaction_path(base_dir, filename)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(state.model_dump_json(indent=2), encoding="utf-8")


def delete_transaction(base_dir: Path, filename: str) -> None:
    p = transaction_path(base_dir, filename)
    if p.is_file():
        p.unlink()


def new_transaction_id() -> str:
    return str(uuid.uuid4())


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def build_new_state(
    *,
    payment_method: PaymentMethod,
    amount: float,
    items: list[dict[str, Any]],
    step: Step = "waiting_payment",
) -> TransactionState:
    return TransactionState(
        transaction_id=new_transaction_id(),
        status="in_progress",
        payment_method=payment_method,
        amount=amount,
        step=step,
        items=[CartItemRecord.model_validate(i) for i in items],
        timestamp=utc_now_iso(),
    )


def state_to_api_dict(state: TransactionState) -> dict[str, Any]:
    return json.loads(state.model_dump_json())
