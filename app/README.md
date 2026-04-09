# Kiosco Cinemex — Backend y configuración

## Certificado SSL del CPI Payment Service

Antes de que el backend llame a `https://{CPI_HOST}:5000`, comprueba que el certificado **Root.cer** (generado en la instalación del CPI) esté en el almacén de **Autoridades de certificación raíz de confianza** del equipo:

1. `Win + R` → `mmc` → Archivo → Agregar o quitar complemento → Certificados → Equipo local.
2. Autoridades de certificación raíz de confianza → Certificados → clic derecho → Todas las tareas → Importar → seleccionar **Root.cer**.

La subcadena buscada en Subject/Issuer se configura en `config/prod.yaml` (`cpi_root_cert_subject_hint`). Ajuste el valor si el sujeto de su Root.cer no contiene el texto por defecto.

En **desarrollo** puede definirse `CPI_ALLOW_WITHOUT_ROOT_VERIFICATION=true` en `.env` (no usar en el kiosco de producción).

## Entorno virtual (recomendado)

Para aislar dependencias del resto del sistema, use un `.venv` en este directorio (`app/`). La carpeta `.venv/` está ignorada por Git.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .
```

- **Alternativa sin instalación editable:** `pip install -r requirements.txt` (solo dependencias; sigue ejecutando el servidor con `cd` en `app/`).
- **Primera vez:** crear el venv y ejecutar `pip install -e .` con el entorno activado (recomendado; el `pyproject.toml` ya excluye `ui/` y `config/` del empaquetado Python).
- **Electron en desarrollo:** en `.env`, asigne `PYTHON_PATH` a la ruta absoluta de `.\.venv\Scripts\python.exe` para que el proceso principal use el mismo intérprete.
- **Kiosco / producción:** `PYTHON_PATH` suele apuntar al Python instalado en el equipo (no al `.venv` del repo), según despliegue.

## Arranque del backend

Desde este directorio (`app/`), con el entorno virtual **activado**:

```powershell
.\.venv\Scripts\Activate.ps1
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

En Windows, si `uvicorn` directo da **Acceso denegado**, use siempre `python -m uvicorn` (evita ejecutar `Scripts\uvicorn.exe`, a menudo bloqueado por antivirus o carpetas sincronizadas).

## Electron

En `ui/`, con el backend ya corriendo en desarrollo:

```powershell
npm install
npm run dev
```

En otra terminal, con `VITE_DEV_SERVER_URL=http://localhost:5173`:

```powershell
npm run electron:dev
```

Build de producción: `npm run build` y luego ejecutar el `.exe` generado por `electron-builder` (el proceso principal lanzará Python según `PYTHON_PATH` en `.env`).

## Task Scheduler (reinicio del proceso)

El **reinicio automático** del `.exe` ante fallos lo gestiona el **Programador de tareas de Windows** (retraso 5 s, “reiniciar si falla”), no el proceso Python. Consulte la documentación interna del despliegue para la tarea registrada en el equipo del showroom.
