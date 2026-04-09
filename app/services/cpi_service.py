"""
CPI Payment Service (HTTPS :5000).

Certificado Root.cer: debe instalarse en el kiosco en
"Consola de administración de certificados" → Equipo local →
Autoridades de certificación raíz de confianza → Importar Root.cer
(archivo generado en la instalación del CPI Payment Service).

Si el sujeto del certificado no contiene la subcadena configurada en
`cpi_root_cert_subject_hint` (prod.yaml), el servicio se marca como no disponible
y se registra WARNING en logs — no se realizan llamadas HTTPS que fallen por SSL
sin diagnóstico previo.
"""

from __future__ import annotations

import base64
import logging
import subprocess
import sys
from typing import Any
from urllib.parse import urlencode

import httpx

from core.state import app_state
from settings import Settings

_logger = logging.getLogger("kiosco.cpi")

MSG_CPI_NO_CREDS = (
    "Pago en efectivo no disponible: faltan credenciales del servicio CPI en la configuración del equipo."
)
MSG_CPI_NO_HOST = "Pago en efectivo no disponible: no hay host CPI configurado (CPI_HOST)."
MSG_CPI_ROOT = (
    "Pago en efectivo no disponible: falta instalar o confiar el certificado raíz CPI (Root.cer) en Windows."
)
MSG_CPI_UNREACHABLE = "Pago en efectivo no disponible: no se puede conectar al servicio CPI en la red."
MSG_CPI_RETRY_EXHAUSTED = (
    "Pago en efectivo no disponible: el servicio no respondió tras varios intentos. Revise red, CPI y credenciales."
)
MSG_CPI_HARDWARE_ERROR = "Pago en efectivo no disponible: el reciclador CPI reportó un estado de error."


def verify_cpi_root_cert_trusted(subject_hint: str) -> tuple[bool, str]:
    """
    Comprueba en Windows que exista al menos un certificado en Root\\LocalMachine
    cuyo Subject o Issuer contenga `subject_hint` (case-insensitive).
    """
    if sys.platform != "win32":
        return True, "Omitido: no es Windows (desarrollo)"

    if not subject_hint.strip():
        return False, "cpi_root_cert_subject_hint vacío — configure un texto presente en el Subject/Issuer de Root.cer instalado"

    ps = (
        "$out = @(); "
        "Get-ChildItem -Path Cert:\\LocalMachine\\Root -ErrorAction SilentlyContinue | ForEach-Object { "
        "$out += $_.Subject; $out += $_.Issuer }; "
        "$out -join [Environment]::NewLine"
    )
    try:
        r = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
            capture_output=True,
            text=True,
            timeout=45,
            encoding="utf-8",
            errors="replace",
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        return False, f"No se pudo leer el almacén Root: {e}"

    blob = (r.stdout or "") + (r.stderr or "")
    if subject_hint.lower() not in blob.lower():
        return (
            False,
            f"No se encontró ningún certificado en Root\\LocalMachine cuyo Subject/Issuer "
            f"contenga el hint configurado ({subject_hint!r}). Instale Root.cer del CPI en "
            f"Autoridades de certificación raíz de confianza (equipo local).",
        )
    return True, "Root verificado (hint en almacén)"


class CPIService:
    def __init__(self, settings: Settings, subject_hint: str) -> None:
        self._settings = settings
        self._subject_hint = (subject_hint or "").strip()
        self._host = (settings.cpi_host or "localhost").strip()
        self._port = settings.cpi_port
        self._base = f"https://{self._host}:{self._port}"
        self._token: str | None = None
        self._client: httpx.AsyncClient | None = None
        self._ssl_ok = False
        self._ssl_message = ""
        self._watchdog_failures = 0

    @property
    def ssl_configured(self) -> bool:
        return self._ssl_ok

    def _credentials_complete(self) -> bool:
        s = self._settings
        return bool(s.cpi_client_id and s.cpi_client_secret and s.cpi_username and s.cpi_password)

    def _set_cpi_state(self, available: bool, status: str, message: str | None = None) -> None:
        entry: dict[str, Any] = {"available": available, "status": status}
        if message:
            entry["message"] = message
        app_state["services"]["cpi"] = entry

    async def startup_check(self) -> None:
        """Antes de cualquier llamada HTTPS: verificar confianza del Root.cer (PRD + requisito usuario)."""
        if self._settings.cpi_allow_without_root_verification:
            _logger.warning(
                "CPI: CPI_ALLOW_WITHOUT_ROOT_VERIFICATION activo — no se verificó Root.cer en el almacén (solo desarrollo)."
            )
            self._ssl_ok = True
            self._ssl_message = "Verificación omitida por configuración (dev)"
        else:
            ok, msg = verify_cpi_root_cert_trusted(self._subject_hint)
            self._ssl_ok = ok
            self._ssl_message = msg
            if not ok:
                _logger.warning("CPI no disponible: %s", msg)
                self._set_cpi_state(False, "root_cert_missing", MSG_CPI_ROOT)
                return

        if not self._host:
            _logger.warning("CPI_HOST vacío")
            self._set_cpi_state(False, "no_host", MSG_CPI_NO_HOST)
            return

        if not self._credentials_complete():
            _logger.warning("CPI: credenciales incompletas — no se iniciará cliente HTTP hasta configurar .env")
            self._set_cpi_state(False, "no_credentials", MSG_CPI_NO_CREDS)
            return

        self._client = httpx.AsyncClient(base_url=self._base, verify=True, timeout=30.0)
        try:
            st = await self.get_system_status_raw()
            self._watchdog_failures = 0
            cs = st.get("currentStatus", "unknown")
            avail = cs not in ("Error",)
            self._set_cpi_state(avail, cs, None if avail else MSG_CPI_HARDWARE_ERROR)
        except Exception as e:
            self._watchdog_failures = 1
            _logger.warning("CPI no respondió en arranque: %s", e)
            self._set_cpi_state(False, "unreachable", MSG_CPI_UNREACHABLE)

    async def shutdown(self) -> None:
        if self._client:
            await self._client.aclose()
            self._client = None

    async def _ensure_token(self) -> None:
        if self._token:
            return
        await self._fetch_token()

    async def _fetch_token(self) -> None:
        if not self._client:
            raise RuntimeError("Cliente CPI no inicializado (SSL o host no configurado)")
        cid = self._settings.cpi_client_id
        csec = self._settings.cpi_client_secret
        user = self._settings.cpi_username
        pwd = self._settings.cpi_password
        if not all([cid, csec, user, pwd]):
            raise RuntimeError("Credenciales CPI incompletas en .env")

        basic = base64.b64encode(f"{cid}:{csec}".encode()).decode()
        form = urlencode(
            {"grant_type": "password", "username": user, "password": pwd},
            encoding="utf-8",
        )
        r = await self._client.post(
            "/connect/token",
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Authorization": f"Basic {basic}",
            },
            content=form,
        )
        if r.status_code >= 400:
            raise RuntimeError(f"Token CPI falló: HTTP {r.status_code} {r.text[:200]}")
        data = r.json()
        self._token = data.get("access_token")
        if not self._token:
            raise RuntimeError("Token CPI sin access_token")

    async def _request(
        self,
        method: str,
        path: str,
        *,
        allow_retry_on_401: bool = True,
        **kwargs: Any,
    ) -> httpx.Response:
        """
        Si el polling recibe 401 (token expirado), re-autenticar y reintentar una vez
        sin abortar la transacción activa en curso (requisito usuario).
        """
        if not self._client or not self._ssl_ok:
            raise RuntimeError("CPI no disponible")

        attempts = 2 if allow_retry_on_401 else 1
        last: httpx.Response | None = None
        for attempt in range(attempts):
            await self._ensure_token()
            headers = dict(kwargs.pop("headers", {}))
            headers["Authorization"] = f"Bearer {self._token}"
            last = await self._client.request(method, path, headers=headers, **kwargs)
            if last.status_code != 401:
                return last
            _logger.warning("CPI: 401 en %s — renovando token y reintentando (intento %s)", path, attempt + 1)
            self._token = None
            await self._fetch_token()

        assert last is not None
        return last

    async def get_system_status_raw(self) -> dict[str, Any]:
        r = await self._request("GET", "/api/SystemStatus")
        r.raise_for_status()
        return r.json()

    async def refresh_watchdog_state(self) -> None:
        if not self._ssl_ok:
            return
        if not self._credentials_complete():
            self._set_cpi_state(False, "no_credentials", MSG_CPI_NO_CREDS)
            return
        if not self._client:
            return
        try:
            st = await self.get_system_status_raw()
            self._watchdog_failures = 0
            cs = st.get("currentStatus", "unknown")
            avail = cs not in ("Error",)
            self._set_cpi_state(avail, cs, None if avail else MSG_CPI_HARDWARE_ERROR)
        except Exception as e:
            self._watchdog_failures = min(self._watchdog_failures + 1, 1_000)
            user_msg = MSG_CPI_RETRY_EXHAUSTED if self._watchdog_failures >= 3 else MSG_CPI_UNREACHABLE
            if self._watchdog_failures <= 3:
                _logger.warning("Watchdog CPI intento %s/3 falló: %s", self._watchdog_failures, e)
            self._set_cpi_state(False, "unreachable", user_msg)

    async def start_transaction_cents(self, value_cents: int) -> dict[str, Any]:
        body = {
            "currencyCode": "MXN",
            "transactionType": "Payment",
            "value": int(value_cents),
        }
        r = await self._request("POST", "/api/Transactions", json=body)
        if r.status_code >= 400:
            return {"error": True, "http": r.status_code, "body": r.text}
        return r.json()

    async def get_transaction(self, tx_id: str) -> dict[str, Any]:
        r = await self._request("GET", f"/api/Transactions/{tx_id}")
        if r.status_code >= 400:
            return {"error": True, "http": r.status_code, "body": r.text}
        return r.json()

    async def cancel_transaction(self, tx_id: str) -> dict[str, Any]:
        r = await self._request("GET", f"/api/Transactions/action/{tx_id}/cancel")
        if r.status_code >= 400:
            return {"error": True, "http": r.status_code, "body": r.text}
        try:
            return r.json()
        except Exception:
            return {"ok": True, "raw": r.text}

    async def list_current_transactions(self) -> list[dict[str, Any]]:
        r = await self._request("GET", "/api/Transactions/Current")
        if r.status_code >= 400:
            return []
        data = r.json()
        if isinstance(data, list):
            return data
        if isinstance(data, dict) and "items" in data:
            return list(data["items"])
        return []
