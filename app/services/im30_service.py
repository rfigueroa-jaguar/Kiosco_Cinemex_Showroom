"""EMVBridge IM30 — HTTP (puerto 6000 por defecto)."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from core.state import app_state
from settings import Settings

_logger = logging.getLogger("kiosco.im30")


class IM30Service:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        host = settings.im30_host or "localhost"
        port = settings.im30_port
        self._base = f"http://{host}:{port}"
        self._client: httpx.AsyncClient | None = None
        self._sale_lock = asyncio.Lock()

    async def startup_check(self) -> None:
        self._client = httpx.AsyncClient(base_url=self._base, timeout=120.0)
        try:
            h = await self.health_raw()
            ok = h.get("status") == "ok"
            app_state["services"]["im30"] = {
                "available": ok,
                "status": "ok" if ok else "bad_health",
            }
        except Exception as e:
            _logger.warning("IM30 no responde en arranque: %s", e)
            app_state["services"]["im30"] = {"available": False, "status": "unreachable"}

    async def shutdown(self) -> None:
        if self._client:
            await self._client.aclose()
            self._client = None

    def _headers(self) -> dict[str, str]:
        tok = self._settings.emv_bridge_token
        if not tok:
            return {}
        return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}

    async def health_raw(self) -> dict[str, Any]:
        if not self._client:
            raise RuntimeError("Cliente IM30 no inicializado")
        r = await self._client.get("/emv/health")
        r.raise_for_status()
        return r.json()

    async def refresh_watchdog_state(self) -> None:
        if not self._client:
            return
        try:
            h = await self.health_raw()
            ok = h.get("status") == "ok" and h.get("listener") is True
            app_state["services"]["im30"] = {
                "available": ok,
                "status": "ok" if ok else "degraded",
            }
        except Exception:
            _logger.exception("Watchdog IM30 falló")
            app_state["services"]["im30"] = {"available": False, "status": "watchdog_error"}

    async def ensure_logged_in(self) -> tuple[bool, str]:
        """
        Antes de /emv/sale: GET /emv/health; si loggedIn es false, POST /emv/login.
        Si login falla, marcar servicio no disponible y no intentar venta.
        """
        if not self._client:
            return False, "Cliente no inicializado"
        try:
            h = await self.health_raw()
        except Exception as e:
            msg = f"Health IM30 falló: {e}"
            _logger.warning(msg)
            app_state["services"]["im30"] = {"available": False, "status": "unreachable"}
            return False, msg

        if h.get("loggedIn") is True:
            return True, "ok"

        user = self._settings.im30_user
        pwd = self._settings.im30_password
        if not user or not pwd:
            msg = "IM30_USER / IM30_PASSWORD no configurados — no se puede hacer login"
            _logger.warning(msg)
            app_state["services"]["im30"] = {"available": False, "status": "no_credentials"}
            return False, msg

        r = await self._client.post(
            "/emv/login",
            headers=self._headers(),
            json={
                "usuario": user,
                "password": pwd,
                "url": "https://vip.e-pago.com.mx",
            },
        )
        if r.status_code >= 400:
            msg = f"Login IM30 falló HTTP {r.status_code}: {r.text[:300]}"
            _logger.warning(msg)
            app_state["services"]["im30"] = {"available": False, "status": "login_failed"}
            return False, msg

        try:
            h2 = await self.health_raw()
        except Exception as e:
            msg = f"Health tras login falló: {e}"
            _logger.warning(msg)
            app_state["services"]["im30"] = {"available": False, "status": "health_after_login"}
            return False, msg

        if h2.get("loggedIn") is not True:
            msg = "Login reportó éxito pero loggedIn sigue en false"
            _logger.warning(msg)
            app_state["services"]["im30"] = {"available": False, "status": "not_logged_in"}
            return False, msg

        app_state["services"]["im30"] = {"available": True, "status": "ok"}
        return True, "ok"

    async def sale(self, referencia: str, monto: float) -> dict[str, Any]:
        """Serializado — no ventas paralelas (409 EMV_BUSY)."""
        async with self._sale_lock:
            ok, err = await self.ensure_logged_in()
            if not ok:
                return {"success": False, "error": err, "code": "IM30_LOGIN"}

            if not self._client:
                return {"success": False, "error": "Cliente no inicializado", "code": "IM30_CLIENT"}

            r = await self._client.post(
                "/emv/sale",
                headers=self._headers(),
                json={"referencia": referencia, "monto": float(monto)},
            )

            if r.status_code == 409:
                return {
                    "success": False,
                    "error": "Terminal ocupada. Intente de nuevo.",
                    "code": "EMV_BUSY",
                }

            if r.status_code >= 400:
                try:
                    data = r.json()
                except Exception:
                    data = {"raw": r.text}
                return {
                    "success": False,
                    "error": data,
                    "code": "IM30_HTTP",
                    "http": r.status_code,
                }

            try:
                return {"success": True, "data": r.json()}
            except Exception:
                return {"success": False, "error": r.text, "code": "IM30_BAD_JSON"}
