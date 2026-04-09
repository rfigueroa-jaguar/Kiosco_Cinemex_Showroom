# Despliegue en kiosco real (checklist)

Guía para pasar este proyecto al equipo físico del showroom / Cinemex y dejarlo operativo con pagos, impresión y escaneo.

---

## 1. Certificado `certificado_cpi.crt` — ¿te sirve o necesitas otro?

### Qué es

- Es un archivo **PEM** con la **autoridad certificadora (CA) raíz** que el código usa para **verificar el HTTPS** del CPI (`httpx` + `CPI_CA_BUNDLE`).
- En el repo corresponde a una CA con nombre tipo **CPI.PaymentService.Jaguar.Root.CA** (Jaguar Payment Service).

### Cuándo **sí** puedes usar el mismo archivo

- El kiosco se conecta al **mismo tipo de despliegue CPI** que en desarrollo (misma cadena TLS: el servidor CPI presenta un certificado firmado por **esa misma raíz**).
- En la práctica: si el **host/puerto CPI de producción** es el servicio Jaguar/CPI que ya validaste en laboratorio con ese PEM, **no hace falta generar otro** solo por cambiar de PC.

### Cuándo **debes** sustituirlo o pedir uno nuevo a integración

- El CPI de **sitio** usa **otra instalación** u otra CA (otro `Root.cer`, otro proveedor, certificados rotados).
- El HTTPS del CPI falla con error de cadena / “certificate verify failed” aunque `Root.cer` esté en Windows: entonces necesitas el **PEM de la CA correcta** (a veces es exportar el `Root.cer` del CPI de **ese** sitio a formato PEM y apuntar `CPI_CA_BUNDLE` a ese archivo).

### Doble capa que exige el backend (no es solo el `.crt`)

1. **`CPI_CA_BUNDLE`** → archivo PEM en disco (p. ej. `certificado_cpi.crt`), para las llamadas **Python/httpx**.
2. **`Root.cer` en Windows** → importado en **Equipo local → Autoridades de certificación raíz de confianza** (como en `app/README.md`). El arranque comprueba que en el almacén exista un certificado cuyo Subject/Issuer contenga la subcadena de `cpi_root_cert_subject_hint` en `config/prod.yaml` (por defecto `"CPI"`).

En **producción** deja `CPI_ALLOW_WITHOUT_ROOT_VERIFICATION=false` (o no lo definas).

---

## 2. Variables `.env` en el kiosco (mínimo operativo)

Copia `app/.env.example` → `app/.env` y completa según el sitio:

| Variable | Notas |
|----------|--------|
| `CPI_HOST` | IP o hostname del **CPI Payment Service** alcanzable desde el kiosco (no `localhost` salvo que el CPI corra en el mismo equipo). |
| `CPI_PORT` | Típicamente `5000` si no te indican otro. |
| `CPI_CLIENT_ID`, `CPI_CLIENT_SECRET`, `CPI_USERNAME`, `CPI_PASSWORD` | Credenciales del entorno **real** (no las de laboratorio si son distintas). |
| `CPI_CA_BUNDLE` | Ruta al PEM correcto; puede ser `certificado_cpi.crt` en la **raíz del repo** o ruta **absoluta** en el disco del kiosco. |
| `IM30_HOST`, `IM30_PORT`, `IM30_USER`, `IM30_PASSWORD`, `EMV_BRIDGE_TOKEN` | Bridge EMV / TPV según despliegue (suelen ser red local o `localhost` si el bridge está en el mismo PC). |
| `THERMAL_PRINTER_NAME` | Nombre **exacto** como en Windows “Impresoras y escáneres”. Si vacío, se usa `printer_name` de `config/prod.yaml`. |
| `PYTHON_PATH` | Ruta absoluta al `python.exe` que ejecutará el backend (venv de producción o Python instalado). Importante si usas **Electron** empaquetado. |
| MQTT | Solo si ya activan broker y tópicos en ese entorno; si no, pueden quedar vacíos según el comportamiento actual del proyecto. |

**Seguridad:** no subas `.env` a Git; permisos de lectura solo para la cuenta que ejecuta el servicio.

---

## 3. `config/prod.yaml` en el kiosco

- `printer_name` y/o `THERMAL_PRINTER_NAME` coherentes con el equipo.
- `ticket_width_mm` al ancho real del rollo (p. ej. 76).
- `cpi_root_cert_subject_hint`: si el Subject de tu `Root.cer` no contiene `"CPI"`, ajústalo al fragmento que sí aparezca (mayúsculas/minúsculas da igual en la búsqueda).
- **`card_terminal_charge_amount_mx`**: hoy en el repo puede estar en valor de **prueba** (p. ej. `0.10`). En **producción** debe coincidir con lo acordado con operaciones / TPV (monto real o política del cine). **Revísalo antes de encender pagos reales.**

---

## 4. Red y firewall

- Desde el kiosco: **ping / curl** (o navegador) a `https://CPI_HOST:CPI_PORT` según políticas de red.
- Puerto del **backend** (p. ej. 8000) y del **frontend** (Vite en dev o estático/Electron en prod) abiertos **solo donde haga falta** (localhost vs LAN).
- Que no bloquee antivirus el `python.exe`, `uvicorn` o el `.exe` de Electron (falsos positivos frecuentes en carpetas sincronizadas).

---

## 5. Windows en el equipo

- **Zona horaria** y reloj correctos (afecta tickets, logs y a veces TLS).
- **Impresora térmica** instalada, papel y **corte** probados.
- **Lector QR** en modo teclado (HID) probado en la pantalla “Escanea tu QR”.
- **Arranque automático:** configurar el **Programador de tareas** según la **§6** (obligatorio en el modelo del PRD para el kiosco en producción).

---

## 6. Arranque automático al encender el equipo (PRD §3.1 y §13)

El **PRD** define que, al encender el kiosco, **no** dependa de abrir manualmente una terminal: el **Programador de tareas de Windows (Task Scheduler)** debe lanzar la aplicación. Con la opción **«reiniciar si falla»** (p. ej. retraso de unos **5 segundos** entre reintentos, según operaciones), Windows vuelve a ejecutar el proceso si termina de forma anómala.

**Importante:** el **`watchdog.py`** del backend solo **consulta** CPI, IM30 e impresora y actualiza `GET /api/status`. **No** reinicia Python ni uvicorn; eso es responsabilidad del Task Scheduler (y/o de Electron como proceso padre). No duplicar un segundo “watchdog” en Python que relance el servidor: puede chocar con la tarea programada (PRD §13).

### 6.1 Escenario recomendado en el PRD: ejecutable de Electron

Flujo documentado en **PRD §3.1**:

1. El Task Scheduler ejecuta el **`.exe` generado por `electron-builder`**.
2. **Electron** arranca y lanza **FastAPI** (`main.py`) como **proceso hijo**, usando **`PYTHON_PATH`** del archivo `app/.env`.
3. Electron hace *polling* a **`GET /health`** hasta que el backend responde (timeout ~10 s en el diseño del PRD) y abre la ventana en **pantalla completa** / modo kiosco.

**Registro de la tarea programada (resumen operativo):**

| Campo | Valor orientativo |
|--------|-------------------|
| **Acción** | Iniciar un programa. |
| **Programa o script** | Ruta completa al `.exe` del kiosco (instalación local). |
| **Iniciar en** | Carpeta base de esa instalación (donde Electron resuelva recursos y, si aplica, donde esté el `.env` que use el *spawn* de Python). |
| **Desencadenador principal** | **Al iniciar el sistema** (el PRD prevé ejecución **sin** que un usuario deba iniciar sesión; en la práctica puede requerirse guardar credenciales de una cuenta de servicio o de kiosco con “Ejecutar tanto si el usuario ha iniciado sesión como si no”). |

**Pestaña Configuración / opciones avanzadas:**

- Activar **«Si la tarea falla, reiniciar cada…»** con intervalo acordado (el PRD menciona reintentos con demora corta, p. ej. **5 s**).
- Evitar **«Detener la tarea si se ejecuta durante más de…»** si cortaría la app en uso normal.
- Si CPI o red tardan en estar listos al arranque del SO, añadir **retraso** al desencadenador (p. ej. **30–60 s**).

**Requisitos:** `PYTHON_PATH` en `app/.env` apuntando al `python.exe` correcto (venv de producción o Python del equipo). El bridge **IM30** debe estar en marcha **antes** o al mismo tiempo que el flujo de pago con tarjeta (PRD §12 — servicio externo; no lo levanta Electron).

### 6.2 Alternativa: solo backend FastAPI (uvicorn), sin Electron

Para **pruebas**, **showroom con navegador** o despliegues donde el front no sea el `.exe` de Electron:

| Campo | Valor orientativo |
|--------|-------------------|
| **Programa o script** | Ruta absoluta a `python.exe` (p. ej. `...\app\.venv\Scripts\python.exe`). |
| **Agregar argumentos** | `-m uvicorn main:app --host 127.0.0.1 --port 8000` |
| **Iniciar en** | Carpeta **`app`** del proyecto (donde está `main.py`), p. ej. `...\KIOSCO-CINEMEX\app`. |

FastAPI carga `app/.env` al iniciar; las rutas relativas de ese archivo deben seguir siendo válidas desde el directorio de trabajo **`app`**.

**Cuidado:** si ya usáis **Electron** en producción, **no** registréis además una tarea que lance uvicorn en el mismo puerto **8000** — solo un proceso debe escuchar ese puerto.

### 6.3 Comprobación tras un reinicio en frío

1. Reiniciar el PC y **sin** abrir manualmente consola ni IDE, esperar el tiempo de la tarea (y el retraso si lo configuraste).
2. Probar **`http://127.0.0.1:8000/health`** (o el mecanismo equivalente que use vuestra UI).
3. Revisar **`app/logs/`** del día: errores de `PYTHON_PATH`, imports, CPI/SSL o permisos suelen dejarse ahí.

---

## 7. Software a instalar

- **Python** acorde a `requirements.txt` / `pyproject.toml` (versión que ya usas en desarrollo).
- Entorno virtual en `app/` o Python global, con `pip install -e .` o `pip install -r requirements.txt`.
- **Node** solo si construyes la UI en el kiosco; o bien despliegas artefactos ya buildeados (`npm run build`, Electron según vuestro flujo).
- **pywin32** en Windows para impresión y utilidades del CPI en ese SO.

Arranque típico del API (desde `app/`):

```powershell
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

(Preferir `python -m uvicorn` ante problemas de “acceso denegado” con el `.exe` de uvicorn.)

Para **arranque automático** del backend en el kiosco, véase la **§6** (Electron recomendado por PRD, o uvicorn vía Task Scheduler).

---

## 8. Datos y logs en disco

- `app/transaction_state.json`: persistencia de flujo; en despliegue nuevo puede no existir hasta la primera venta.
- `app/logs/`: rotación / espacio en disco si el equipo es de larga duración.
- `app/config/logo.png`: opcional para el ticket.

---

## 9. Prueba corta antes de “ir al cien”

1. `GET /api/status` → servicios CPI / IM30 / impresora en verde o mensaje claro si algo falta.
2. Flujo efectivo pequeño (si aplica) hasta impresión y escaneo de QR.
3. Flujo tarjeta (si aplica) con monto de prueba acordado hasta voucher en ticket.
4. **Reinicio en frío del PC:** con la tarea del **§6** activa, comprobar que el backend (y, si aplica, Electron) suben solos; luego validar recuperación de estado según `waiting_qr` / `printing` / etc.

---

## Preguntas que conviene tener resueltas (con integración / Cinemex)

Respóndelas por escrito internamente; no hace falta enviarlas al repositorio.

1. ¿El **CPI de cine** es el mismo “stack” Jaguar que en showroom (misma CA / mismo `Root.cer`) o es otro nodo con **otro** certificado raíz?
2. ¿IP/hostname y puerto **definitivos** del CPI y del **bridge IM30** desde el kiosco?
3. ¿Monto y moneda **reales** en TPV para `card_terminal_charge_amount_mx` y alineación con el total del carrito?
4. ¿Nombre **exacto** de la impresora en Windows y ancho de ticket (58 / 80 mm)?
5. ¿El kiosco corre **solo navegador + API** o **Electron** empaquetado? (define cómo fijas `PYTHON_PATH` y arranque en frío.)
6. ¿Hay **MQTT** obligatorio en ese sitio o puede quedar desactivado?

---

## Resumen sobre `certificado_cpi.crt`

| Situación | Acción |
|-----------|--------|
| Misma CA / mismo CPI que validaste con ese archivo | Mantener `CPI_CA_BUNDLE=certificado_cpi.crt` (o copia en ruta absoluta en el kiosco). |
| CPI de producción con otra raíz o cadena distinta | Obtener el PEM/Root correcto del integrador o exportar el `Root.cer` de **esa** instalación y actualizar `CPI_CA_BUNDLE`. |
| Siempre | Instalar **Root.cer** en el almacén de confianza de Windows y revisar `cpi_root_cert_subject_hint`. |

Si tras despliegue ves `Pago en efectivo no disponible` por SSL, revisa **primero** logs (`app/logs`) y la combinación **PEM + Root en Windows + host alcanzable**.
