const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

const DEFAULT_PORT = 8080;
const HEALTH_TIMEOUT_MS = 30_000;
const RENDERER_TIMEOUT_MS = 30_000;
const BACKEND_READY_PATH = "/api/health";
const DESKTOP_PING_INTERVAL_MS = 5_000;

function createBackendManager({ app, appProductName, dialog }) {
  let backendProcess = null;
  let backendExitExpected = false;
  let isQuitting = false;
  let bootstrapPromise = null;
  let pingInterval = null;

  function getProjectRoot() {
    return path.resolve(__dirname, "..");
  }

  function getBackendPort() {
    const parsed = Number.parseInt(process.env.CCR_PORT || `${DEFAULT_PORT}`, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
    return DEFAULT_PORT;
  }

  function getAppUrl() {
    const devUrl = process.env.REMOTE_CODE_DEV_SERVER_URL;
    if (devUrl) {
      return devUrl;
    }
    return `http://127.0.0.1:${getBackendPort()}`;
  }

  function findDevPythonExecutable() {
    const candidates = process.platform === "win32"
      ? [
          path.join(getProjectRoot(), ".venv", "Scripts", "python.exe"),
          "python",
        ]
      : [
          path.join(getProjectRoot(), ".venv", "bin", "python"),
          "python3",
          "python",
        ];

    for (const candidate of candidates) {
      if (candidate.includes(path.sep) && fs.existsSync(candidate)) {
        return candidate;
      }
      if (!candidate.includes(path.sep)) {
        return candidate;
      }
    }

    return process.platform === "win32" ? "python" : "python3";
  }

  function getPackagedBackendExecutable() {
    const ext = process.platform === "win32" ? ".exe" : "";
    return path.join(process.resourcesPath, "backend", `remote-code-server${ext}`);
  }

  function getBackendCommandSpec() {
    if (app.isPackaged) {
      const executable = getPackagedBackendExecutable();
      if (!fs.existsSync(executable)) {
        throw new Error(`Packaged backend executable was not found: ${executable}`);
      }
      return {
        command: executable,
        args: [],
        cwd: undefined,
      };
    }

    return {
      command: findDevPythonExecutable(),
      args: [path.join(getProjectRoot(), "remote_code_server.py")],
      cwd: getProjectRoot(),
    };
  }

  function waitForUrl(url, timeoutMs) {
    const startedAt = Date.now();

    return new Promise((resolve, reject) => {
      const retry = () => {
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }
        setTimeout(attempt, 400);
      };

      const attempt = () => {
        const request = http.get(url, (response) => {
          response.resume();
          if ((response.statusCode || 500) < 500) {
            resolve();
            return;
          }
          retry();
        });

        request.on("error", retry);
        request.setTimeout(1_000, () => {
          request.destroy();
          retry();
        });
      };

      attempt();
    });
  }

  function start() {
    if (backendProcess && backendProcess.exitCode === null) {
      return;
    }

    const port = getBackendPort();
    const spec = getBackendCommandSpec();
    backendExitExpected = false;

    backendProcess = spawn(
      spec.command,
      [...spec.args, "--host", "127.0.0.1", "--port", String(port)],
      {
        cwd: spec.cwd,
        env: {
          ...process.env,
          CCR_HOST: "127.0.0.1",
          CCR_PORT: String(port),
        },
        stdio: "inherit",
        windowsHide: true,
      },
    );

    backendProcess.on("exit", (code, signal) => {
      const unexpected = !backendExitExpected && !isQuitting;
      backendProcess = null;

      if (unexpected) {
        dialog.showErrorBox(
          appProductName,
          `The bundled backend exited unexpectedly.\ncode=${code ?? "null"} signal=${signal ?? "null"}`,
        );
        app.quit();
      }
    });
  }

  async function stop() {
    // 먼저 ping 중지
    stopDesktopPing();

    // 백엔드에 종료 알림 (정상 종료 경로)
    await notifyShutdown();

    if (!backendProcess || backendProcess.killed || backendProcess.exitCode !== null) {
      backendProcess = null;
      return;
    }

    backendExitExpected = true;

    return new Promise((resolve) => {
      if (process.platform === "win32") {
        const killer = spawn("taskkill", ["/pid", String(backendProcess.pid), "/t", "/f"], {
          windowsHide: true,
          stdio: "ignore",
        });
        killer.on("exit", () => {
          backendProcess = null;
          resolve();
        });
        // 2초 타임아웃
        setTimeout(() => {
          if (backendProcess) {
            backendProcess = null;
          }
          resolve();
        }, 2000);
        return;
      }

      const proc = backendProcess;
      proc.kill("SIGTERM");
      const timeout = setTimeout(() => {
        if (proc.exitCode === null && !proc.killed) {
          proc.kill("SIGKILL");
        }
        backendProcess = null;
        resolve();
      }, 5_000);

      proc.on("exit", () => {
        clearTimeout(timeout);
        backendProcess = null;
        resolve();
      });
    });
  }

  async function ensureReady() {
    if (!bootstrapPromise) {
      bootstrapPromise = (async () => {
        start();
        await waitForUrl(`http://127.0.0.1:${getBackendPort()}${BACKEND_READY_PATH}`, HEALTH_TIMEOUT_MS);
        if (process.env.REMOTE_CODE_DEV_SERVER_URL) {
          await waitForUrl(getAppUrl(), RENDERER_TIMEOUT_MS);
        }
        startDesktopPing();
      })();
    }

    return bootstrapPromise;
  }

  function startDesktopPing() {
    const url = `http://127.0.0.1:${getBackendPort()}/api/desktop/ping`;
    pingInterval = setInterval(async () => {
      try {
        await fetch(url, { method: "POST", signal: AbortSignal.timeout(3000) });
      } catch {
        // Ignore ping failures - backend will self-shutdown after timeout
      }
    }, DESKTOP_PING_INTERVAL_MS);
  }

  function stopDesktopPing() {
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
  }

  async function notifyShutdown() {
    // 정상 종료 시 백엔드에 즉시 종료 신호 전송
    try {
      const url = `http://127.0.0.1:${getBackendPort()}/api/desktop/session`;
      await fetch(url, { method: "DELETE", signal: AbortSignal.timeout(3000) });
    } catch {
      // DELETE 실패 시 프로세스 종료로 fallback
    }
  }

  function markQuitting() {
    isQuitting = true;
  }

  return {
    ensureReady,
    getAppUrl,
    markQuitting,
    stop,
  };
}

module.exports = {
  createBackendManager,
};
