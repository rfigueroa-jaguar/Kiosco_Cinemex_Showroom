# Integración Terminal de Tarjetas — IM30 (EMVBridge)

EMVBridge es una aplicación Windows Forms (.NET Framework 4.8) que actúa como puente HTTP entre el backend FastAPI y el SDK EMV de MiTec (`cpIntegracionEMV.dll`). El backend **no** enlaza el SDK directamente — solo consume la API HTTP local del Bridge.

---

## Arquitectura de Conexión

- **Protocolo:** HTTP (JSON)
- **Puerto configurado:** `6000` (variable `EMV_HTTP_PORT`)
- **Host:** `localhost`
- **Base URL:** `http://localhost:6000`

> ⚠️ El Bridge usa el puerto `5000` por defecto. En este proyecto **debe reconfigurarse al puerto `6000`** via la variable `EMV_HTTP_PORT` en el `.env` del Bridge, para evitar conflicto con el CPI Payment Service que corre en `5000`.

---

## Requisitos del Sistema

| Requisito | Detalle |
|---|---|
| Framework | .NET Framework 4.8 instalado en el equipo |
| DLLs propietarias | `cpIntegracionEMV.dll` y `QPOSDesktopLib.dll` en `EMVBridge/libs/` (ver `libs/README_SDK.txt`) |
| Conectividad | HTTPS permanente en **puerto 443** con **TLS 1.2 activo** |
| Tipo de conexión | USB (`ConnectionType.USB`) |

> ⚠️ Sin las DLLs del proveedor en la carpeta correcta, el Bridge falla silenciosamente al iniciar. Verificar `libs/README_SDK.txt` antes de correr el Bridge en un equipo nuevo.

---

## Configuración del Bridge (archivo `.env`)

El Bridge lee su configuración desde un archivo `.env` colocado junto a `EMVBridge.exe`, o desde variables de entorno del proceso. Las variables de entorno tienen prioridad sobre el `.env`.

### Variable obligatoria

| Variable | Descripción |
|---|---|
| `EMV_BRIDGE_TOKEN` | Secreto compartido. Debe incluirse en cada request como `Authorization: Bearer <token>` o `X-Bridge-Token: <token>` |

### Variables opcionales (con defaults en código)

| Variable | Default | Descripción |
|---|---|---|
| `EMV_HTTP_PORT` | `5000` | **Cambiar a `6000` en este proyecto** |
| `EMV_HTTP_HOST` | `localhost` | Host del listener HTTP |
| `EMV_URL` | `https://vip.e-pago.com.mx` | URL transaccional MiTec |
| `EMV_URL_PUBLIC_KEY` | — | URL del servicio de llave pública RSA |
| `EMV_SDK_TIMEOUT_SECONDS` | — | Timeout del SDK |
| `EMV_TLS` | `Tls12` | `Tls12` o `Tls12Tls13` |
| `EMV_USER` / `EMV_PASS` | — | Si se definen, el Bridge hace auto-login al arrancar |

> 💡 Si se definen `EMV_USER` y `EMV_PASS`, el Bridge hace login automático al iniciar y no es necesario llamar a `/emv/login` manualmente desde el backend.

---

## Credenciales MiTec

| Entorno | Usuario | Contraseña |
|---|---|---|
| Producción (PROD) | `UC8CSIUS0` | `3N8PGAN8RXM4` |
| Pruebas (QA) | `0005SIUS1` | `A77NMXB6G` |

---

## Arranque del Bridge

1. Colocar el `.env` junto a `EMVBridge.exe` con `EMV_HTTP_PORT=6000` y `EMV_BRIDGE_TOKEN`.
2. Ejecutar `EMVBridge.exe` (corre con ventana oculta — proceso en segundo plano).
3. Verificar que está listo: `GET http://localhost:6000/emv/health` (sin token).
4. Si `loggedIn` es `false` y no hay auto-login configurado, llamar a `POST /emv/login` antes de intentar una venta.

> ⚠️ El Bridge es un proceso externo — Electron **no lo gestiona**. Debe estar corriendo antes de que la app arranque. Si no responde en `/emv/health`, deshabilitar el método de pago con tarjeta y loggear el error.

---

## Endpoints

### `GET /emv/health` — Sin autenticación

Verificar que el Bridge está activo y listo antes de intentar un pago.

**Respuesta:**
```json
{
  "status": "ok",
  "version": "...",
  "uptimeSeconds": 120,
  "listener": true,
  "loggedIn": true,
  "emvBusy": false
}
```

Usar `loggedIn` para saber si se necesita hacer login. Usar `emvBusy` para saber si hay una operación en curso.

---

### `POST /emv/login` — Con autenticación

Autenticar el SDK con MiTec. Solo necesario si no hay auto-login configurado o si la sesión expiró.

**Headers:**
```
Authorization: Bearer <EMV_BRIDGE_TOKEN>
Content-Type: application/json
```

**Body:**
```json
{
  "usuario": "<usuario MiTec>",
  "password": "<contraseña>",
  "url": "https://vip.e-pago.com.mx"
}
```

> El campo `url` es opcional — si se omite, el Bridge usa la URL configurada en su `.env`.

**Respuesta exitosa (200):**
```json
{ "ok": true, "requestId": "..." }
```

**Error (401):** Login fallido. Puede incluir `mitIm30` con el mensaje de error de la DLL.

---

### `POST /emv/sale` — Con autenticación

Ejecutar un cobro con tarjeta. **Requiere sesión SDK activa** (login previo o auto-login).

**Headers:**
```
Authorization: Bearer <EMV_BRIDGE_TOKEN>
Content-Type: application/json
```

**Body:**
```json
{
  "referencia": "UUID-UNICO-DE-TRANSACCION",
  "monto": 150.00
}
```

> ⚠️ La `referencia` debe ser única por transacción. Usar el `transaction_id` generado en `transaction_state.json`. Una misma referencia con el mismo monto en el mismo día regresa error `11` (transacción duplicada).

**Respuesta exitosa (200):**
```json
{
  "respuesta": "approved",
  "autorizacion": "...",
  "voucher": "...texto plano para imprimir..."
}
```

**Lógica de respuesta:**

| Condición | Acción |
|---|---|
| `respuesta == "approved"` | Extraer `autorizacion` y `voucher` → continuar al flujo de impresión |
| `respuesta == "denied"` | Mostrar mensaje de rechazo → ofrecer reintentar o cancelar |
| Existe `errorCode` | Ver catálogos de error abajo → mostrar mensaje apropiado al usuario |

---

## Flujo Completo de Pago con Tarjeta

```
Backend recibe solicitud de pago con tarjeta
        ↓
GET /emv/health
├── No responde → deshabilitar tarjeta, loggear error
└── Responde → verificar loggedIn
        ↓
¿loggedIn == false?
├── SÍ → POST /emv/login con credenciales MiTec
└── NO → continuar
        ↓
POST /emv/sale con referencia (UUID) y monto
        ↓
Mostrar pantalla de espera: "Acerca tu tarjeta a la terminal"
        ↓
┌─────────────────┬────────────────────┬──────────────────┐
│  approved       │  denied            │  errorCode       │
│  Extraer        │  Mostrar rechazo   │  Ver catálogos   │
│  autorizacion   │  Reintentar /      │  Mostrar mensaje │
│  y voucher      │  Cancelar          │  apropiado       │
└────────┬────────┴────────────────────┴──────────────────┘
         ↓
Continuar al flujo de impresión de ticket
```

> ⚠️ **No enviar ventas en paralelo.** El Bridge procesa una operación EMV a la vez. Si llega una segunda solicitud mientras hay una en curso, responde `409 EMV_BUSY`. Serializar las llamadas y esperar a que `emvBusy` sea `false` en health antes de reintentar.

---

## Catálogo de Errores HTTP del Bridge

| HTTP | `errorCode` | Causa | Acción |
|---|---|---|---|
| `401` | `UNAUTHORIZED` | Token del Bridge incorrecto o ausente | Error de configuración — loggear |
| `401` | `SDK_NOT_AUTHENTICATED` | Falta login MiTec | Llamar a `/emv/login` y reintentar |
| `401` | `LOGIN_FAILED` | Credenciales MiTec incorrectas | Notificar al operador |
| `409` | `EMV_BUSY` | Otra operación EMV en curso | Esperar y reintentar |
| `400` | `INVALID_JSON` / `INVALID_BODY` | Body mal formado o campos faltantes | Error interno — loggear |
| `404` | `NOT_FOUND` | Ruta incorrecta | Error interno — loggear |
| `500` | `INTERNAL_ERROR` | Error no controlado en el Bridge | Loggear y notificar al operador |

### `errorCode` en string (cuerpo JSON, a veces HTTP 200)

Algunas respuestas de `/emv/sale` incluyen `errorCode` como texto (no solo códigos numéricos MiTec). El kiosco muestra mensajes legibles para los siguientes:

| `errorCode` | Causa típica | Mensaje en UI del kiosco |
|---|---|---|
| `EMV_START_FAILED` | El Bridge a veces devuelve este código también tras **cancelación en TPV** o **timeout**, aunque el fallo real sea otro. | Si en la misma respuesta (o en objetos anidados como `data` / `details`) aparece el código PIN pad **`10`** o **`11`**, el kiosco **prioriza** los mensajes de cancelación o timeout del catálogo PIN pad. Solo si **no** hay `10`/`11` detectable se muestra el texto genérico de arranque en TPV. |
| `EMV_BUSY` | Terminal ocupada (equivalente lógico al HTTP 409 en algunos flujos) | "La terminal está ocupada. Espera unos segundos e intenta de nuevo." |

> Si tras cancelar o agotar tiempo **solo** llega `EMV_START_FAILED` sin ningún `10`/`11` ni texto en `mitIm30`, el mensaje genérico es una limitación del Bridge/SDK: conviene revisar `logs/emvbridge.log` o pedir al proveedor que distinga códigos en el JSON.

---

## Catálogo de Errores — Plataforma MiTec (General)

Devueltos en el campo `errorCode` o `mitIm30` de la respuesta.

| Código | Descripción | Mensaje sugerido en UI |
|---|---|---|
| `01` | XML no cumple con el esquema definido | Error interno — loggear |
| `03` | Datos de empresa, sucursal o usuario incorrectos | Notificar al operador |
| `04` | El comercio no tiene afiliaciones para esa tarjeta | "Tarjeta no aceptada" |
| `06` | Tipo de tarjeta o instrumento inválido | "Tarjeta no compatible" |
| `08` | Monto menor al mínimo de la afiliación | "Monto insuficiente para este método de pago" |
| `09` | Monto supera el límite del usuario | Notificar al operador |
| `11` | Transacción duplicada (mismo día, referencia e importe) | Loggear — verificar con `sndConsulta` antes de reintentar |
| `18` / `19` | Sin comunicación con el servidor | "Sin conexión, intenta de nuevo" |
| `99` | Servicio de llave pública RSA no disponible | Error crítico — el Bridge no puede operar |
| `201` | Datos de entrada inválidos | Error interno — loggear |

---

## Catálogo de Errores — PIN Pad (Terminal Física)

| Código | Causa | Mensaje sugerido en UI |
|---|---|---|
| `01` | Banda o chip dañados | "No pudimos leer tu tarjeta. Intenta con otra." |
| `03` | Terminal desconectada / sin respuesta | "Terminal no disponible. Llama a soporte." |
| `10` | Cancelación desde TPV (botón rojo u opción cancelar en terminal) | "Operación cancelada en la terminal." *(mensaje mostrado en el kiosco cuando `errorCode` es `10`)* |
| `11` | Timeout en TPV (tiempo agotado para tarjeta u operación) | "Tiempo agotado en la terminal. Puedes intentar de nuevo." *(mensaje mostrado en el kiosco cuando `errorCode` es `11`)* |
| `14` | Error de PIN en la terminal | "Error al procesar el PIN. Intenta de nuevo." |
| `15` | Tarjeta vencida | "Tu tarjeta está vencida. Usa otra." |
| `17` | Impresora sin papel | Notificar al operador — no bloquear el flujo |
| `22` | Tarjeta bloqueada por el emisor | "Tarjeta bloqueada. Comunícate con tu banco." |
| `27` | PIN bloqueado por exceso de intentos | "PIN bloqueado. Comunícate con tu banco." |
| `29` | Tarjeta con chip retirada prematuramente | "Retiraste la tarjeta demasiado pronto. Intenta de nuevo." |
| `34` | Tarjeta retirada antes de completar la lectura | "Mantén la tarjeta hasta que se indique." |
| `Q100` | Lector QPOS apagado o en reposo | "Terminal no disponible. Revisa la conexión." |

---

## Logs del Bridge

El Bridge escribe en `logs/emvbridge.log` junto al ejecutable, con rotación por tamaño. Revisar este archivo ante cualquier error de integración antes de escalar.

---

## Textos de UI en el kiosco (frontend)

Los mensajes mostrados al usuario para errores de TPV, Bridge, MiTec y respuestas del backend FastAPI están centralizados en `app/ui/src/lib/im30ErrorCatalog.ts` (`IM30_PIN_PAD_UI`, `IM30_MITEC_PLATFORM_UI`, `IM30_BRIDGE_STRING_UI`, `IM30_BACKEND_API_CODE_UI`). Si actualizas las tablas de este documento, conviene reflejar el mismo criterio en ese archivo.
