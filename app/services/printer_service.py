"""Ticket térmico Custom Modus 3X — Windows (win32print)."""

from __future__ import annotations

import logging
import sys
import textwrap
from datetime import datetime
from pathlib import Path
from typing import Any

import qrcode
from PIL import Image, ImageDraw, ImageFont, ImageOps, ImageWin

from core.state import app_state

_logger = logging.getLogger("kiosco.printer")

MSG_PRINTER_MISSING = (
    "Impresión de ticket no disponible: no se encontró la impresora configurada en este equipo Windows."
)
MSG_PRINTER_NON_WINDOWS = "Impresión de ticket no disponible: el backend no está ejecutándose en Windows."

# Render interno a mayor resolución; al escalar al ancho del papel mejora nitidez de texto y QR.
QUALITY_SCALE = 2
# Margen blanco alrededor del contenido (en unidades lógicas ~1 px a escala 1; se multiplica por QUALITY_SCALE).
TICKET_EDGE_PADDING = 14
# Espacio en blanco bajo "Gracias por tu compra" (antes del borde exterior), en unidades lógicas × QUALITY_SCALE.
TICKET_BOTTOM_INNER_GAP = 80
# Renglones finales con espacio (tinta blanca = invisible) antes del fin de imagen / corte.
BLANK_LINES_BEFORE_CUT = 2
# Tamaños base (se multiplican por QUALITY_SCALE en el render).
FONT_REG_PTS = 17
FONT_BOLD_PTS = 21
LINE_HEIGHT = 28
QR_BASE_PX = 188

if sys.platform == "win32":
    import win32con
    import win32print
    import win32ui
else:
    win32print = None  # type: ignore[assignment]
    win32ui = None  # type: ignore[assignment]
    win32con = None  # type: ignore[assignment]


def check_printer_available(printer_name: str) -> bool:
    if sys.platform != "win32" or win32print is None:
        return False
    try:
        printers = [p[2] for p in win32print.EnumPrinters(win32print.PRINTER_ENUM_LOCAL)]
        return printer_name in printers
    except Exception as e:
        _logger.error("Error al enumerar impresoras: %s", e)
        return False


def generate_qr_image(transaction_id: str, size: int, *, quality_scale: int = QUALITY_SCALE) -> Image.Image:
    qs = max(1, quality_scale)
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=3 + min(qs, 4),
        border=2 + qs // 2,
    )
    qr.add_data(transaction_id)
    qr.make(fit=True)
    qr_img = qr.make_image(fill_color="black", back_color="white").convert("L")
    return qr_img.resize((size, size), Image.Resampling.LANCZOS)


class PrinterService:
    def __init__(
        self,
        printer_name: str,
        logo_path: Path | None = None,
        *,
        ticket_width_mm: float = 76.0,
    ) -> None:
        self._printer_name = printer_name
        self._logo_path = logo_path
        self._ticket_width_mm = ticket_width_mm

    async def startup_check(self) -> None:
        if sys.platform != "win32":
            _logger.info("Impresora: no Windows — marcada como no disponible")
            app_state["services"]["printer"] = {
                "available": False,
                "status": "non_windows",
                "message": MSG_PRINTER_NON_WINDOWS,
            }
            return
        ok = check_printer_available(self._printer_name)
        app_state["services"]["printer"] = (
            {"available": True, "status": "ok"}
            if ok
            else {
                "available": False,
                "status": "not_found",
                "message": MSG_PRINTER_MISSING,
            }
        )
        if not ok:
            _logger.warning('Impresora "%s" no encontrada en el sistema', self._printer_name)

    async def refresh_watchdog_state(self) -> None:
        if sys.platform != "win32":
            return
        ok = check_printer_available(self._printer_name)
        app_state["services"]["printer"] = (
            {"available": True, "status": "ok"}
            if ok
            else {"available": False, "status": "not_found", "message": MSG_PRINTER_MISSING}
        )

    def build_ticket_image(self, payload: dict[str, Any]) -> Image.Image:
        qs = QUALITY_SCALE
        width = 384 * qs
        height = 1800 * qs
        ticket = Image.new("L", (width, height), 255)
        draw = ImageDraw.Draw(ticket)
        xm = int(12 * qs)
        y = int(18 * qs)

        try:
            font_bold = ImageFont.truetype("arialbd.ttf", int(FONT_BOLD_PTS * qs))
            font_reg = ImageFont.truetype("arial.ttf", int(FONT_REG_PTS * qs))
        except OSError:
            font_bold = ImageFont.load_default()
            font_reg = ImageFont.load_default()

        if self._logo_path and self._logo_path.is_file():
            try:
                logo = Image.open(self._logo_path).convert("L")
                lw = min(width - int(30 * qs), logo.width)
                lh = int(logo.height * (lw / logo.width))
                logo = logo.resize((lw, lh), Image.Resampling.LANCZOS)
                x0 = (width - lw) // 2
                ticket.paste(logo, (x0, y))
                y += lh + int(15 * qs)
            except Exception as e:
                _logger.warning("No se pudo cargar logo: %s", e)

        tx_id = str(payload.get("transaction_id", ""))
        items = payload.get("items") or []
        total = float(payload.get("total", 0))
        method = str(payload.get("payment_method", ""))
        last4 = payload.get("last_four")
        auth = payload.get("authorization") or payload.get("autorizacion")
        voucher = payload.get("voucher")

        line_height = int(LINE_HEIGHT * qs)
        draw.text((xm, y), datetime.now().strftime("%Y-%m-%d %H:%M"), fill=0, font=font_reg)
        y += line_height
        for id_line in textwrap.wrap(
            f"ID: {tx_id}",
            width=36,
            break_long_words=False,
            break_on_hyphens=True,
        ):
            draw.text((xm, y), id_line, fill=0, font=font_reg)
            y += line_height
        draw.text((xm, y), "—" * 24, fill=0, font=font_reg)
        y += line_height

        price_x = width - int(138 * qs)
        for it in items:
            name = str(it.get("name", ""))[:18]
            qty = int(it.get("qty", 1))
            price = float(it.get("price", 0))
            draw.text((xm, y), f"{qty}x {name}", fill=0, font=font_reg)
            draw.text((price_x, y), f"${price * qty:.2f}", fill=0, font=font_reg)
            y += line_height

        y += int(8 * qs)
        draw.line((xm, y, width - xm, y), fill=0, width=max(1, qs))
        y += int(14 * qs)
        draw.text((xm, y), f"TOTAL: ${total:.2f}", fill=0, font=font_bold)
        y += int(32 * qs)
        pay_line = f"Pago: {method}"
        if last4:
            pay_line += f" ****{last4}"
        draw.text((xm, y), pay_line, fill=0, font=font_reg)
        y += int(32 * qs)

        if auth:
            for auth_line in textwrap.wrap(f"Aut.: {str(auth)}", width=34, break_long_words=False):
                draw.text((xm, y), auth_line, fill=0, font=font_reg)
                y += line_height
        if voucher:
            v = str(voucher).replace("\n", " ").strip()
            for v_line in textwrap.wrap(f"Voucher: {v}", width=32, break_long_words=True):
                draw.text((xm, y), v_line, fill=0, font=font_reg)
                y += line_height

        y += int(10 * qs)
        qr_size = int(QR_BASE_PX * qs)
        qr_img = generate_qr_image(tx_id, qr_size, quality_scale=qs)
        qx = (width - qr_img.width) // 2
        ticket.paste(qr_img, (qx, y))
        y += qr_img.height + int(18 * qs)
        draw.text((xm, y), "Gracias por tu compra", fill=0, font=font_reg)
        y += int(10 * qs)
        y += line_height
        y += int(TICKET_BOTTOM_INNER_GAP * qs)
        for _ in range(BLANK_LINES_BEFORE_CUT):
            draw.text((xm, y), " ", fill=255, font=font_reg)
            y += line_height
        cropped = ticket.crop((0, 0, width, y))
        pad = int(TICKET_EDGE_PADDING * qs)
        return ImageOps.expand(cropped, border=pad, fill=255)

    def print_ticket(self, payload: dict[str, Any]) -> None:
        if sys.platform != "win32" or win32print is None or win32ui is None or win32con is None:
            raise RuntimeError("Impresión solo soportada en Windows con pywin32")

        ticket = self.build_ticket_image(payload)
        img_rgb = ticket.convert("RGB")

        hprinter = win32print.OpenPrinter(self._printer_name)
        try:
            hdc = win32ui.CreateDC()
            hdc.CreatePrinterDC(self._printer_name)
            hdc.StartDoc("Kiosco Cinemex")
            hdc.StartPage()
            try:
                halftone = getattr(win32con, "STRETCH_HALFTONE", 4)
                hdc.SetStretchBltMode(halftone)
            except Exception:
                pass
            dib = ImageWin.Dib(img_rgb)
            mm_to_pixels = hdc.GetDeviceCaps(win32con.LOGPIXELSX) / 25.4
            target_width_px = int(self._ticket_width_mm * mm_to_pixels)
            scale = target_width_px / ticket.width
            target_height_px = int(ticket.height * scale)
            dib.draw(hdc.GetHandleOutput(), (0, 0, target_width_px, target_height_px))
            hdc.EndPage()
            hdc.EndDoc()
            hdc.DeleteDC()
        finally:
            win32print.ClosePrinter(hprinter)
