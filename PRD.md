# PRD — Kiosco Cinemex (Dulcería Virtual)

> **Versión:** 1.1  
> **Desarrollador:** Rudy  
> **Fecha objetivo:** 24 de Abril  
> **SO:** Windows 11  
> **Tipo:** Demo standalone — desde cero  
> **Integración MQTT/RedFox:** ⏳ Diferida (pendiente de definición de payloads; ver §15)  
> **Notas v1.1:** Reglas de implementación acordadas (CPI SSL, token, IM30, polling UI, ErrorBoundary) y **modelo unificado Watchdog vs Task Scheduler** en §3.5, §11, §13 y §16.

---

## 1. Objetivo

Desarrollar una aplicación demostrativa de punto de venta para una dulcería de cine. El usuario puede explorar un catálogo fijo de productos, armar su carrito, pagar en efectivo o con tarjeta, recibir un ticket físico con QR y verificar su compra escaneándolo. El objetivo es demostrar un flujo POS completo integrado con hardware real a futuros clientes.

---

## 2. Stack Tecnológico

| Capa | Tecnología | Rol |
|---|---|---|
| Frontend | React + TypeScript | UI del kiosco |
| Componentes UI | Blueprint.js v6 | Sistema de diseño — ver `UI_GUIDELINES.md` |
| Backend | Python + FastAPI | Lógica de negocio, integración de hardware |
| Desktop shell | Electron | Empaqueta el frontend como `.exe`, gestiona el proceso Python |
| Comunicación interna | HTTP / WebSocket | React ↔ FastAPI (localhost) |
| Estilos | CSS puro con variables | Sin Tailwind, sin styled-components |

**Flujo de arranque:** Electron inicia → lanza FastAPI como proceso hijo → abre ventana React en fullscreen → React se comunica con FastAPI por HTTP.

---

## 3. Arquitectura

### 3.1 Flujo de Arranque Detallado

```
Usuario enciende el kiosco
        ↓
Task Scheduler de Windows ejecuta el .exe (electron-builder)
        ↓
Electron (main.js) arranca
        ↓
Electron lanza Python (main.py) como proceso hijo
├── Esperar a que FastAPI esté listo (polling GET /health cada 500ms)
└── Timeout de 10 segundos — si FastAPI no levanta, mostrar pantalla de error
        ↓
FastAPI levanta en localhost:8000
├── Inicializa servicios: CPI, IM30, impresora
├── Verifica transaction_state.json (recuperación ante fallos)
└── Expone endpoints REST para el frontend
        ↓
Electron abre BrowserWindow en fullscreen
├── Sin frame, sin barra de menú, sin DevTools en producción
├── Kiosk mode: true — bloquea acceso al SO
└── Carga la app React desde el build estático
        ↓
React arranca → llama GET /api/status → recibe estado de todos los servicios
        ↓
Mostrar pantalla de bienvenida
```

### 3.2 Comunicación Interna React ↔ FastAPI

Toda comunicación entre el frontend y el backend es HTTP sobre `localhost:8000`. No se expone ningún puerto al exterior.

**Convención de rutas FastAPI:**

| Prefijo | Responsabilidad |
|---|---|
| `/health` | Health check — usado por Electron para saber cuándo FastAPI está listo |
| `/api/status` | Estado general de la app y servicios |
| `/api/catalog` | Endpoints del catálogo de productos |
| `/api/cart` | Estado del carrito (opcional — puede vivir solo en React) |
| `/api/payment/cash` | Flujo de pago en efectivo (CPI) |
| `/api/payment/card` | Flujo de pago con tarjeta (IM30) |
| `/api/transaction` | Lectura/escritura de `transaction_state.json` |
| `/api/printer` | Impresión de ticket |
| `/api/mqtt` | Publicación de eventos MQTT (pendiente) |

**Convención de respuestas:**

```json
// Éxito
{ "success": true, "data": { ... } }

// Error
{ "success": false, "error": "Mensaje legible", "code": "ERROR_CODE" }
```

React nunca debe contener lógica de hardware — todo pasa por FastAPI.

### 3.3 Estado Global

**Python (FastAPI — `core/state.py`):**

```python
app_state = {
    "services": {
        "cpi":     { "available": bool, "status": str },
        "im30":    { "available": bool, "status": str },
        "printer": { "available": bool, "status": str },
    },
    "active_transaction": None,  # TransactionState | None (uso interno / depuración)
    "recovery": None,           # dict | None — acción de recuperación tras crash (expuesto en GET /api/status)
}
```

El estado de servicios se actualiza al arrancar, por el **watchdog** en runtime (§13) y cuando un servicio reporta un error. React lo consulta vía `GET /api/status` al iniciar y cuando necesita reflejar disponibilidad de métodos de pago o recuperación (§12).

**React (`store/`):**

El estado del carrito y la navegación entre pantallas viven completamente en el frontend. Usar `useReducer` o `Zustand` para el store del carrito. No persistir el carrito en el backend — en caso de crash, el carrito se pierde y el usuario empieza de nuevo (solo las transacciones en curso se recuperan vía `transaction_state.json`).

### 3.4 Gestión del Proceso Python desde Electron

```javascript
// electron/main.cjs o main.js — fragmento de referencia
const { spawn } = require('child_process');

// Leer PYTHON_PATH desde .env — nunca hardcodear la ruta
const pythonPath = process.env.PYTHON_PATH || 'python';

const pythonProcess = spawn(pythonPath, ['main.py'], {
  cwd: path.join(__dirname, '../../'),
  env: { ...process.env }
});

// Capturar logs del proceso Python
pythonProcess.stdout.on('data', (data) => console.log(`[Python] ${data}`));
pythonProcess.stderr.on('data', (data) => console.error(`[Python ERROR] ${data}`));

// Si Python muere inesperadamente, cerrar Electron también
// El Task Scheduler se encargará de reiniciar el .exe completo
pythonProcess.on('close', (code) => {
  if (code !== 0) app.quit();
});

// Al cerrar Electron, matar el proceso Python limpiamente
app.on('before-quit', () => pythonProcess.kill());
```

### 3.5 Reglas de implementación acordadas (v1.1)

Las siguientes decisiones complementan el resto del documento y reflejan acuerdos tomados al ejecutar el plan de implementación:

| Tema | Regla |
|---|---|
| **CPI — certificado Root.cer** | Antes de cualquier llamada HTTPS al CPI Payment Service, el backend debe comprobar que el certificado **Root.cer** (instalación del CPI) esté de confianza en el almacén **Equipo local → Autoridades de certificación raíz de confianza**, usando una subcadena configurable en `config/prod.yaml` (`cpi_root_cert_subject_hint`) que coincida con Subject/Issuer del certificado instalado. Si no se verifica, registrar **WARNING** en `logs/`, marcar CPI como no disponible en `app_state` y **no** invocar `httpx` de forma que solo falle con “SSL verification failed” sin diagnóstico. En desarrollo se permite `CPI_ALLOW_WITHOUT_ROOT_VERIFICATION` en `.env` (no usar en kiosco de producción). |
| **CPI — token Bearer** | El token OAuth puede expirar durante una transacción larga. Si una petición autenticada recibe **401**, el backend debe **re-autenticar** y **reintentar esa petición una vez** antes de propagar error al cliente, sin dar por abortada la transacción CPI activa solo por expiración de token. |
| **UI — ErrorBoundary** | `ErrorBoundary` de React debe estar en la **raíz del shell de la app** desde que existen las primeras pantallas (activo durante desarrollo y pruebas de flujos posteriores), no aplazado a una fase tardía del frontend. |
| **IM30 — login antes de venta** | El backend, **antes de cada** `POST /emv/sale`, debe consultar `GET /emv/health`; si `loggedIn == false`, ejecutar `POST /emv/login` con credenciales del `.env`. Si el login falla, marcar IM30 como no disponible, registrar el error y **no** intentar la venta. |
| **UI — polling efectivo** | El polling a ~200 ms del estado de la transacción CPI en la pantalla de pago en efectivo debe **detenerse explícitamente** al alcanzar `CompletedSuccess`, al cancelar, al recibir error fatal de CPI o al salir de la pantalla (p. ej. `clearInterval` / cleanup del efecto), de modo que **nunca** quede un intervalo activo tras abandonar esa pantalla. |

**Watchdog vs reinicio del proceso (modelo del proyecto):** Ver §13 y §16. En resumen: **solo el Task Scheduler de Windows** reinicia el `.exe` ante caída del proceso; **`watchdog.py` solo actualiza** el estado de disponibilidad del hardware en `app_state` durante la ejecución.

---

## 4. Pantalla y Orientación

| Parámetro | Valor |
|---|---|
| Orientación | **Portrait** |
| Resolución | `1080 x 1920` (portrait) |
| Modo | Fullscreen — sin barra de navegación ni acceso al SO |

---

## 5. Estructura de Archivos

```
app/
├── main.py                    # Entrada del backend FastAPI
├── ui/                        # Frontend React/TypeScript + proceso Electron
│   ├── src/
│   │   ├── assets/
│   │   │   └── products/          # Imágenes de los 9 productos (800x800px, PNG)
│   │   ├── components/        # Componentes reutilizables
│   │   ├── screens/           # Pantallas principales (Welcome, Catalog, Cart, Payment, Summary)
│   │   ├── hooks/             # Custom hooks (useInactivityTimer, useCart, useQRScanner)
│   │   ├── services/          # Llamadas HTTP al backend
│   │   ├── store/             # Estado global (carrito, transacción activa)
│   │   └── theme.css          # Variables CSS del sistema de diseño
│   └── electron/
│       └── main.cjs           # Proceso principal de Electron (CommonJS; equivalente funcional a main.js)
├── core/
│   ├── state.py               # Estado global de la app
│   ├── error_handler.py       # sys.excepthook global (Python). ErrorBoundary vive solo en React (UI)
│   └── watchdog.py            # Monitorea estado de servicios hardware en runtime (NO reinicia el proceso — eso es el Task Scheduler)
├── services/
│   ├── cpi_service.py         # Recicladores BNR + CR6000 (CPI Payment API)
│   ├── im30_service.py        # Terminal de tarjetas (EMVBridge)
│   ├── printer_service.py     # Impresora Custom Modus 3x
│   ├── mqtt_service.py        # Publicación a RedFox (pendiente)
│   └── transaction_service.py # Escritura/lectura de transaction_state.json
├── config/
│   ├── prod.yaml              # Configuración no sensible (timeouts, puertos, rutas)
│   └── catalog.json           # Catálogo de productos (fuente de verdad)
├── logs/                      # Logs por fecha — nunca en Git
├── .env                       # Credenciales — nunca en Git
├── .env.example               # Plantilla sin valores reales — sí en Git
└── pyproject.toml
```

En **desarrollo**, puede existir además `app/.venv/` (entorno virtual Python recomendado para aislar dependencias); no se versiona. Creación y uso: [GUIA_PRUEBAS.md](GUIA_PRUEBAS.md) §2.2 y [app/README.md](app/README.md).

---

## 6. Configuración y Variables de Entorno

```bash
# .env.example — Este archivo SÍ va en Git
# CPI_HOST: hostname del equipo donde corre el CPI Payment Service.
# Es el nombre de red del equipo (ej. ING-RFIGU3ROA), no "localhost".
# En desarrollo local puede usarse localhost si el servicio corre en la misma máquina.
CPI_HOST=
CPI_PORT=5000
CPI_CLIENT_ID=
CPI_CLIENT_SECRET=
CPI_USERNAME=
CPI_PASSWORD=
# Solo desarrollo: si es true, omite la verificación del Root.cer en el almacén Windows (no usar en kiosco).
CPI_ALLOW_WITHOUT_ROOT_VERIFICATION=false

IM30_HOST=localhost
IM30_PORT=6000
IM30_USER=
IM30_PASSWORD=
EMV_BRIDGE_TOKEN=

# PYTHON_PATH: ruta absoluta al intérprete Python que ejecuta main.py (Electron spawn).
# Kiosco / producción — ejemplo: C:\Python311\python.exe
# Desarrollo con .venv en app/ — ejemplo: C:\ruta\al\proyecto\KIOSCO-CINEMEX\app\.venv\Scripts\python.exe
PYTHON_PATH=

MQTT_BROKER_URL=
MQTT_PORT=
MQTT_USERNAME=
MQTT_PASSWORD=
MQTT_TOPIC_BASE=
```

> ⚠️ **Conflicto de puertos:** El EMVBridge (IM30) y el CPI Payment Service usan el puerto `5000` por defecto. En este proyecto **CPI corre en `5000`** (sin cambios) y **el EMVBridge de IM30 debe reconfigurarse al puerto `6000`**. Ver `integracion_im30.md` para el detalle de esa configuración.

Configuración no sensible en `config/prod.yaml`:

```yaml
inactivity_timeout_seconds: 60
cart_modal_timeout_seconds: 60
printer_name: "CUSTOM MODUS3 X"
ticket_width_mm: 76
cpi_polling_interval_ms: 200
transaction_polling_interval_ms: 200
watchdog_interval_seconds: 3
# Texto que debe aparecer en Subject o Issuer del Root.cer del CPI en el almacén raíz del equipo (ajustar al certificado real).
cpi_root_cert_subject_hint: "CPI"
```

---

## 7. Catálogo de Productos

Fuente de verdad: `config/catalog.json`. Cualquier cambio al catálogo se hace en este archivo — no en el código.

Las imágenes referenciadas deben existir en `ui/src/assets/products/` como archivos PNG de **800×800px**. Para el demo del Showroom se usan placeholders ilustrativos — no requieren fotografías reales.

```json
[
  { "id": "P001", "name": "Palomitas Chicas",    "price": 55.00, "image": "palomitas_ch.png",  "category": "Palomitas" },
  { "id": "P002", "name": "Palomitas Medianas",  "price": 75.00, "image": "palomitas_md.png",  "category": "Palomitas" },
  { "id": "P003", "name": "Palomitas Grandes",   "price": 95.00, "image": "palomitas_gr.png",  "category": "Palomitas" },
  { "id": "P004", "name": "Refresco Chico",      "price": 45.00, "image": "refresco_ch.png",   "category": "Bebidas"   },
  { "id": "P005", "name": "Refresco Grande",     "price": 65.00, "image": "refresco_gr.png",   "category": "Bebidas"   },
  { "id": "P006", "name": "Agua Embotellada",    "price": 35.00, "image": "agua.png",          "category": "Bebidas"   },
  { "id": "P007", "name": "Nachos con Queso",    "price": 70.00, "image": "nachos.png",        "category": "Snacks"    },
  { "id": "P008", "name": "Hot Dog",             "price": 75.00, "image": "hotdog.png",        "category": "Snacks"    },
  { "id": "P009", "name": "Chocolate",           "price": 40.00, "image": "chocolate.png",     "category": "Snacks"    }
]
```

---

## 8. Flujo de Usuario Completo

### 8.1 Diagrama General

```
┌─────────────────────────────┐
│     PANTALLA DE BIENVENIDA  │ ← Arranque / Timeout / Confirmar en resumen
└────────────┬────────────────┘
             ↓ (toque en pantalla)
┌─────────────────────────────┐
│     CATÁLOGO + CARRITO      │ ← Usuario agrega / quita productos
└────────────┬────────────────┘
             ↓ (presionar "Pagar")
┌─────────────────────────────┐
│   SELECCIÓN MÉTODO DE PAGO  │
│   [ Efectivo ] [ Tarjeta ]  │
└──────┬──────────────┬───────┘
       ↓              ↓
┌──────────────┐ ┌───────────────┐
│ FLUJO EFECTIVO│ │ FLUJO TARJETA │
│  (CPI API)   │ │  (IM30 Bridge)│
└──────┬───────┘ └───────┬───────┘
       └────────┬─────────┘
                ↓ (pago exitoso)
┌─────────────────────────────┐
│   IMPRESIÓN DE TICKET + QR  │
└────────────┬────────────────┘
             ↓
┌─────────────────────────────┐
│  PANTALLA: "ESCANEA TU QR"  │
└────────────┬────────────────┘
             ↓ (Zebra SE2707 lee el QR)
┌─────────────────────────────┐
│  MODAL: RESUMEN DE COMPRA   │
│       [ Confirmar ]         │
└────────────┬────────────────┘
             ↓ (presionar "Confirmar")
         Publicar MQTT
             ↓
         Regresar a BIENVENIDA
```

---

### 8.2 Pantalla de Bienvenida

- Diseño conforme a `UI_GUIDELINES.md` (paleta, tipografía, componentes Blueprint.js).
- Mostrar logo o imagen de bienvenida de la dulcería.
- Mensaje: _"Toca la pantalla para comenzar"_ o similar.
- Sin timeout en esta pantalla — espera hasta que el usuario interactúe.

---

### 8.3 Catálogo + Carrito

- Mostrar los 9 productos del catálogo agrupados por categoría.
- Cada producto muestra: imagen, nombre y precio.
- Botón `+` / `–` por producto para agregar o quitar unidades.
- Panel lateral (o inferior en portrait) con resumen del carrito:
  - Lista de productos seleccionados con cantidad y subtotal.
  - Total general.
  - Botón `"Pagar"` — deshabilitado si el carrito está vacío.
- Botón `"Vaciar carrito"` disponible mientras haya productos.

---

### 8.4 Selección de Método de Pago

- Dos opciones: `"Efectivo"` y `"Tarjeta"`.
- Si el CPI está en estado `Error` al momento de mostrar esta pantalla, deshabilitar el botón `"Efectivo"` y mostrar mensaje: _"Pago en efectivo no disponible"_.
- Si el IM30 Bridge no responde al hacer ping inicial, deshabilitar `"Tarjeta"` con mensaje equivalente.

---

### 8.5 Flujo de Pago en Efectivo (CPI)

Ver `integracion_cpi.md` para detalle técnico completo.

1. Obtener Bearer Token del CPI (el backend puede renovarlo automáticamente si una llamada autenticada recibe **401** — ver §3.5).
2. Polling `GET /api/SystemStatus` cada 200ms — mostrar spinner si `Busy`.
3. Iniciar transacción `POST /api/Transactions` con el total del carrito en centavos.
4. Polling `GET /api/Transactions/{id}` cada 200ms:
   - Mostrar en pantalla el monto insertado (`totalAccepted`) y el cambio devuelto (`totalDispensed`).
   - Mostrar barra de progreso hacia el total.
5. Al llegar a `CompletedSuccess` → continuar al flujo de ticket.
6. Botón `"Cancelar"` disponible durante el proceso → llama `/cancel` y regresa a selección de método de pago.

**Cierre del polling (UI):** El intervalo de polling del paso 4 debe cancelarse al obtener `CompletedSuccess`, al cancelar, ante error fatal del CPI o al desmontar la pantalla de pago en efectivo (§3.5).

**Error `NotStartedInsufficientChange`:** Mostrar mensaje al usuario y notificar al operador. No iniciar transacción.

---

### 8.6 Flujo de Pago con Tarjeta (IM30)

Ver `integracion_im30.md` para detalle técnico completo.

1. `GET http://localhost:6000/emv/health` — verificar que el Bridge está activo y `loggedIn`.
2. Si `loggedIn == false` → `POST /emv/login` con credenciales MiTec antes de continuar.  
   **Implementación:** el backend debe aplicar la regla de **§3.5** — antes de **cada** intento de venta, comprobar `health` y hacer login si hace falta; si el login falla, no llamar a `/emv/sale`.
3. `POST http://localhost:6000/emv/sale` con `referencia` (UUID de transacción) y `monto`.
4. Mostrar pantalla de espera: _"Acerca tu tarjeta a la terminal"_.
5. Si `respuesta == "approved"` → guardar `autorizacion` y `voucher` → continuar al flujo de ticket.
6. Si `respuesta == "denied"` o existe `errorCode` → mostrar mensaje al usuario según el catálogo de errores → opción de reintentar o cancelar.

> ⚠️ No enviar ventas en paralelo — el Bridge responde `409 EMV_BUSY` si hay una operación en curso.

---

### 8.7 Impresión de Ticket

Ver `integracion_impresora.md` para detalle técnico completo.

El ticket debe incluir:

| Zona | Contenido |
|---|---|
| Logo | Logo de la dulcería centrado |
| Header | Fecha y hora, ID único de transacción |
| Productos | Lista de productos comprados con cantidad y precio unitario |
| Separador | Línea horizontal |
| Total | Monto total pagado |
| Método de pago | Efectivo / Tarjeta + últimos 4 dígitos si aplica |
| QR | Código QR que codifica el `transaction_id` |
| Footer | _"Gracias por tu compra"_ |

- El QR codifica únicamente el `transaction_id` (UUID).
- El `transaction_id` y la lista de productos se guardan en `transaction_state.json` antes de imprimir para poder mostrarlos al escanear el QR.
- Si la impresora falla, mostrar error en pantalla pero **no bloquear el flujo** — la transacción ya se completó.
- Librería para generar el QR: `qrcode`. Ver `integracion_impresora.md` para el snippet de generación e incrustación en el canvas.

---

### 8.8 Pantalla "Escanea tu QR"

- Instrucción clara: _"Escanea el QR de tu ticket para ver el resumen de tu compra"_.
- El scanner Zebra SE2707 opera en **modo HID** — emula teclado. Implementar con un **event listener global en `window` con `keydown`**, acumulando caracteres en un buffer hasta recibir `Enter` como señal de lectura completa. **No usar un `<input>` enfocado** — fallará cuando el foco esté en otro elemento.
- El listener solo procesa input cuando la pantalla activa es `QrScanScreen`. En cualquier otra pantalla debe estar inactivo para evitar capturas accidentales.
- Al recibir el `transaction_id` del scanner, validar que coincida con el `transaction_id` activo en `transaction_state.json`.
- Si coincide → abrir modal de resumen.
- Si no coincide → mostrar mensaje _"QR no válido, intenta de nuevo"_.
- Timeout de 120 segundos en esta pantalla — si no se escanea, regresar a bienvenida y limpiar estado.

---

### 8.9 Modal de Resumen de Compra

- Mostrar lista de productos comprados con cantidades y precios.
- Mostrar total pagado y método de pago.
- Botón `"Confirmar"` — al presionarlo:
  1. Cerrar el modal.
  2. Publicar evento MQTT _(pendiente de implementación)_.
  3. Eliminar `transaction_state.json`.
  4. Limpiar el carrito.
  5. Regresar a la pantalla de bienvenida.

---

## 9. Comportamiento de Inactividad

| Condición | Timeout | Acción |
|---|---|---|
| Carrito **vacío**, usuario en catálogo o selección de pago | 60 segundos | Regresar directamente a pantalla de bienvenida |
| Carrito **con productos** | 60 segundos | Mostrar modal de inactividad |
| Modal de inactividad sin respuesta | 60 segundos adicionales | Vaciar carrito y regresar a bienvenida |

### Modal de Inactividad (carrito con productos)

- Título: _"¿Sigues ahí?"_
- Mensaje: _"Tu sesión está a punto de cancelarse. ¿Deseas continuar con tu compra?"_
- Botón `"Continuar comprando"` → cerrar modal y reiniciar timer.
- Botón `"Cancelar compra"` → vaciar carrito y regresar a bienvenida inmediatamente.
- Contador visible con los segundos restantes.
- Si el modal no recibe interacción en 60 segundos → vaciar carrito → regresar a bienvenida.

> ⚠️ El timer de inactividad debe pausarse durante cualquier flujo de pago activo (efectivo o tarjeta) para no interrumpir una transacción en curso.

---

## 10. Integración de Hardware — Resumen

| Hardware | Archivo de referencia | Puerto / Protocolo |
|---|---|---|
| Recicladores BNR + CR6000 | `integracion_cpi.md` | HTTPS `localhost:5000` (CPI Payment Service) |
| Terminal Getnet IM30 | `integracion_im30.md` | HTTP `localhost:6000` (EMVBridge — reconfigurado) |
| Impresora Custom Modus 3x | `integracion_impresora.md` | Driver Windows — `win32print` |
| Lector QR Zebra SE2707 | — | Modo HID (emulación de teclado) |

### Verificación de servicios al arrancar

Al iniciar la app, antes de mostrar la pantalla de bienvenida, verificar el estado de cada servicio:

```
App arranca
    ↓
¿Existe transaction_state.json?  →  SÍ: ejecutar recuperación (ver sección 12)
    ↓ NO
Verificar que el EMVBridge (IM30) esté corriendo en localhost:6000
Verificar CPI Service (GET /api/SystemStatus en localhost:5000)
Verificar impresora (win32print — check_printer_available())
    ↓
Registrar estado de cada servicio en estado global
    ↓
Mostrar pantalla de bienvenida
(métodos de pago deshabilitados si su servicio falló)
```

> ⚠️ El EMVBridge de IM30 es un servicio externo en C# que debe estar corriendo **antes** de que la app arranque. No lo gestiona Electron. Si no responde en `localhost:6000`, deshabilitar el método de pago con tarjeta y loggear el error.

---

## 11. Manejo de Errores — 3 Capas

**Capa 1 — Hardware (por servicio)**
Cada `service` en Python captura sus propios errores y los reporta al estado global sin tumbar la app. Si un periférico falla, la UI lo refleja deshabilitando la funcionalidad afectada.

**Capa 2 — UI (React ErrorBoundary)**
`ErrorBoundary` en el **root del árbol de React** (activo desde el shell inicial de la UI, §3.5) captura errores de renderizado y muestra una pantalla de recuperación en lugar de pantalla en blanco o crash.

**Capa 3 — Python global (sys.excepthook)**
Handler registrado desde `main.py` / `core/error_handler.py`: captura excepciones no manejadas en el proceso Python, las registra en `logs/` y —cuando MQTT esté implementado (§15)— puede invocar un intento de publicación de alerta vía `mqtt_service` (stub hasta entonces).  
**No reinicia el proceso.** Si el proceso Python termina, **Electron** puede cerrarse y el **Task Scheduler de Windows** vuelve a lanzar el `.exe` según la política de “reiniciar si falla” (§13). El **watchdog Python no sustituye** a ese mecanismo.

### Tabla de errores específicos del flujo

| Error | Pantalla afectada | Acción |
|---|---|---|
| CPI no disponible al arrancar | Selección de pago | Deshabilitar botón "Efectivo" con mensaje |
| IM30 no responde al arrancar | Selección de pago | Deshabilitar botón "Tarjeta" con mensaje |
| `NotStartedInsufficientChange` | Flujo efectivo | Notificar al usuario; no iniciar transacción |
| `Transaction_Stalled` / `Jammed` | Flujo efectivo | Mostrar instrucciones de desatasco (`fixInstructionsUrl`) |
| Pago con tarjeta rechazado | Flujo tarjeta | Mostrar mensaje; ofrecer reintentar o cancelar |
| Fallo de impresora | Post-pago | Log del error; continuar flujo sin bloquear |
| QR escaneado no válido | Pantalla QR | Mensaje de error; permitir reintento |
| Carrito vacío al intentar pagar | Catálogo | Botón "Pagar" deshabilitado — no llegar a este estado |

---

## 12. Recuperación ante Fallos (transaction_state.json)

Al iniciar cualquier transacción, escribir en disco:

```json
{
  "transaction_id": "uuid-v4",
  "status": "in_progress",
  "payment_method": "cash | card",
  "amount": 150.00,
  "step": "waiting_payment | printing | waiting_qr",
  "items": [
    { "id": "P001", "name": "Palomitas Chicas", "qty": 2, "price": 55.00 }
  ],
  "timestamp": "2025-04-06T10:32:00"
}
```

Al completar exitosamente (usuario presiona "Confirmar" en el resumen) → eliminar el archivo.

**Flujo de recuperación al arrancar:**

```
¿Existe transaction_state.json?
    ↓ SÍ
Leer status y step
    ↓
Si step == "waiting_payment" → re-autenticar con CPI (el token puede haber expirado)
                               → cancelar transacción CPI si aplica → limpiar estado
Si step == "printing"        → reintentar impresión → continuar flujo QR
Si step == "waiting_qr"      → ir directo a pantalla de escaneo con datos del JSON
                               → mantener transaction_state.json activo hasta Confirmar
    ↓
Eliminar transaction_state.json SOLO al presionar "Confirmar" en el modal de resumen,
en cancelación explícita del usuario, o en abandono por timeout de la pantalla QR.
```

> ⚠️ **Regla crítica:** No eliminar `transaction_state.json` al entrar a la pantalla de escaneo QR. El archivo debe permanecer activo para validar el UUID escaneado. Se elimina únicamente cuando el flujo concluye de forma definitiva (Confirmar, cancelar o timeout QR).

---

## 13. Startup, Task Scheduler y Watchdog

**Modelo operativo del proyecto (elegido para el kiosco):** separar claramente **reinicio del proceso** y **salud del hardware en caliente**.

| Mecanismo | Responsabilidad | ¿Reinicia el .exe o Python? |
|---|---|---|
| **Task Scheduler de Windows** | Arranque al encender el equipo; política **“reiniciar si falla”** (p. ej. delay 5 s); puede ejecutar sin usuario en sesión. Punto de entrada: `.exe` de `electron-builder`. | **Sí** — relanza el proceso de la aplicación cuando este termina o falla según la tarea configurada. |
| **`watchdog.py` (FastAPI)** | Bucle asíncrono periódico: CPI (`SystemStatus` o equivalente), IM30 (`/emv/health`), comprobación de impresora; escribe resultados en `app_state["services"]` para `GET /api/status` y la UI. | **No** — no lanza ni mata procesos; no sustituye al Task Scheduler. |

### Task Scheduler de Windows — reinicio de la app
- Registrar la app en el **Task Scheduler de Windows** para arranque automático al encender el equipo.
- Configurar **"reiniciar si falla"** con delay de **5 segundos** (o el valor que defina operaciones).
- Funciona sin usuario logueado.
- El `.exe` generado por `electron-builder` es el punto de entrada registrado.
- La ventana se abre siempre en **fullscreen** — sin bordes, sin barra de tareas visible.
- **El Task Scheduler es el único mecanismo previsto para reiniciar la aplicación ante caída del proceso.** No implementar en Python un segundo “watchdog que relance uvicorn/Electron”: es redundante y puede generar condiciones de carrera con la tarea programada.

### `watchdog.py` — monitoreo de hardware en runtime (sin reinicio)
El archivo `core/watchdog.py` **solo observa** periféricos y mantiene actualizado el estado que consume el frontend:

```python
# Responsabilidad de watchdog.py (resumen)
# - Polling periódico de estado CPI (p. ej. GET /api/SystemStatus)
# - Ping periódico a GET /emv/health (IM30)
# - Verificación periódica de impresora disponible (win32print / nombre configurado)
# - Actualizar app_state["services"] con el resultado
# - NO reiniciar procesos ni la app — eso corresponde al Task Scheduler
```

Intervalo sugerido: `watchdog_interval_seconds` en `config/prod.yaml` (p. ej. 3 s), independiente del polling de 200 ms durante una transacción de efectivo.

---

## 14. Logs

- Carpeta `logs/` — un archivo por fecha (`2025-04-06.log`).
- Formato: `[TIMESTAMP] [NIVEL] [MÓDULO] Mensaje`.
- Niveles: `INFO`, `WARNING`, `ERROR`.
- `logs/` en `.gitignore` — nunca subir a Git.

---

## 15. MQTT / RedFox

⏳ **Pendiente** — La estructura de payloads está por definirse. El módulo `mqtt_service.py` debe crearse pero puede dejarse como stub hasta que se definan los eventos y su formato.

```python
# mqtt_service.py — stub inicial
def publish_transaction(transaction_data: dict):
    # TODO: implementar cuando se definan los payloads
    pass
```

---

## 17. Animaciones

**Librería:** Framer Motion — `npm install framer-motion`

### Transiciones entre pantallas
Slide horizontal con `AnimatePresence mode="wait"`. La pantalla entrante llega desde la derecha, la saliente sale hacia la izquierda. Duración: `0.25s`, easing: `easeInOut`.

### Catálogo — cards de productos
Al montar el catálogo, las cards aparecen en cascada (stagger) con fade + `translateY` de abajo hacia arriba. Delay incremental de `0.05s` por card, duración por card `0.3s`.

### Botones
Todos los botones con `whileTap={{ scale: 0.96 }}` y `whileHover={{ scale: 1.02 }}`. No crear estilos custom — solo props de Framer Motion sobre los componentes Blueprint.js existentes.

### Cart bar — feedback de total
Cuando cambia el total del carrito, el número hace `scale: 1 → 1.15 → 1` en `0.2s`.

### Pantalla de bienvenida
Logo, título y botón entran en secuencia con fade + `translateY`. Usar `variants` con stagger de `0.15s` entre elementos.

### Pago exitoso — momento especial
Al completar el pago (efectivo o tarjeta), mostrar animación de éxito antes de pasar a la pantalla QR:
- Checkmark SVG animado con `pathLength: 0 → 1` en `0.5s`.
- Burst de máximo 12 partículas con `motion.div`, duración `0.6s`.
- Sin librerías adicionales — solo Framer Motion.

### Modal de resumen
Entrada con `scale: 0.92 → 1` + `opacity: 0 → 1` en `0.2s`. Backdrop con `opacity: 0 → 1` en `0.15s`.

### Modal de inactividad
El contador pulsa suavemente (`scale: 1 → 1.05 → 1`) en cada cambio de segundo.

### Restricciones de hardware
El kiosco usa **Intel UHD Graphics** (integrada, modelo H6-JM, i7 10810U). Por esto:
- **No usar** `backdrop-filter: blur()` animado — genera jank en Electron con Intel UHD.
- **No animar** `box-shadow` en bucles — solo como propiedad estática en hover/tap.

### Accesibilidad
Envolver la configuración global de Framer Motion con `useReducedMotion()`. Si está activo, reducir todas las duraciones a `0.01s`.

---

## 16. Definición de Terminado

Un proyecto se considera **terminado** cuando cumple todos los criterios siguientes:

### Flujo
- [ ] El flujo completo corre de principio a fin sin intervención manual.
- [ ] Todos los estados de error tienen pantalla de respuesta — la app nunca se queda en blanco ni crashea.
- [ ] El timeout de inactividad funciona correctamente en todas sus variantes (carrito vacío / con productos / modal sin respuesta).

### Hardware
- [ ] El flujo fue probado con todos los componentes de hardware reales conectados.
- [ ] Recicladores BNR y CR6000 inicializados correctamente al arrancar.
- [ ] Terminal IM30 responde correctamente a cobros de prueba.
- [ ] Impresora imprime el ticket con QR legible.
- [ ] Zebra SE2707 lee el QR y dispara el modal de resumen correctamente.

### Interfaz
- [ ] La UI sigue los lineamientos de `UI_GUIDELINES.md`.
- [ ] La app abre en fullscreen sin barra de navegación visible.
- [ ] Orientación portrait correcta a la resolución del kiosco.
- [ ] Todas las animaciones corren sin jank en el hardware del kiosco (Intel UHD Graphics).

### Estabilidad
- [ ] La app arranca automáticamente al encender el equipo (Task Scheduler u mecanismo operativo equivalente registrado en el kiosco).
- [ ] El **Task Scheduler** (o política acordada en Windows) **reinicia el `.exe`** si el proceso de la aplicación termina o falla (p. ej. “reiniciar si falla”, delay ~5 s).
- [ ] El **watchdog Python** actualiza en runtime la disponibilidad de CPI, IM30 e impresora en `app_state` **sin** reiniciar procesos (comportamiento acorde a §13).
- [ ] La recuperación ante fallos funciona correctamente con `transaction_state.json`.

### Revisión
| Fecha | Evento |
|---|---|
| **24 de Abril** | Demo funcional completa ante el PM |
| **1 de Mayo** | Entrega oficial con observaciones corregidas |
