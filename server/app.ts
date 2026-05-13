import "react-router";
import { createRequestHandler } from "@react-router/express";
import express from "express";
import cookieParser from "cookie-parser";
import { getDb } from "../lib/db.js";
import { getUserFromSession, type User } from "../lib/auth.js";
import { startPromotionJob, startSyncJob, startBackupJob } from "./jobs.js";
import { authRouter } from "./routes/auth.js";
import { suggestionsRouter } from "./routes/suggestions.js";
import { moderationRouter } from "./routes/moderation.js";
import { adminRouter } from "./routes/admin.js";
import { syncPushRouter } from "./routes/sync-push.js";
import { wordRouter } from "./routes/word.js";
import { sitemapRouter } from "./routes/sitemap.js";
import { partnerRouter } from "./routes/partner.js";
import { mcpRouter } from "./routes/mcp.js";

declare module "react-router" {
  interface AppLoadContext {
    db: ReturnType<typeof getDb>;
    user: User | null;
  }
}

export const app = express();

app.set("trust proxy", 1);
app.use(cookieParser());
app.use(express.json());

app.use(sitemapRouter);
app.use("/mcp", mcpRouter);
app.use("/api/auth", authRouter);
app.use("/api/suggestions", suggestionsRouter);
app.use("/api/moderation", moderationRouter);
app.use("/api/admin", adminRouter);
app.use("/api/sync", syncPushRouter);
app.use("/api", wordRouter);
app.use("/api/partner", partnerRouter);

startPromotionJob();
startSyncJob();
startBackupJob();

app.use(
  createRequestHandler({
    build: () => import("virtual:react-router/server-build"),
    getLoadContext(req) {
      const sessionId = req.cookies?.session as string | undefined;
      const db = getDb();
      const user = sessionId ? getUserFromSession(db, sessionId) : null;
      return { db, user };
    },
  })
);
