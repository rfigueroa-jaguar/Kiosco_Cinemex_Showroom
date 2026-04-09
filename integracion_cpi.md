# Integración Recicladores de Efectivo — CPI Payment Service

---

## 1. Arquitectura de Conexión

- **Protocolo:** REST API (HTTPS con TLS) y WebSockets
- **Puerto configurado:** `5000`
- **Certificado SSL:** Es obligatorio instalar el certificado `Root.cer` generado durante la instalación del servicio para evitar errores de SSL.

> ⚠️ El CPI corre en el puerto `5000` (su puerto por defecto, sin cambios). El EMVBridge de IM30 fue reconfigurado al puerto `6000` para evitar conflicto.

---

## 2. Autenticación — Bearer Token (OAuth 2.0)

Antes de cualquier operación, obtener un token que se incluirá en todas las peticiones siguientes.

**Endpoint:** `POST https://{hostname}/connect/token`

> `{hostname}` es el nombre de red de la computadora donde corre el CPI Payment Service — el mismo equipo donde corre la app. Ejemplo: si el equipo se llama `ING-RFIGU3ROA`, el endpoint completo sería `https://ING-RFIGU3ROA:5000/connect/token`. En desarrollo local también puede usarse `localhost`.

**Headers:**
```
Content-Type: application/x-www-form-urlencoded
Authorization: Basic {Base64(ClientID:ClientSecret)}
```

**Credenciales:**

| Campo | Valor |
|---|---|
| `ClientID` | `9a117930b32f43c084775639fc8f6728` |
| `ClientSecret` | `K8REuZ3bnxsFpSGQpExM4CtjBTmGwPWF` |
| `Username` | `admin@cpi.com` |
| `Password` | `Test0001` |

**Body (URL encoded):**
```
grant_type=password&username=admin@cpi.com&password=Test0001
```

**Resultado:** Extraer `access_token` de la respuesta JSON e incluirlo en todas las peticiones siguientes como:
```
Authorization: Bearer {access_token}
```

---

## 3. Referencia de Endpoints (API Completa)

### Núcleo y Auditoría

| Método | Endpoint | Descripción |
|---|---|---|
| GET | `/api` | Información general sobre la API |
| GET | `/api/audit` | Datos de auditoría del sistema |
| GET | `/api/audit/loader` | Auditoría específica del cargador (loader) |

### Configuración

| Método | Endpoint | Descripción |
|---|---|---|
| GET / PUT | `/api/Configuration` | Retorna o actualiza todos los ítems de configuración |
| GET | `/api/Configuration/{group}/{item}` | Ítems filtrados por grupo y nombre |
| GET / PUT | `/api/Configuration/{group}/{item}/{index}` | Retorna o actualiza un ítem específico |

### Diagnósticos y Logs

| Método | Endpoint | Descripción |
|---|---|---|
| GET | `/api/Diagnostics` | Eventos de logs guardados en base de datos |
| GET | `/api/Diagnostics/generatePartialLogs` | Genera logs parciales (Transacción, Diagnóstico, Dispositivo, Servicio) |
| GET | `/api/Diagnostics/downloadPartialLogs` | Descarga carpeta `.zip` con los logs parciales |

### Gestión de Dispositivos

| Método | Endpoint | Descripción |
|---|---|---|
| GET / POST | `/api/PaymentDevices` | Lista dispositivos activos o añade uno nuevo |
| GET / DELETE | `/api/PaymentDevices/{deviceId}` | Detalle o eliminación de un dispositivo específico |
| GET | `/api/PaymentDevices/{deviceId}/DeviceInfo` | Detalles técnicos del hardware |
| GET | `/api/PaymentDevices/{deviceId}/Audit` | Descarga archivo de auditoría crudo del dispositivo |
| PUT | `/api/PaymentDevices/{deviceId}/UpdateFirmware` | Envía y ejecuta actualización de firmware |

### Recicladores

| Método | Endpoint | Descripción |
|---|---|---|
| GET / PUT | `/api/PaymentDevices/{deviceId}/Recyclers` | Consulta o actualiza configuración de recicladores |
| PUT | `/api/PaymentDevices/{deviceId}/Recyclers/{recyclerId}/Add` | Añade un ítem de pago al reciclador |
| PUT | `/api/PaymentDevices/{deviceId}/Recyclers/{recyclerId}/Remove` | Elimina un ítem del reciclador |

### Cajas de Efectivo (CashBoxes)

| Método | Endpoint | Descripción |
|---|---|---|
| GET | `/api/PaymentDevices/{deviceId}/CashBoxes` | Lista las cajas de efectivo conectadas |
| GET | `/api/PaymentDevices/{deviceId}/CashBoxes/{cashBoxId}/Actions/Remove` | Prepara la caja para extracción (contadores a cero) |
| GET | `/api/PaymentDevices/{deviceId}/CashBoxes/{cashBoxId}/Actions/Install` | Instala una nueva caja de efectivo |

### Transacciones

| Método | Endpoint | Descripción |
|---|---|---|
| POST | `/api/Transactions` | Inicia una nueva transacción |
| GET | `/api/Transactions/{id}` | Estado y detalles de una transacción específica |
| GET | `/api/Transactions/Current` | Lista transacciones en progreso actualmente |
| GET | `/api/Transactions/action/{id}/cancel` | Solicita cancelación de una transacción |
| GET | `/api/Transactions/action/{id}/end` | Solicita finalizar la transacción lo antes posible |
| GET | `/api/Transactions/download` | Descarga historial de transacciones en CSV |

### Estado del Sistema

| Método | Endpoint | Descripción |
|---|---|---|
| GET | `/api/SystemStatus` | Estado operativo actual del servicio |
| GET | `/api/SystemStatus/Messages` | Mensajes y alertas del sistema |
| GET | `/api/SystemStatus/PaymentItems` | Lista denominaciones configuradas |
| PUT | `/api/SystemStatus/PaymentItems/Enable` | Habilita denominaciones específicas |
| PUT | `/api/SystemStatus/PaymentItems/Inhibit` | Inhibe denominaciones específicas |

### Esquemas de Datos Principales

| Schema | Uso |
|---|---|
| `TransactionDTO` | Respuesta de estado de una transacción |
| `SystemStatusDTO` | Estado del sistema |
| `PaymentTransactionRequestModel` | Body para `POST /api/Transactions` |
| `PaymentDeviceModel` | Representación de un dispositivo de pago |
| `CashBoxModel` | Representación de una caja de efectivo |
| `RecyclerModel` | Representación de un reciclador |
| `DenominationModelDTO` | Denominación de billete o moneda |
| `DeviceMessageDTO` | Mensajes y alertas de un dispositivo |

---

## 4. Flujo Completo de una Transacción en Efectivo

### Etapa 1 — Autenticación

Obtener el Bearer Token como se describe en la sección 2. Incluirlo en todas las peticiones siguientes. El token dura **1 hora**; el cliente HTTP reintenta automáticamente con nuevo token si recibe `401`.

### Etapa 2 — Verificación del Estado del Sistema

Antes de iniciar la transacción, verificar que el reciclador esté operativo.

- **Endpoint:** `GET /api/SystemStatus`
- **Implementado en:** `CPIService.ensure_ready_for_transaction()` → llamado desde `POST /api/payment/cash/initiate`

| `currentStatus` | Acción |
|---|---|
| `OK` / `Warning` | Proceder con `POST /api/Transactions` |
| `Busy` / `Initializing` | Devolver error `CPI_BUSY` (reintentable) — UI muestra "Reintentar" |
| `Error` / otro | Consultar `GET /api/SystemStatus/Messages` para detalle; devolver error `CPI_ERROR` |

> ⚠️ El watchdog global (`HardwareWatchdog`) sondea `SystemStatus` cada 3 s para actualizar el banner de alertas en la UI. El pre-check antes de cada transacción es una verificación puntual adicional.

### Etapa 3 — Inicio de la Transacción

Cuando el usuario confirma el pago, el backend envía la instrucción de cobro.

**Endpoint:** `POST /api/Transactions`

```json
{
  "currencyCode": "MXN",
  "transactionType": "Payment",
  "value": 38000
}
```

> ⚠️ `value` se envía en **centavos**. Ej: `38000` = $380.00 MXN.

**Respuesta:** `TransactionDTO` con los campos `Id` (PascalCase, API .NET) y `transactionStatus`.

> ⚠️ **Campo de ID:** La API del CPI devuelve `Id` con mayúscula (convención .NET/C#). El backend lee `res.get("id") or res.get("Id")` para manejar ambos casos.

**Verificación post-POST:**

| `transactionStatus` | Acción |
|---|---|
| `InProgress` | Proceder al polling |
| `NotStartedInsufficientChange` | Cancelar la transacción creada; devolver error `CPI_INSUFFICIENT_CHANGE` |
| Otro valor | Cancelar la transacción creada; devolver error `CPI_TX_NOT_STARTED` (reintentable) |

### Etapa 4 — Monitoreo del Progreso (Polling de Transacción)

Mientras el usuario inserta billetes y monedas, actualizar la UI en tiempo real.

- **Endpoint:** `GET /api/Transactions/{id}` cada **~300 ms**
- **Campos a observar:**
  - `totalAccepted` / `TotalAccepted` — dinero ingresado (centavos)
  - `totalDispensed` / `TotalDispensed` — cambio que el sistema está devolviendo (centavos)
  - `fixInstructionsUrl` — URL de instrucciones del fabricante si hay atasco

**Cancelación por el usuario:** `GET /api/Transactions/action/{id}/cancel`
El sistema devuelve automáticamente el efectivo ingresado.

### Etapa 5 — Finalización y Cierre

1. Polling detecta `transactionStatus = "CompletedSuccess"`.
2. Imprimir ticket (`POST /api/printer/print`).
3. Llamar `POST /api/transaction/confirm` para limpiar el estado y publicar MQTT.

### Estados fatales que detienen el polling

| Estado | Código error UI | Descripción |
|---|---|---|
| `Error` / `Failed` | — | Error genérico del hardware |
| `Cancelled` / `Canceled` | — | Transacción cancelada |
| `NotStartedInsufficientChange` | `CPI_INSUFFICIENT_CHANGE` | Sin cambio disponible |
| `Transaction_Stalled` / `Jammed` | — | Atasco físico — mostrar `fixInstructionsUrl` |

---

## 5. Errores Críticos y Manejo

| Estado | Descripción | Acción requerida |
|---|---|---|
| `NotStartedInsufficientChange` | Recicladores sin efectivo suficiente para garantizar cambio | No iniciar transacción; notificar al operador para rellenar recicladores |
| `Transaction_Stalled` / `Jammed` | Atasco físico en el reciclador | Mostrar `fixInstructionsUrl` al usuario |
| `PaymentItemStorageFull` | Caja de efectivo o reciclador llenos | Requerir vaciado físico |

**Recuperación tras caída de la app:** Al iniciar, llamar a `GET /api/Transactions/Current`. Si hay transacción pendiente, decidir entre cancelar (`/cancel`) o continuar (`/continue`).

---

## 6. Comandos de Mantenimiento

| Acción | Endpoint / Comando | Descripción |
|---|---|---|
| Vaciado total | `EmptyToCashBox` | Mueve todo el efectivo de recicladores a la caja segura |
| Nivelado (Float Down) | — | Mantiene solo el efectivo necesario para cambio; retira el excedente |
| Extracción de caja | `GET /api/PaymentDevices/{deviceId}/CashBoxes/{cashBoxId}/Actions/Remove` | Sella la bolsa y pone contadores a cero antes de abrir el kiosco |

> 💡 Antes de cada transacción, verificar `GET /api/SystemStatus/PaymentItems` para asegurar que las denominaciones necesarias estén habilitadas.
