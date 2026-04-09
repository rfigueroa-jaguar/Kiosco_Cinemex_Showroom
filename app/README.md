# Kiosco Cinemex — Backend y configuración

## Certificado SSL del CPI Payment Service

Antes de que el backend llame a `https://{CPI_HOST}:5000`, comprueba que el certificado **Root.cer** (generado en la instalación del CPI) esté en el almacén de **Autoridades de certificación raíz de confianza** del equipo:

1. `Win + R` → `mmc` → Archivo → Agregar o quitar complemento → Certificados → Equipo local.
2. Autoridades de certificación raíz de confianza → Certificados → clic derecho → Todas las tareas → Importar → seleccionar **Root.cer**.

La subcadena buscada en Subject/Issuer se configura en `config/prod.yaml` (`cpi_root_cert_subject_hint`). Ajuste el valor si el sujeto de su Root.cer no contiene el texto por defecto.

En **desarrollo** puede definirse `CPI_ALLOW_WITHOUT_ROOT_VERIFICATION=true` en `.env` (no usar en el kiosco de producción).

## Arranque del backend

Desde este directorio (`app/`):

```bash
pip install -e .
uvicorn main:app --host 127.0.0.1 --port 8000
```

## Electron

En `ui/`, con el backend ya corriendo en desarrollo:

```bash
npm install
npm run dev
```

En otra terminal, con `VITE_DEV_SERVER_URL=http://localhost:5173`:

```bash
npm run electron:dev
```

Build de producción: `npm run build` y luego ejecutar el `.exe` generado por `electron-builder` (el proceso principal lanzará Python según `PYTHON_PATH` en `.env`).

## Task Scheduler (reinicio del proceso)

El **reinicio automático** del `.exe` ante fallos lo gestiona el **Programador de tareas de Windows** (retraso 5 s, “reiniciar si falla”), no el proceso Python. Consulte la documentación interna del despliegue para la tarea registrada en el equipo del showroom.
