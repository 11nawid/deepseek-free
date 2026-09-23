const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");

const isDev = !app.isPackaged;
const ROOT = __dirname;
const WEBSIDE_DIR = path.join(ROOT, "webside");
const COOKIE_PATH = path.join(ROOT, "dsk", "cookies.json");
const BACKEND_PORT = 8000;
const FRONTEND_PORT = 8180;

let mainWindow = null;
let backendProcess = null;
let frontendProcess = null;

function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => { socket.destroy(); resolve(false); });
    socket.connect(port, "127.0.0.1");
  });
}

function killPortProcesses(port) {
  if (process.platform !== "win32") return Promise.resolve();
  return new Promise((resolve) => {
    try {
      const { execSync } = require("child_process");
      const output = execSync(`netstat -aon | findstr :${port}`).toString();
      const lines = output.split('\n');
      const pids = new Set();
      lines.forEach(line => {
        if (line.includes(`:${port}`) && line.includes('LISTENING')) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && pid !== "0") pids.add(pid);
        }
      });
      pids.forEach(pid => {
        try { execSync(`taskkill /F /T /PID ${pid}`); } catch (e) {}
      });
    } catch (e) {}
    resolve();
  });
}

function waitForPort(port, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const socket = new net.Socket();
      socket.once("connect", () => { socket.destroy(); resolve(); });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) reject(new Error(`Port ${port} timeout`));
        else setTimeout(check, 500);
      });
      socket.connect(port, "127.0.0.1");
    };
    check();
  });
}

function areCookiesFresh() {
  try {
    if (!fs.existsSync(COOKIE_PATH)) return false;
    const ageHours = (Date.now() - fs.statSync(COOKIE_PATH).mtimeMs) / (1000 * 60 * 60);
    return ageHours < 6;
  } catch { return false; }
}

function startBackend() {
  return new Promise(async (resolve, reject) => {
    const alreadyRunning = await isPortInUse(BACKEND_PORT);
    if (alreadyRunning) {
      if (isDev) {
        console.log("[backend] Killing existing process on port", BACKEND_PORT);
        await killPortProcesses(BACKEND_PORT);
        await new Promise(r => setTimeout(r, 1000));
      } else {
        console.log("[backend] Already running on port", BACKEND_PORT);
        return resolve();
      }
    }

    const bundledExe = path.join(ROOT, "dist", "backend.exe");
    const useBundled = !isDev && fs.existsSync(bundledExe);

    if (useBundled) {
      console.log("[backend] Starting bundled exe...");
      backendProcess = spawn(bundledExe, [], {
        cwd: ROOT, stdio: "pipe",
        env: { ...process.env, PORT: String(BACKEND_PORT) },
      });
    } else {
      const venvPython = path.join(ROOT, ".venv", "Scripts", "python.exe");
      const pythonCmd = fs.existsSync(venvPython) ? venvPython
        : process.platform === "win32" ? "python" : "python3";

      const args = isDev
        ? ["-c", "import uvicorn; uvicorn.run('backend.api:app', host='127.0.0.1', port=" + BACKEND_PORT + ", log_level='info')"]
        : ["-m", "uvicorn", "backend.api:app", "--host", "127.0.0.1", "--port", String(BACKEND_PORT)];

      console.log("[backend] Starting:", pythonCmd, args.join(" "));
      backendProcess = spawn(pythonCmd, args, {
        cwd: ROOT, stdio: "pipe",
        env: { ...process.env, PORT: String(BACKEND_PORT) },
      });
    }

    backendProcess.stdout?.on("data", (d) => process.stdout.write("[backend] " + d));
    backendProcess.stderr?.on("data", (d) => process.stderr.write("[backend] " + d));
    backendProcess.on("error", reject);

    try { await waitForPort(BACKEND_PORT, 30000); console.log("[backend] Ready"); resolve(); }
    catch (e) { reject(e); }
  });
}

function startFrontend() {
  return new Promise(async (resolve, reject) => {
    const alreadyRunning = await isPortInUse(FRONTEND_PORT);
    if (alreadyRunning) {
      if (isDev) {
        console.log("[frontend] Killing existing process on port", FRONTEND_PORT);
        await killPortProcesses(FRONTEND_PORT);
        await new Promise(r => setTimeout(r, 1000));
      } else {
        console.log("[frontend] Already running on port", FRONTEND_PORT);
        return resolve();
      }
    }

    await killPortProcesses(FRONTEND_PORT);
    await new Promise(r => setTimeout(r, 500));

    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const args = isDev ? ["run", "dev"] : ["run", "start"];

    console.log("[frontend] Starting:", npm, args.join(" "), "in", WEBSIDE_DIR);
    frontendProcess = spawn(npm, args, {
      cwd: WEBSIDE_DIR, stdio: "pipe",
      env: { ...process.env, PORT: String(FRONTEND_PORT) },
      shell: process.platform === "win32",
    });

    frontendProcess.stdout?.on("data", (d) => process.stdout.write("[frontend] " + d));
    frontendProcess.stderr?.on("data", (d) => process.stderr.write("[frontend] " + d));
    frontendProcess.on("error", reject);

    waitForPort(FRONTEND_PORT, 60000)
      .then(() => { console.log("[frontend] Ready"); resolve(); })
      .catch(reject);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200, height: 800, minWidth: 800, minHeight: 600,
    title: "DeepSeek Free",
    icon: path.join(ROOT, "webside", "public", "favicon.ico"),
    frame: false,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(ROOT, "preload.js"),
      contextIsolation: true, nodeIntegration: false,
      webSecurity: !isDev,
    },
  });

  // Spoof standard Chrome User-Agent to bypass Google Speech API block
  mainWindow.webContents.userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.on("maximize", () => {
    mainWindow?.webContents.send("window-state", "maximized");
  });
  mainWindow.on("unmaximize", () => {
    mainWindow?.webContents.send("window-state", "normal");
  });

  const url = "http://127.0.0.1:" + FRONTEND_PORT;
  console.log("[window] Loading", url);
  mainWindow.loadURL(url);
}

ipcMain.handle("get-app-path", () => ({ root: ROOT, cookies: COOKIE_PATH, isDev }));
ipcMain.handle("are-cookies-fresh", () => areCookiesFresh());

// ---------- Screen Recorder ----------
function randomRecordingName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 8);
  return `recording-${stamp}-${rand}.mp4`;
}

function getDefaultRecordingDir() {
  try {
    const videos = app.getPath("videos");
    const dir = path.join(videos, "deepseek-free-recording");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    const fallback = path.join(ROOT, "data", "recordings");
    if (!fs.existsSync(fallback)) fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

ipcMain.handle("screen-get-default-path", () => {
  const dir = getDefaultRecordingDir();
  return { dir, fileName: randomRecordingName(), fullPath: path.join(dir, randomRecordingName()) };
});

ipcMain.handle("screen-get-sources", async () => {
  const { desktopCapturer } = require("electron");
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 320, height: 200 },
      fetchWindowIcons: true,
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL(),
      appIcon: s.appIcon ? s.appIcon.toDataURL() : null,
      displayId: s.display_id,
    }));
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle("screen-save-dialog", async (_e, suggestedName) => {
  const { dialog } = require("electron");
  const dir = getDefaultRecordingDir();
  const name = suggestedName || randomRecordingName();
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Save screen recording",
    defaultPath: path.join(dir, name),
    buttonLabel: "Save recording",
    filters: [
      { name: "MP4 Video", extensions: ["mp4"] },
      { name: "WebM Video", extensions: ["webm"] },
    ],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle("screen-save-file", async (_e, { filePath, data }) => {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const buf = Buffer.from(data);
    fs.writeFileSync(filePath, buf);
    return { success: true, path: filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("screen-open-folder", async (_e, filePath) => {
  try {
    const { shell } = require("electron");
    shell.showItemInFolder(filePath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("dialog-open-directory", async () => {
  const { dialog } = require("electron");
  const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
});

ipcMain.handle("fs-read-dir", async (_e, dirPath) => {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true }).map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory(),
      path: path.join(dirPath, e.name),
    }));
    return { path: dirPath, entries };
  } catch (err) {
    return { error: err.message };
  }
});


ipcMain.on("window-minimize", () => mainWindow?.minimize());
ipcMain.on("window-maximize", () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on("window-close", () => mainWindow?.close());
ipcMain.handle("window-is-maximized", () => mainWindow?.isMaximized() ?? false);

app.whenReady().then(async () => {
  const { session } = require("electron");
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true);
    } else {
      callback(true); // Just allow standard things like notifications/media
    }
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (permission === 'media') return true;
    return true;
  });

  try {
    console.log("[app] Starting services...");
    await Promise.all([startBackend(), startFrontend()]);
    console.log("[app] Creating window...");
    createWindow();
  } catch (err) {
    console.error("[app] Failed:", err);
    app.quit();
  }
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

app.on("before-quit", () => {
  [frontendProcess, backendProcess].forEach((proc) => {
    if (proc && !proc.killed) {
      try {
        if (process.platform === "win32")
          spawn("taskkill", ["/F", "/T", "/PID", String(proc.pid)], { stdio: "ignore" });
        else proc.kill("SIGTERM");
      } catch {}
    }
  });
});

function cleanupAndExit() {
  console.log("\n[app] Shutting down, cleaning up processes...");
  const { spawnSync } = require("child_process");
  if (backendProcess && !backendProcess.killed) {
    try { process.platform === "win32" ? spawnSync("taskkill", ["/F", "/T", "/PID", String(backendProcess.pid)], { stdio: "ignore" }) : backendProcess.kill("SIGTERM"); } catch(e) {}
  }
  if (frontendProcess && !frontendProcess.killed) {
    try { process.platform === "win32" ? spawnSync("taskkill", ["/F", "/T", "/PID", String(frontendProcess.pid)], { stdio: "ignore" }) : frontendProcess.kill("SIGTERM"); } catch(e) {}
  }
  process.exit(0);
}

process.on("SIGINT", cleanupAndExit);
process.on("SIGTERM", cleanupAndExit);
process.on("exit", () => {
  if (backendProcess && !backendProcess.killed) backendProcess.kill();
  if (frontendProcess && !frontendProcess.killed) frontendProcess.kill();
});
