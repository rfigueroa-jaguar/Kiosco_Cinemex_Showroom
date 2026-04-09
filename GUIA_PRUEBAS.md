# Guía de pruebas — Kiosco Cinemex

Documento para verificar que la aplicación funciona y cumple los requisitos del [PRD.md](PRD.md) (v1.1). Úsalo como checklist en sesiones de prueba en **banco de pruebas** y en **kiosco real**.

---

## 1. Objetivo

- Validar el **flujo completo** (bienvenida → catálogo → pago → ticket → QR → resumen → bienvenida).
- Comprobar **requisitos no funcionales**: inactividad, recuperación, logs, modelo Task Scheduler / watchdog, manejo de errores.
- Registrar **hardware real** cuando esté disponible.

**Fuente de verdad:** [PRD.md](PRD.md), [UI_GUIDELINES.md](UI_GUIDELINES.md), integraciones (`integracion_*.md`).

---

## 2. Prerrequisitos

| Ítem | Notas |
|------|--------|
| **SO** | Windows 10 (kiosco). |
| **Python** | 3.11+ recomendado; dependencias en `app/pyproject.toml`. |
| **Node.js + npm** | Para `app/ui` (Vite, Electron en desarrollo). |
| **Archivo `app/.env`** | Copiar desde `app/.env.example` y completar CPI, IM30, `PYTHON_PATH` según entorno. |
| **CPI Payment Service** | HTTPS en `{CPI_HOST}:5000`; **Root.cer** en almacén raíz del equipo (ver PRD §3.5 y `app/README.md`). |
| **EMVBridge (IM30)** | En ejecución en `http://{IM30_HOST}:{IM30_PORT}` (típico puerto **6000**). |
| **Impresora** | `CUSTOM MODUS3 X` instalada en Windows (nombre según `config/prod.yaml`). |
| **Lector QR** | Zebra SE2707 en modo HID (teclado). |

**Desarrollo sin todo el hardware:** puedes validar UI, catálogo, inactividad y pantallas de error; CPI/IM30/impresora fallarán de forma controlada si no están configurados.

---

## 3. Arranque para pruebas

### 3.1 Backend (FastAPI)

Desde el directorio `app/`:

```powershell
cd "ruta\al\proyecto\KIOSCO-CINEMEX\app"
pip install -e .
# o instalar manualmente fastapi uvicorn httpx pyyaml pydantic-settings python-dotenv pillow qrcode[pil] pywin32
uvicorn main:app --host 127.0.0.1 --port 8000
```

**Esperado:** consola sin traceback; en logs del día (`app/logs/YYYY-MM-DD.log`) al menos líneas `INFO` de arranque.

### 3.2 Frontend (Vite)

Otra terminal, desde `app/ui/`:

```powershell
cd "ruta\al\proyecto\KIOSCO-CINEMEX\app\ui"
npm install
npm run dev
```

**Esperado:** UI en `http://localhost:5173` (el proxy de Vite reenvía `/api` y `/health` al backend).

### 3.3 Electron (opcional)

Con backend + `npm run dev` activos:

```powershell
$env:VITE_DEV_SERVER_URL="http://localhost:5173"
npm run electron:dev
```

**Esperado:** ventana con la UI; en **producción** el `.exe` debe lanzar Python y esperar `GET /health` (PRD §3.1).

---

## 4. Verificación rápida de API (sin UI)

Ejecutar con el backend en marcha (PowerShell):

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/health" -Method GET
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/status" -Method GET
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/catalog" -Method GET
```

| Comprobación | Criterio de éxito |
|--------------|-------------------|
| `/health` | Respuesta con `status` coherente (p. ej. `ok`). |
| `/api/status` | `success: true`; `data.services` con `cpi`, `im30`, `printer` (`available` / `status`). |
| `/api/catalog` | `success: true`; lista de **9** productos en `data.items`. |

Si CPI no pasa verificación SSL/Root.cer, `cpi.available` debería ser `false` y en logs un **WARNING** explícito (PRD §3.5), no solo un fallo genérico de SSL.

---

## 5. Pruebas funcionales (flujo principal)

Marca **P** (pasó), **F** (falló), **N/A** (no aplica en esta sesión).

| ID | Caso | Pasos | Resultado esperado (PRD) | P/F/N/A |
|----|------|--------|---------------------------|---------|
| **F-01** | Bienvenida | Abrir app. | Pantalla de bienvenida; al tocar, ir al catálogo (§8.2). | |
| **F-02** | Catálogo | Ver categorías y 9 productos; +/- en cantidades. | Agrupación por categoría; carrito lateral/inferior con total; **Pagar** deshabilitado si carrito vacío (§8.3). | |
| **F-03** | Vaciar carrito | Con ítems, pulsar vaciar. | Carrito en cero; total actualizado. | |
| **F-04** | Ir a pago | Con carrito, **Pagar**. | Pantalla de método de pago con Efectivo / Tarjeta (§8.4). | |
| **F-05** | CPI no disponible | Simular: sin CPI o `cpi.available` false. | Botón **Efectivo** deshabilitado y mensaje claro (§8.4, §11). | |
| **F-06** | IM30 no disponible | Sin Bridge en 6000. | Botón **Tarjeta** deshabilitado y mensaje claro (§8.4, §11). | |
| **F-07** | Pago efectivo feliz | Efectivo habilitado; completar cobro hasta `CompletedSuccess`. | Progreso / montos; al éxito: animación de éxito → escaneo QR; **polling detenido** al salir de pantalla (§8.5, §3.5). | |
| **F-08** | Cancelar efectivo | En cobro, **Cancelar**. | Cancelación CPI; vuelta a método de pago; **sin** polling huérfano (§8.5). | |
| **F-09** | Pago tarjeta feliz | Tarjeta habilitada; aprobar en terminal. | Espera “Acerca tu tarjeta…”; tras `approved`, flujo ticket → QR (§8.6). | |
| **F-10** | Tarjeta rechazada / error | Forzar rechazo o error. | Mensaje al usuario; **Reintentar** y **Cancelar** (§8.6, §11). | |
| **F-11** | Impresión | Tras pago exitoso. | Ticket con QR; QR = solo `transaction_id` (UUID) (§8.7). | |
| **F-12** | Fallo impresora | Simular impresora apagada o no encontrada. | Mensaje o fallo controlado; **flujo continúa** hacia QR (§8.7, §11). | |
| **F-13** | Pantalla QR | Legible instrucción; esperar escaneo. | Timeout **120 s** → bienvenida y limpieza de estado (§8.8). | |
| **F-14** | QR válido | Escanear UUID correcto (HID + Enter). | Modal de resumen con ítems y total (§8.8, §8.9). | |
| **F-15** | QR inválido | Escanear otro UUID. | Mensaje “QR no válido…”; reintento posible (§8.8). | |
| **F-16** | Confirmar resumen | **Confirmar** en modal. | Cierre modal; carrito limpio; **bienvenida**; `transaction_state.json` eliminado (§8.9, §12). | |
| **F-17** | MQTT al confirmar | (Pendiente §15) | Hoy: stub; cuando exista broker, verificar publicación. | N/A hasta definir payloads |

---

## 6. Inactividad (PRD §9)

| ID | Caso | Pasos | Resultado esperado | P/F/N/A |
|----|------|--------|---------------------|---------|
| **I-01** | Carrito vacío | Catálogo o método de pago, sin tocar **60 s**. | Vuelta directa a **bienvenida**. | |
| **I-02** | Carrito con productos | Mismo escenario con ítems en carrito. | Modal **“¿Sigues ahí?”** con contador **60 s**. | |
| **I-03** | Continuar en modal | En modal, **Continuar comprando**. | Modal cierra; timer reiniciado. | |
| **I-04** | Timeout del modal | No interactuar **60 s** con modal abierto. | Carrito vacío; bienvenida. | |
| **I-05** | Cancelar compra | **Cancelar compra** en modal. | Bienvenida inmediata. | |
| **I-06** | Pausa en pago | Durante efectivo o tarjeta activo. | **No** debe saltar inactividad que corte el pago (§9). | |

---

## 7. Recuperación `transaction_state.json` (PRD §12)

Archivo en `app/transaction_state.json` (o ruta que use el backend según configuración).

| ID | Caso | Preparación | Resultado esperado al reiniciar backend + recargar UI | P/F/N/A |
|----|------|-------------|--------------------------------------------------------|---------|
| **R-01** | `step: waiting_payment` | Archivo con transacción en espera de pago. | Cancelación CPI si aplica; limpieza; comportamiento documentado en PRD (p. ej. bienvenida / reset). | |
| **R-02** | `step: printing` | Archivo en paso impresión. | Reintento de impresión o flujo hacia QR según implementación (§12). | |
| **R-03** | `step: waiting_qr` | Archivo en espera de escaneo. | UI va a pantalla QR **sin** borrar el JSON hasta Confirmar / timeout / cancel (§12). | |
| **R-04** | No borrar en QR | Tras entrar a QR con transacción válida. | El archivo **sigue existiendo** hasta conclusión definitiva (§12). | |

---

## 8. Errores y capas (PRD §11)

| ID | Caso | Cómo probar | Esperado |
|----|------|-------------|----------|
| **E-01** | ErrorBoundary | (Solo desarrollo) provocar error de render en un componente hijo. | Pantalla de recuperación con opción de recargar; **no** pantalla en blanco. | |
| **E-02** | CPI fatal en cobro | Forzar estado error en transacción o API. | Mensaje en UI; polling detenido (§8.5, §3.5). | |
| **E-03** | `fixInstructionsUrl` | Si CPI devuelve URL de desatasco. | Enlace o texto visible al usuario (§11). | |
| **E-04** | Logs Python | Forzar error controlado o revisar tras fallo. | Entrada en `app/logs/YYYY-MM-DD.log` con nivel y módulo (§14). | |

---

## 9. Watchdog y Task Scheduler (PRD §13, §16)

| ID | Qué verificar | Cómo | Criterio de éxito |
|----|----------------|------|-------------------|
| **W-01** | Watchdog en runtime | Dejar la app corriendo; desconectar temporalmente un servicio (o simular) y esperar varios ciclos (`watchdog_interval_seconds`). | `GET /api/status` refleja cambio en `services.*` **sin** reinicio del proceso. | |
| **W-02** | Task Scheduler | Revisar tarea en el Programador de tareas del kiosco. | Arranque al inicio; **reiniciar si falla** con delay acordado (~5 s). | |
| **W-03** | Caída del proceso | (Solo en entorno controlado) terminar el `.exe` o el proceso hijo según política. | El SO/Task Scheduler relanza la app según la tarea configurada. | |

---

## 10. Reglas de implementación v1.1 (PRD §3.5)

| ID | Regla | Verificación breve |
|----|--------|---------------------|
| **V-01** | Root.cer CPI | Sin certificado correcto o hint erróneo: WARNING en log + CPI no disponible, no solo error SSL opaco. | |
| **V-02** | Token 401 en CPI | (Difícil sin forzar token expirado) Si se reproduce: una reautenticación y un reintento antes de fallar al cliente. | |
| **V-03** | IM30 antes de venta | Revisar logs o tráfico: antes de `sale`, health/login coherente (§3.5). | |

---

## 11. Interfaz y animaciones (PRD §8.x, §17, UI_GUIDELINES)

Checklist rápido en **kiosco real** (1080×1920 portrait):

- [ ] Fullscreen / kiosk sin barra de navegación del SO (build producción).
- [ ] Tipografías, colores y componentes acordes a `UI_GUIDELINES.md`.
- [ ] Transiciones entre pantallas (slide ~0,25 s); stagger en catálogo; éxito con check + partículas.
- [ ] Sin **blur animado** en backdrop; sin **box-shadow** animado en bucles (§17).
- [ ] Con “reducir movimiento” en SO, animaciones casi instantáneas (`useReducedMotion`).

---

## 12. Definición de terminado — checklist resumido (PRD §16)

Copiar y marcar al cerrar la validación de release:

**Flujo**

- [ ] Flujo de punta a punta sin intervención manual.
- [ ] Errores con respuesta en pantalla; sin blanco total por error de render (ErrorBoundary).
- [ ] Inactividad: vacío / con modal / timeout modal (§9).

**Hardware** (en banco real)

- [ ] CPI + recicladores operativos.
- [ ] IM30 cobro de prueba OK.
- [ ] Ticket con QR legible.
- [ ] Lector Zebra abre modal de resumen con QR correcto.

**Interfaz**

- [ ] UI_GUIDELINES respetado.
- [ ] Fullscreen + portrait en resolución del kiosco.
- [ ] Animaciones fluidas en hardware Intel UHD del kiosco.

**Estabilidad**

- [ ] Arranque automático (Task Scheduler u operación equivalente).
- [ ] Reinicio del `.exe` ante fallo (política Windows).
- [ ] Watchdog actualiza servicios sin reiniciar proceso.
- [ ] Recuperación con `transaction_state.json` verificada (§7 de esta guía).

**MQTT**

- [ ] Pendiente hasta definir payloads (PRD §15) — no bloquea otras pruebas.

---

## 13. Registro de sesión de prueba (plantilla)

```
Fecha: _______________
Probador: _______________
Entorno: [ ] Dev Vite  [ ] Electron dev  [ ] .exe producción
Build / commit: _______________

Resumen: _________________________________________________
Incidencias: ______________________________________________
```

---

## 14. Referencias rápidas

| Documento | Uso en pruebas |
|-----------|----------------|
| [PRD.md](PRD.md) | Requisitos y DoD |
| [UI_GUIDELINES.md](UI_GUIDELINES.md) | Aspecto visual |
| [app/README.md](app/README.md) | CPI Root.cer, arranque backend |
| [integracion_cpi.md](integracion_cpi.md) | Efectivo |
| [integracion_im30.md](integracion_im30.md) | Tarjeta |
| [integracion_impresora.md](integracion_impresora.md) | Ticket |

---

*Última alineación con PRD v1.1.*
