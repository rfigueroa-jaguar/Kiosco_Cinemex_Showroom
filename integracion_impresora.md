# Integración Impresora — Custom Modus 3X

---

## Arquitectura de Integración

La impresora opera en Windows mediante el sistema nativo de impresión. El flujo es:

1. Generar el ticket como imagen PNG en memoria (usando `Pillow`)
2. Enviarla al driver de la impresora usando `win32print` y `win32ui`

**No se usan comandos ESC/POS ni puerto serial.** Todo va a través del driver instalado en Windows.

---

## Dependencias

```bash
pip install pillow pywin32 qrcode
```

| Librería | Uso |
|---|---|
| `PIL` (Pillow) | Generar y manipular la imagen del ticket |
| `win32print` | Abrir y cerrar el handle de la impresora |
| `win32ui` | Crear el Device Context (DC) para renderizar la imagen |
| `win32con` | Constantes del sistema (resolución, DPI) |
| `qrcode` | Generar la imagen del código QR para incrustar en el ticket |

---

## Especificaciones de la Impresora

| Parámetro | Valor |
|---|---|
| Nombre exacto del printer | `CUSTOM MODUS3 X` |
| Ancho de papel | 76mm |
| Ancho del canvas en píxeles | 384px |
| Modo de color soportado | Escala de grises (`L`) — convertir a `RGB` antes de imprimir |

---

## Verificación de Impresora al Arrancar

Antes de intentar imprimir, confirmar que la impresora está instalada en el sistema. Si no se encuentra, registrar el error y deshabilitar la función de impresión en la UI.

```python
import win32print

def check_printer_available(printer_name: str = "CUSTOM MODUS3 X") -> bool:
    """
    Verifica que la impresora esté instalada en el sistema antes de intentar imprimir.
    Retorna True si está disponible, False si no se encuentra.
    """
    try:
        printers = [p[2] for p in win32print.EnumPrinters(win32print.PRINTER_ENUM_LOCAL)]
        return printer_name in printers
    except Exception as e:
        print(f"Error al verificar impresora: {e}")
        return False
```

> ⚠️ El nombre del printer debe coincidir exactamente con el instalado en Windows. Verificar en `Dispositivos e impresoras` ante cualquier error de conexión.

---

## Generación del Código QR

El QR codifica el `transaction_id` (UUID) de la transacción. Se genera como imagen PIL y se pega en el canvas del ticket antes de imprimir.

```python
import qrcode
from PIL import Image

def generate_qr_image(transaction_id: str, size: int = 150) -> Image.Image:
    """
    Genera una imagen PIL del QR a partir del transaction_id.
    El parámetro size define el ancho y alto en píxeles del QR en el ticket.
    """
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
```

**Pegar el QR en el canvas del ticket:**

```python
qr_img = generate_qr_image(transaction_id)
qr_x = (width - qr_img.width) // 2  # Centrado horizontalmente
ticket.paste(qr_img, (qr_x, y_position))
y_position += qr_img.height + 10
```

---

## Generación del Ticket (Canvas)

```python
from PIL import Image, ImageDraw, ImageFont

width = 384       # Ancho fijo del ticket en píxeles (~76mm)
height = 800      # Alto inicial — se recorta al final según el contenido
ticket = Image.new("L", (width, height), 255)  # "L" = escala de grises, fondo blanco
draw = ImageDraw.Draw(ticket)
```

### Fuentes recomendadas

```python
font_bold    = ImageFont.truetype("arialbd.ttf", 14)
font_regular = ImageFont.truetype("arial.ttf", 14)
```

Si Arial no está disponible, usar `ImageFont.load_default()` como fallback.

### Recortar espacio sobrante al final

```python
ticket = ticket.crop((0, 0, width, y_position + 20))
```

Siempre recortar el canvas al contenido real antes de imprimir para evitar papel en blanco sobrante.

---

## Envío a la Impresora

```python
import win32print
import win32ui
import win32con
from PIL import ImageWin

printer_name = "CUSTOM MODUS3 X"

hprinter = win32print.OpenPrinter(printer_name)
try:
    hdc = win32ui.CreateDC()
    hdc.CreatePrinterDC(printer_name)
    hdc.StartDoc("Nombre del documento")
    hdc.StartPage()

    # Convertir a RGB (requerido por Windows para imprimir)
    img_rgb = ticket.convert("RGB")
    dib = ImageWin.Dib(img_rgb)

    # Calcular escala para ajustar al ancho de 76mm según DPI de la impresora
    mm_to_pixels = hdc.GetDeviceCaps(win32con.LOGPIXELSX) / 25.4
    target_width_px = int(76 * mm_to_pixels)
    scale = target_width_px / ticket.width
    target_height_px = int(ticket.height * scale)

    # Renderizar imagen en la impresora
    dib.draw(hdc.GetHandleOutput(), (0, 0, target_width_px, target_height_px))

    hdc.EndPage()
    hdc.EndDoc()
    hdc.DeleteDC()
finally:
    win32print.ClosePrinter(hprinter)
```

---

## Impresión de Múltiples Copias

Envolver el bloque anterior en un `for` sobre el número de copias requeridas. Abrir y cerrar el handle del printer en cada iteración.

```python
for i in range(num_copies):
    # ... bloque completo de impresión
```

---

## Manejo de Errores

Envolver todo en `try/except`. Si la impresora no está disponible, capturar la excepción y notificar al usuario en la UI — nunca dejar que un fallo de impresora corte el flujo de la transacción.

```python
try:
    # bloque de impresión
except Exception as e:
    # Loggear el error y mostrar mensaje en UI
    # La transacción ya se completó — el ticket es secundario
    print(f"Error al imprimir: {e}")
```

---

## Estructura Recomendada del Ticket

| Zona | Contenido |
|---|---|
| Logo | Centrado en la parte superior (imagen PIL pegada con `paste()`) |
| Header | Datos de la operación: tipo, fecha, ID de transacción |
| Separador | Línea horizontal `draw.line()` |
| Cuerpo | Detalle de productos o denominaciones en columnas |
| Separador | Línea horizontal |
| Totales | Total de la operación |
| QR | Imagen del QR generada con `qrcode` y pegada con `paste()` |

### Espaciado recomendado

| Elemento | Separación vertical |
|---|---|
| Entre líneas de texto | 25px |
| Entre filas de tabla | 20px |
| Después de separadores | 10px |
| Margen izquierdo general | 15px |
