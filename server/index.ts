import express, { type Request, Response, NextFunction } from "express";
import { spawn, ChildProcess } from "child_process";
import path from "path";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { createLNPoller } from "./ln-poller";

// Rail services child processes
let railBtcProcess: ChildProcess | null = null;

function startRailServices() {
  // Start rail-btc if BTC is enabled
  if (process.env.ENABLE_BTC === "true") {
    const railBtcPath = path.resolve(process.cwd(), "rail-btc/src/index.ts");
    
    railBtcProcess = spawn("npx", ["tsx", railBtcPath], {
      cwd: path.resolve(process.cwd(), "rail-btc"),
      env: {
        ...process.env,
        PORT: "5002",
        BTC_NETWORK: process.env.BTC_NETWORK || "testnet",
        PAYMENTS_SERVICE_URL: "http://localhost:5000",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    railBtcProcess.stdout?.on("data", (data) => {
      const lines = data.toString().split("\n").filter((l: string) => l.trim());
      lines.forEach((line: string) => {
        log(`[rail-btc] ${line}`);
      });
    });

    railBtcProcess.stderr?.on("data", (data) => {
      const lines = data.toString().split("\n").filter((l: string) => l.trim());
      lines.forEach((line: string) => {
        log(`[rail-btc:err] ${line}`);
      });
    });

    railBtcProcess.on("exit", (code) => {
      log(`[rail-btc] Process exited with code ${code}`);
      // Restart after a delay if it crashes
      if (code !== 0) {
        setTimeout(() => {
          log("[rail-btc] Restarting...");
          startRailServices();
        }, 5000);
      }
    });

    log("[rail-btc] Started Bitcoin rail service on port 5002");
  }
}

// Cleanup on shutdown
process.on("SIGTERM", () => {
  if (railBtcProcess) {
    railBtcProcess.kill();
  }
  process.exit(0);
});

process.on("SIGINT", () => {
  if (railBtcProcess) {
    railBtcProcess.kill();
  }
  process.exit(0);
});

const app = express();

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

  // Initialize Lightning Network polling worker (Step 5.2: Polling fallback)
  // Checks pending LN invoices at regular intervals (fallback to webhooks)
  // Uses shared config validation (same as LN adapter)
  createLNPoller();

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
    
    // Start rail microservices after main server is listening
    startRailServices();
  });
})();
