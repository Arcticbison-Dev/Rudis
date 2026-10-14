import express, { type Request, Response, NextFunction } from "express";
import { spawn, ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { createLNPoller } from "./ln-poller";

// ESM-safe __dirname (replaces CJS __dirname which is unavailable in "type":"module" packages)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Rail services child processes
let railBtcProcess: ChildProcess | null = null;
let railXmrProcess: ChildProcess | null = null;

// Use the node binary that's running this process — always available, no PATH dependency
const NODE_BIN = process.execPath;

// In production, rail scripts are pre-built into dist/ alongside this file.
// In development, we fall back to tsx via the dev script (not this spawn path).
function getRailScriptPath(name: string): string {
  return path.resolve(__dirname, `${name}.js`);
}

function spawnRailProcess(name: string, scriptPath: string, cwd: string, env: Record<string, string>): ChildProcess {
  const proc = spawn(NODE_BIN, [scriptPath], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Must handle 'error' event or Node.js will throw and crash the parent process
  proc.on("error", (err) => {
    log(`[${name}:error] Failed to spawn: ${err.message} (node: ${NODE_BIN}, script: ${scriptPath})`);
  });

  proc.stdout?.on("data", (data) => {
    const lines = data.toString().split("\n").filter((l: string) => l.trim());
    lines.forEach((line: string) => log(`[${name}] ${line}`));
  });

  proc.stderr?.on("data", (data) => {
    const lines = data.toString().split("\n").filter((l: string) => l.trim());
    lines.forEach((line: string) => log(`[${name}:err] ${line}`));
  });

  return proc;
}

function startRailServices() {
  if (process.env.ENABLE_BTC === "true") {
    const railBtcPath = getRailScriptPath("rail-btc");
    // cwd = app root so node_modules are resolvable for any external deps
    const appRoot = path.resolve(__dirname, "..");
    railBtcProcess = spawnRailProcess("rail-btc", railBtcPath, appRoot, {
      PORT: "5002",
      BTC_NETWORK: process.env.BTC_NETWORK || "mainnet",
      PAYMENTS_SERVICE_URL: "http://localhost:5000",
    });
    railBtcProcess.on("exit", (code) => {
      log(`[rail-btc] Process exited with code ${code}`);
      if (code !== 0) {
        setTimeout(() => { log("[rail-btc] Restarting..."); startRailServices(); }, 5000);
      }
    });
    log(`[rail-btc] Starting Bitcoin rail service (${railBtcPath}) on port 5002`);
  }

  if (process.env.ENABLE_XMR === "true") {
    const railXmrPath = getRailScriptPath("rail-xmr");
    const appRoot = path.resolve(__dirname, "..");
    railXmrProcess = spawnRailProcess("rail-xmr", railXmrPath, appRoot, {
      PORT: "5003",
      PAYMENTS_SERVICE_URL: "http://localhost:5000",
      XMR_DEV_MODE: process.env.XMR_DEV_MODE || "false",
      XMR_NETWORK: process.env.XMR_NETWORK || "mainnet",
    });
    railXmrProcess.on("exit", (code) => {
      log(`[rail-xmr] Process exited with code ${code}`);
      if (code !== 0) {
        setTimeout(() => { log("[rail-xmr] Restarting..."); startRailServices(); }, 5000);
      }
    });
    log(`[rail-xmr] Starting Monero rail service (${railXmrPath}) on port 5003`);
  }
}

// Cleanup on shutdown
process.on("SIGTERM", () => {
  if (railBtcProcess) railBtcProcess.kill();
  if (railXmrProcess) railXmrProcess.kill();
  process.exit(0);
});

process.on("SIGINT", () => {
  if (railBtcProcess) railBtcProcess.kill();
  if (railXmrProcess) railXmrProcess.kill();
  process.exit(0);
});

const app = express();

// Trust Railway's proxy (required for express-rate-limit behind Railway/any reverse proxy)
// Without this, X-Forwarded-For headers cause ERR_ERL_UNEXPECTED_X-FORWARDED-FOR
app.set('trust proxy', 1);

// ── Security headers (no Helmet dependency — applied manually) ────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  if (req.path.startsWith('/api')) {
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  }
  res.removeHeader('X-Powered-By');
  next();
});

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }
      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  createLNPoller();

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    throw err;
  });

  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
    startRailServices();
  });
})();
