/**
 * Electron — arranca FastAPI (main.py) y abre la UI en fullscreen (PRD §3.1, §3.4).
 */
const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");

const isDev = !!process.env.VITE_DEV_SERVER_URL;

function getAppDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "backend")
    : path.join(__dirname, "..", "..");
}

let pythonProcess = null;
let mainWindow = null;

function loadEnvPythonPath() {
  try {
    const fs = require("fs");
    const envPath = path.join(getAppDir(), ".env");
    if (!fs.existsSync(envPath)) return null;
    const text = fs.readFileSync(envPath, "utf8");
    const m = text.match(/^\s*PYTHON_PATH\s*=\s*(.+)\s*$/m);
    if (!m) return null;
    return m[1].trim().replace(/^["']|["']$/g, "");
  } catch {
    return null;
  }
}

function waitForHealth(timeoutMs = 10_000, intervalMs = 500) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get("http://127.0.0.1:8000/health", (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve(true);
          return;
        }
        retry();
      });
      req.on("error", () => retry());
      req.setTimeout(2000, () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - start >= timeoutMs) {
        reject(new Error("FastAPI no respondió a tiempo en /health"));
        return;
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

function startPython() {
  const appDir = getAppDir();
  const pythonScript = path.join(appDir, "main.py");
  const pythonPath = process.env.PYTHON_PATH || loadEnvPythonPath() || "python";
  pythonProcess = spawn(pythonPath, [pythonScript], {
    cwd: appDir,
    env: { ...process.env },
    windowsHide: true,
  });
  pythonProcess.stdout.on("data", (d) => console.log(`[Python] ${d}`));
  pythonProcess.stderr.on("data", (d) => console.error(`[Python] ${d}`));
  pythonProcess.on("close", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[Python] proceso terminó con código ${code}`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        dialog.showErrorBox("Backend", "El proceso Python se detuvo. La aplicación se cerrará.");
      }
      app.quit();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 1920,
    fullscreen: !isDev,
    kiosk: !isDev,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(async () => {
  if (!isDev) {
    startPython();
    try {
      await waitForHealth();
    } catch (e) {
      console.error(e);
      dialog.showErrorBox(
        "Kiosco Cinemex",
        "No se pudo conectar con el backend (FastAPI). Revise PYTHON_PATH y que el puerto 8000 esté libre."
      );
      app.quit();
      return;
    }
  }
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (pythonProcess && !pythonProcess.killed) {
    try {
      pythonProcess.kill();
    } catch (_) {}
  }
});
