import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { rateLimit } from "express-rate-limit";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { ApiError } from "./cloudflare.js";
import {
  equalSecret,
  hashPassword,
  hashToken,
  verifyPassword,
} from "./security.js";
import type { Store } from "./store.js";
import {
  defaultSessionDurationSeconds,
  isSessionDurationSeconds,
  sessionDurationOptions,
} from "../shared/session.js";

const cookieName = "cloudseed-session";
const sessionDurationKey = "session_duration_seconds";
const legacyLoginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(12).max(256),
});
const loginSchema = z.preprocess(
  (value) => {
    if (value && typeof value === "object") {
      const input = value as Record<string, unknown>;
      return { ...input, username: input.username ?? input.email };
    }
    return value;
  },
  z.object({
    username: z.string().trim().min(1).max(254),
    password: z.string().min(12).max(256),
  }),
);

export function bootstrapAdmin(
  store: Store,
  username = "admin",
  password = store.setupToken,
) {
  if (store.db.prepare("SELECT id FROM admin WHERE id = 1").get()) return;
  const input = loginSchema.parse({ username, password });
  const normalizedUsername = input.username.toLowerCase();
  // Existing databases use the email column for the login identifier.
  const result = store.db
    .prepare("INSERT OR IGNORE INTO admin(id,email,password) VALUES(1,?,?)")
    .run(normalizedUsername, hashPassword(input.password));
  if (!result.changes) return;
  store.audit("创建管理员", "", normalizedUsername);
  return { username: normalizedUsername, password: input.password };
}

function sessionDuration(store: Store): number {
  const setting = store.db
    .prepare("SELECT value FROM panel_settings WHERE key = ?")
    .get(sessionDurationKey) as { value: string } | undefined;
  const seconds = Number(setting?.value);
  return isSessionDurationSeconds(seconds)
    ? seconds
    : defaultSessionDurationSeconds;
}

function setSessionCookie(
  request: Request,
  response: Response,
  token: string,
  seconds: number,
) {
  response.cookie(cookieName, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: request.secure,
    maxAge: seconds * 1000,
    path: "/",
  });
}

function activeSession(
  store: Store,
  request: Request,
  response: Response,
  upgradeLegacy = true,
) {
  const token = request.cookies[cookieName];
  if (typeof token !== "string") return undefined;
  const tokenHash = hashToken(token);
  const now = Date.now();
  const session = store.db
    .prepare("SELECT expires, duration_seconds FROM sessions WHERE token = ?")
    .get(tokenHash) as
    | { expires: number; duration_seconds: number | null }
    | undefined;
  if (!session || session.expires <= now) return undefined;
  if (upgradeLegacy && session.duration_seconds === null) {
    const seconds = sessionDuration(store);
    const expires = now + seconds * 1000;
    const updated = store.db
      .prepare(
        "UPDATE sessions SET expires = ?, duration_seconds = ? WHERE token = ? AND duration_seconds IS NULL AND expires > ?",
      )
      .run(expires, seconds, tokenHash, now);
    if (updated.changes) {
      setSessionCookie(request, response, token, seconds);
      return { tokenHash, expires };
    }
    const current = store.db
      .prepare("SELECT expires FROM sessions WHERE token = ?")
      .get(tokenHash) as { expires: number } | undefined;
    if (!current || current.expires <= now) return undefined;
    return { tokenHash, expires: current.expires };
  }
  return { tokenHash, expires: session.expires };
}

export function requireAuth(
  store: Store,
  options: { upgradeLegacy?: boolean } = {},
) {
  return (request: Request, response: Response, next: NextFunction) => {
    const session = activeSession(
      store,
      request,
      response,
      options.upgradeLegacy,
    );
    if (!session) return next(new ApiError(401, "请先登录面板"));
    response.locals.session = session;
    next();
  };
}

export function authRoutes(store: Store): Router {
  const router = Router();
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "尝试次数过多，请稍后再试" },
  });
  const openSession = (request: Request, response: Response) => {
    const token = randomBytes(32).toString("hex");
    const seconds = sessionDuration(store);
    store.db.prepare("DELETE FROM sessions WHERE expires < ?").run(Date.now());
    store.db
      .prepare(
        "INSERT INTO sessions(token,expires,duration_seconds) VALUES(?,?,?)",
      )
      .run(hashToken(token), Date.now() + seconds * 1000, seconds);
    setSessionCookie(request, response, token, seconds);
  };
  router.get("/status", (request, response) => {
    const admin = store.db
      .prepare("SELECT email FROM admin WHERE id = 1")
      .get() as { email: string } | undefined;
    const session = activeSession(store, request, response);
    const authenticated = Boolean(session);
    response.json({
      initialized: Boolean(admin),
      authenticated,
      username: authenticated ? admin?.email : undefined,
      email: authenticated ? admin?.email : undefined,
    });
  });
  router.post("/setup", limiter, (request, response) => {
    const input = legacyLoginSchema
      .extend({ setupToken: z.string().min(1).max(256) })
      .parse(request.body);
    if (store.db.prepare("SELECT id FROM admin WHERE id = 1").get())
      throw new ApiError(409, "管理员已初始化");
    if (!equalSecret(input.setupToken, store.setupToken))
      throw new ApiError(403, "初始化码不正确，请查看服务启动日志");
    store.db
      .prepare("INSERT INTO admin(id,email,password) VALUES(1,?,?)")
      .run(input.email.toLowerCase(), hashPassword(input.password));
    openSession(request, response);
    store.audit("初始化管理员", "", input.email);
    response.json({ ok: true });
  });
  router.post("/login", limiter, (request, response) => {
    const input = loginSchema.parse(request.body);
    const admin = store.db
      .prepare("SELECT email AS username,password FROM admin WHERE id = 1")
      .get() as { username: string; password: string } | undefined;
    if (
      !admin ||
      !verifyPassword(input.password, admin.password) ||
      input.username.toLowerCase() !== admin.username
    )
      throw new ApiError(401, "用户名或密码不正确");
    openSession(request, response);
    response.json({ ok: true });
  });
  router.post("/logout", (request, response) => {
    const token = request.cookies[cookieName];
    if (typeof token === "string")
      store.db
        .prepare("DELETE FROM sessions WHERE token = ?")
        .run(hashToken(token));
    response.clearCookie(cookieName, { path: "/" });
    response.json({ ok: true });
  });
  router.get("/session-duration", requireAuth(store), (_request, response) => {
    response.json({
      durationSeconds: sessionDuration(store),
      expiresAt: new Date(response.locals.session.expires).toISOString(),
    });
  });
  router.put(
    "/session-duration",
    requireAuth(store, { upgradeLegacy: false }),
    (request, response) => {
      response.locals.auditAttempt = {
        action: "更新登录有效期",
        resource: "管理员",
      };
      const { durationSeconds } = z
        .object({
          durationSeconds: z
            .number()
            .int()
            .refine(isSessionDurationSeconds, "请选择有效的登录有效期"),
        })
        .parse(request.body);
      const now = Date.now();
      const expires = now + durationSeconds * 1000;
      store.db.exec("BEGIN IMMEDIATE");
      try {
        const updated = store.db
          .prepare(
            "UPDATE sessions SET expires = ?, duration_seconds = ? WHERE token = ? AND expires > ?",
          )
          .run(
            expires,
            durationSeconds,
            response.locals.session.tokenHash,
            now,
          );
        if (!updated.changes) throw new ApiError(401, "请先登录面板");
        store.db
          .prepare(
            "INSERT INTO panel_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          )
          .run(sessionDurationKey, String(durationSeconds));
        const label =
          sessionDurationOptions.find(
            (option) => option.seconds === durationSeconds,
          )?.label ?? `${durationSeconds} 秒`;
        store.audit("更新登录有效期", "", "管理员", "success", label);
        store.db.exec("COMMIT");
      } catch (error) {
        store.db.exec("ROLLBACK");
        throw error;
      }
      setSessionCookie(
        request,
        response,
        request.cookies[cookieName],
        durationSeconds,
      );
      response.json({
        durationSeconds,
        expiresAt: new Date(expires).toISOString(),
      });
    },
  );
  router.post("/password", requireAuth(store), (request, response) => {
    response.locals.auditAttempt = {
      action: "修改管理员密码",
      resource: "管理员",
    };
    const input = z
      .object({
        currentPassword: z.string().max(256),
        newPassword: z.string().min(12).max(256),
      })
      .parse(request.body);
    const admin = store.db
      .prepare("SELECT password FROM admin WHERE id = 1")
      .get() as { password: string };
    if (!verifyPassword(input.currentPassword, admin.password))
      throw new ApiError(403, "当前密码不正确");
    store.db.exec("BEGIN IMMEDIATE");
    try {
      store.db
        .prepare("UPDATE admin SET password = ? WHERE id = 1")
        .run(hashPassword(input.newPassword));
      store.db.exec("DELETE FROM sessions; COMMIT;");
    } catch (error) {
      store.db.exec("ROLLBACK");
      throw error;
    }
    response.clearCookie(cookieName, { path: "/" });
    store.audit("修改管理员密码", "", "管理员");
    response.json({ ok: true });
  });
  return router;
}
