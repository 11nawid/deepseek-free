import sys
import os
import subprocess
import pathlib
import threading
import time
import webbrowser
import atexit

ROOT = pathlib.Path(__file__).resolve().parent
VENV = ROOT / ".venv"
VENV_PY = VENV / "Scripts" / "python.exe" if os.name == "nt" else VENV / "bin" / "python"
WEBSIDE_DIR = ROOT / "webside"

def ensure_env():
    # Python env
    if getattr(sys, "frozen", False): return
    
    if not VENV_PY.exists():
        print("First run: creating virtual environment and installing python dependencies...")
        subprocess.run([sys.executable, "-m", "venv", str(VENV)], check=True)
        subprocess.run([str(VENV_PY), "-m", "pip", "install", "--upgrade", "pip"], check=True)
        subprocess.run([str(VENV_PY), "-m", "pip", "install", "-r", str(ROOT / "requirements.txt")], check=True)
        print("Python dependencies installed.")

    # Node env
    if not (WEBSIDE_DIR / "node_modules").exists():
        print("First run: installing Next.js dependencies (this might take a minute)...")
        shell = True if os.name == "nt" else False
        subprocess.run(["npm", "install"], cwd=str(WEBSIDE_DIR), shell=shell, check=True)
        print("Node dependencies installed.")

    # Relaunch with venv if not already
    if sys.executable != str(VENV_PY) and os.environ.get("RUN_MAIN") != "true":
        sys.exit(subprocess.run([str(VENV_PY), __file__] + sys.argv[1:]).returncode)

ensure_env()

# ---------------------------------------------------------------------------
# From here on we are guaranteed to be running inside the venv with deps.
# ---------------------------------------------------------------------------
import uvicorn
from dotenv import load_dotenv
from dsk.server import bypass_cloudflare
import json

load_dotenv()
BACKEND_PORT = int(os.getenv("PORT", "8000"))
FRONTEND_PORT = 8180

COOKIE_PATH = ROOT / "dsk" / "cookies.json"
def ensure_cookies(force: bool = False) -> None:
    if COOKIE_PATH.exists() and not force:
        age = time.time() - COOKIE_PATH.stat().st_mtime
        if age < 6 * 3600:
            return
    print("Refreshing DeepSeek cookies (this opens a browser window)...")
    try:
        driver = bypass_cloudflare("https://chat.deepseek.com", 5, False)
        cookies = {c.get("name", ""): c.get("value", " ") for c in driver.cookies()}
        user_agent = driver.user_agent
        driver.quit()
        COOKIE_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(COOKIE_PATH, "w", encoding="utf-8") as f:
            json.dump({"cookies": cookies, "user_agent": user_agent}, f, indent=4, ensure_ascii=False)
        print("Cookies saved.")
    except Exception as e:
        print(f"Warning: could not refresh cookies automatically: {e}")

next_process = None

def start_frontend():
    global next_process
    print(f"Starting Next.js frontend on port {FRONTEND_PORT}...")
    env = os.environ.copy()
    env["PORT"] = str(FRONTEND_PORT)
    shell = True if os.name == "nt" else False
    next_process = subprocess.Popen(["npm", "run", "dev"], cwd=str(WEBSIDE_DIR), env=env, shell=shell)

def cleanup():
    if next_process:
        try:
            if os.name == "nt":
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(next_process.pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                next_process.terminate()
        except:
            pass

atexit.register(cleanup)

def open_browser():
    time.sleep(5)  # Give Next.js time to compile
    webbrowser.open(f"http://localhost:{FRONTEND_PORT}")

if __name__ == "__main__":
    os.makedirs("data", exist_ok=True)

    import logging
    logging.basicConfig(
        level=logging.DEBUG,
        format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stdout,
    )
    # Quieten noisy third-party loggers
    for noisy in ("uvicorn.access", "uvicorn.error", "httpcore", "httpx", "curl_cffi"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    if "--backend-only" in sys.argv:
        print(f"AI Backend API running on port {BACKEND_PORT} (backend-only mode)")
        uvicorn.run("backend.api:app", host="127.0.0.1", port=BACKEND_PORT, log_level="info")
    else:
        ensure_cookies()
        threading.Thread(target=start_frontend, daemon=True).start()
        threading.Thread(target=open_browser, daemon=True).start()
        print(f"AI Backend API running on port {BACKEND_PORT}")
        print(f"Next.js Website running on port {FRONTEND_PORT}")
        uvicorn.run("backend.api:app", host="127.0.0.1", port=BACKEND_PORT, log_level="info")

