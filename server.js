import "dotenv/config";
import compression from "compression";
import express from "express";
import morgan from "morgan";

const BUILD_PATH = "./build/server/index.js";
const DEVELOPMENT = process.env.NODE_ENV === "development";
const PORT = Number.parseInt(process.env.PORT || "3000", 10);
// Loopback only: Caddy proxies to 127.0.0.1, so a wider bind only puts the app
// on the public interface with the firewall as the sole thing in front of it.
const HOST = process.env.HOST || "127.0.0.1";

const app = express();

app.use(compression());
app.disable("x-powered-by");

if (DEVELOPMENT) {
  console.log("Starting development server");
  const http = await import("http");
  const vite = await import("vite");
  const server = http.createServer(app);
  const viteDevServer = await vite.createServer({
    server: {
      middlewareMode: true,
      hmr: { server },
    },
  });
  // Vite serves anything under the project root: data/app.db, server.js,
  // .env via `?raw`. dev.spielwoerter.de served all three publicly until
  // 2026-10-25. Hand Vite only the paths a browser needs; everything else
  // falls through to the app and 404s.
  const VITE_PATH = /^\/(@vite\/|@id\/|@fs\/|@react-refresh|node_modules\/|app\/|lib\/)/;
  app.use(express.static("public"));
  app.use((req, res, next) =>
    VITE_PATH.test(req.path) ? viteDevServer.middlewares(req, res, next) : next()
  );
  app.use(async (req, res, next) => {
    try {
      const source = await viteDevServer.ssrLoadModule("./server/app.ts");
      await source.app(req, res, next);
    } catch (error) {
      if (typeof error === "object" && error instanceof Error) {
        viteDevServer.ssrFixStacktrace(error);
      }
      next(error);
    }
  });
  server.listen(PORT, HOST, () => {
    console.log(`Server is running on http://${HOST}:${PORT}`);
  });
} else {
  console.log("Starting production server");
  app.use(
    "/assets",
    express.static("build/client/assets", { immutable: true, maxAge: "1y" })
  );
  // The inbound mail routes carry INBOUND_SECRET in the path; keep it out of the logs.
  morgan.token("url", (/** @type {express.Request} */ req) => (req.originalUrl || req.url).replace(/(\/api\/inbound\/)[^/?]+/, "$1***"));
  app.use(morgan("tiny"));
  app.use(express.static("build/client", { maxAge: "1h" }));
  const mod = await import(BUILD_PATH);
  app.use(mod.app);
  app.listen(PORT, HOST, () => {
    console.log(`Server is running on http://${HOST}:${PORT}`);
  });
}
