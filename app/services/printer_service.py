"""Ticket térmico Custom Modus 3X — Windows (win32print)."""

from __future__ import annotations

import logging
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

import qrcode
from PIL import Image, ImageDraw, ImageFont, ImageWin

from core.state import app_state

_logger = logging.getLogger("kiosco.printer")

MSG_PRINTER_MISSING = (
    "Impresión de ticket no disponible: no se encontró la impresora configurada en este equipo Windows."
)
MSG_PRINTER_NON_WINDOWS = "Impresión de ticket no disponible: el backend no está ejecutándose en Windows."

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


def generate_qr_image(transaction_id: str, size: int = 150) -> Image.Image:
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=4,
        border=2,
    )
    qr.add_data(transaction_id)
    qr.make(fit=True)
    qr_img = qr.make_image(fill_color="black", back_color="white").convert("L")
    return qr_img.resize((size, size), Image.LANCZOS)


class PrinterService:
    def __init__(self, printer_name: str, logo_path: Path | None = None) -> None:
        self._printer_name = printer_name
        self._logo_path = logo_path

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
        width = 384
        height = 1200
        ticket = Image.new("L", (width, height), 255)
        draw = ImageDraw.Draw(ticket)
        y = 15

        try:
            font_bold = ImageFont.truetype("arialbd.ttf", 16)
            font_reg = ImageFont.truetype("arial.ttf", 14)
        except OSError:
            font_bold = ImageFont.load_default()
            font_reg = ImageFont.load_default()

        if self._logo_path and self._logo_path.is_file():
            try:
                logo = Image.open(self._logo_path).convert("L")
                lw = min(width - 30, logo.width)
                lh = int(logo.height * (lw / logo.width))
                logo = logo.resize((lw, lh), Image.LANCZOS)
                x0 = (width - lw) // 2
                ticket.paste(logo, (x0, y))
                y += lh + 15
            except Exception as e:
                _logger.warning("No se pudo cargar logo: %s", e)

        tx_id = str(payload.get("transaction_id", ""))
        items = payload.get("items") or []
        total = float(payload.get("total", 0))
        method = str(payload.get("payment_method", ""))
        last4 = payload.get("last_four")
        auth = payload.get("authorization") or payload.get("autorizacion")
        voucher = payload.get("voucher")

        lines = [
            datetime.now().strftime("%Y-%m-%d %H:%M"),
            f"ID: {tx_id}",
            "—" * 20,
        ]
        for line in lines:
            draw.text((15, y), line, fill=0, font=font_reg)
            y += 22

        for it in items:
            name = str(it.get("name", ""))[:22]
            qty = int(it.get("qty", 1))
            price = float(it.get("price", 0))
            draw.text((15, y), f"{qty}x {name}", fill=0, font=font_reg)
            draw.text((width - 120, y), f"${price * qty:.2f}", fill=0, font=font_reg)
            y += 22

        y += 6
        draw.line((15, y, width - 15, y), fill=0, width=1)
        y += 12
        draw.text((15, y), f"TOTAL: ${total:.2f}", fill=0, font=font_bold)
        y += 28
        pay_line = f"Pago: {method}"
        if last4:
            pay_line += f" ****{last4}"
        draw.text((15, y), pay_line, fill=0, font=font_reg)
        y += 28

        if auth:
            draw.text((15, y), f"Aut.: {str(auth)[:32]}", fill=0, font=font_reg)
            y += 22
        if voucher:
            v = str(voucher).replace("\n", " ").strip()
            if len(v) > 40:
                v = v[:37] + "..."
            draw.text((15, y), f"Voucher: {v}", fill=0, font=font_reg)
            y += 22

        qr_img = generate_qr_image(tx_id)
        qx = (width - qr_img.width) // 2
        ticket.paste(qr_img, (qx, y))
        y += qr_img.height + 14
        draw.text((15, y), "Gracias por tu compra", fill=0, font=font_reg)

        y += 30
        return ticket.crop((0, 0, width, y))

    def print_ticket(self, payload: dict[str, Any]) -> None:
        if sys.platform != "win32" or win32print is None or win32ui is None:
            raise RuntimeError("Impresión solo soportada en Windows con pywin32")

        ticket = self.build_ticket_image(payload)
        img_rgb = ticket.convert("RGB")

        hprinter = win32print.OpenPrinter(self._printer_name)
        try:
            hdc = win32ui.CreateDC()
            hdc.CreatePrinterDC(self._printer_name)
            hdc.StartDoc("Kiosco Cinemex")
            hdc.StartPage()
            dib = ImageWin.Dib(img_rgb)
            mm_to_pixels = hdc.GetDeviceCaps(win32con.LOGPIXELSX) / 25.4
            target_width_px = int(76 * mm_to_pixels)
            scale = target_width_px / ticket.width
            target_height_px = int(ticket.height * scale)
            dib.draw(hdc.GetHandleOutput(), (0, 0, target_width_px, target_height_px))
            hdc.EndPage()
            hdc.EndDoc()
            hdc.DeleteDC()
        finally:
            win32print.ClosePrinter(hprinter)
