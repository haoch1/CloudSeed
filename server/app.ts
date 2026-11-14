import express from "express";
import type { ErrorRequestHandler } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ZodError } from "zod";
import { Store } from "./store.js";
import { ApiError } from "./cloudflare.js";
import { authRoutes, requireAuth } from "./auth.js";
import { accountRoutes } from "./accounts.js";
import { dnsRoutes } from "./dns.js";
import { r2Routes, s3Client } from "./r2.js";

export function createApp(store: Store, r2Client = s3Client) {
  const app = express();
  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY === "true") app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: ["'self'", "blob:", "https://*.r2.cloudflarestorage.com"],
          imgSrc: [
            "'self'",
            "blob:",
            "data:",
            "https://*.r2.cloudflarestorage.com",
          ],
          mediaSrc: ["'self'", "blob:", "https://*.r2.cloudflarestorage.com"],
          frameSrc: ["'self'", "blob:", "https://*.r2.cloudflarestorage.com"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());
  app.use("/api", (request, response, next) => {
    response.set("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      if (request.get("X-CloudSeed-Request") !== "1")
        return next(new ApiError(403, "请求来源校验失败"));
      const origin = request.get("Origin");
      if (origin) {
        const expected = process.env.PUBLIC_URL
          ? new URL(process.env.PUBLIC_URL).origin
          : `${request.protocol}://${request.get("host")}`;
        // Vite 开发代理保留前端 Origin
        const localDev =
          process.env.NODE_ENV !== "production" &&
          ["http://127.0.0.1:5173", "http://localhost:5173"].includes(origin);
        if (origin !== expected && !localDev)
          return next(new ApiError(403, "请求来源与面板地址不匹配"));
      }
    }
    next();
  });
  app.get("/api/health", (_request, response) =>
    response.json({ ok: true, version: "0.1.0" }),
  );
  app.use("/api/auth", authRoutes(store));
  app.use("/api", requireAuth(store));
  app.use("/api/accounts", accountRoutes(store));
  app.use("/api/accounts/:account/dns", dnsRoutes(store));
  app.use("/api/accounts/:account/r2", r2Routes(store, r2Client));
  app.get("/api/audit", (request, response) =>
    response.json(
      store.listAudit(
        Math.max(1, Math.min(100000, Number(request.query.page) || 1)),
      ),
    ),
  );
  app.use("/api", (_request, _response, next) =>
    next(new ApiError(404, "接口不存在")),
  );
  const dist = resolve("dist");
  if (existsSync(dist)) {
    app.use(express.static(dist, { index: false }));
    app.get("/{*path}", (_request, response) =>
      response.sendFile(resolve(dist, "index.html")),
    );
  }
  const errors: ErrorRequestHandler = (error, request, response, _next) => {
    if (error instanceof ZodError)
      return void response
        .status(400)
        .json({ error: error.issues.map((issue) => issue.message).join("；") });
    const upstreamStatus = error.$metadata?.httpStatusCode as
      number | undefined;
    const status =
      error instanceof ApiError
        ? error.status
        : upstreamStatus === 404
          ? 404
          : upstreamStatus === 403
            ? 403
            : upstreamStatus === 412
              ? 409
              : 500;
    const message =
      error instanceof ApiError
        ? error.message
        : upstreamStatus
          ? `R2 ${error.name}，${error.message}`
          : error.type === "entity.parse.failed"
            ? "JSON 格式不正确"
            : "服务处理失败，请查看配置后重试";
    if (!["GET", "HEAD"].includes(request.method) && status >= 400)
      store.audit(request.method, "", request.path, "failed", message);
    response
      .status(error.type === "entity.parse.failed" ? 400 : status)
      .json({ error: message });
  };
  app.use(errors);
  return app;
}
