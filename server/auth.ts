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

const cookieName = "cloudseed-session";
const lifetime = 12 * 60 * 60 * 1000;
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

export function requireAuth(store: Store) {
  return (request: Request, _response: Response, next: NextFunction) => {
    const token = request.cookies[cookieName];
    const session =
      typeof token === "string" &&
      (store.db
        .prepare("SELECT expires FROM sessions WHERE token = ?")
        .get(hashToken(token)) as { expires: number } | undefined);
    if (!session || session.expires < Date.now())
      return next(new ApiError(401, "请先登录面板"));
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
    store.db.prepare("DELETE FROM sessions WHERE expires < ?").run(Date.now());
    store.db
      .prepare("INSERT INTO sessions(token,expires) VALUES(?,?)")
      .run(hashToken(token), Date.now() + lifetime);
    response.cookie(cookieName, token, {
      httpOnly: true,
      sameSite: "strict",
      secure: request.secure,
      maxAge: lifetime,
      path: "/",
    });
  };
  router.get("/status", (request, response) => {
    const admin = store.db
      .prepare("SELECT email FROM admin WHERE id = 1")
      .get() as { email: string } | undefined;
    const token = request.cookies[cookieName];
    const session =
      typeof token === "string" &&
      (store.db
        .prepare("SELECT expires FROM sessions WHERE token = ?")
        .get(hashToken(token)) as { expires: number } | undefined);
    const authenticated = Boolean(session && session.expires > Date.now());
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
  router.post("/password", requireAuth(store), (request, response) => {
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
