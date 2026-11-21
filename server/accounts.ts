import { Router } from "express";
import { z } from "zod";
import { Cloudflare, ApiError, cfId } from "./cloudflare.js";
import { hashToken } from "./security.js";
import type { Store, Credentials } from "./store.js";

const accountSchema = z.object({
  name: z.string().trim().min(1).max(80),
  accountId: cfId,
  token: z.string().trim().max(512).optional(),
  accessKeyId: z.string().trim().max(256).optional(),
  secretAccessKey: z.string().trim().max(512).optional(),
});

async function resolveS3(
  credentials: Credentials,
  accountId: string,
): Promise<Credentials> {
  if (credentials.accessKeyId && credentials.secretAccessKey)
    return credentials;
  const client = new Cloudflare(credentials.token);
  for (const path of [
    "/user/tokens/verify",
    `/accounts/${accountId}/tokens/verify`,
  ]) {
    try {
      const { result } = await client.call<{ id: string; status: string }>(
        path,
      );
      if (result.status === "active" && result.id)
        return {
          ...credentials,
          accessKeyId: result.id,
          secretAccessKey: hashToken(credentials.token),
        };
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 403)) throw error;
    }
  }
  return credentials;
}

export function accountRoutes(store: Store): Router {
  const router = Router();
  router.get("/", (_request, response) => response.json(store.listAccounts()));
  router.post("/", async (request, response) => {
    const input = accountSchema.parse(request.body);
    response.locals.account = { name: input.name };
    response.locals.auditAttempt = {
      action: "添加账号",
      resource: input.accountId,
    };
    if (!input.token) throw new ApiError(400, "请填写 Cloudflare API Token");
    if (Boolean(input.accessKeyId) !== Boolean(input.secretAccessKey))
      throw new ApiError(
        400,
        "请同时填写 R2 Access Key ID 和 Secret Access Key",
      );
    if (store.hasAccountId(input.accountId))
      throw new ApiError(409, "该 Cloudflare 账号已添加");
    const client = new Cloudflare(input.token);
    await client.call(`/zones?account.id=${input.accountId}&per_page=1`);
    const credentials = await resolveS3(
      {
        token: input.token,
        accessKeyId: input.accessKeyId,
        secretAccessKey: input.secretAccessKey,
      },
      input.accountId,
    );
    const account = store.saveAccount({ ...input, credentials });
    store.audit("添加账号", account.name, account.accountId);
    response.status(201).json(account);
  });
  router.patch("/:id", async (request, response) => {
    const account = store.getAccount(String(request.params.id));
    if (!account) throw new ApiError(404, "账号不存在");
    response.locals.account = account;
    response.locals.auditAttempt = {
      action: "更新账号",
      resource: account.accountId,
    };
    const input = accountSchema.parse(request.body);
    response.locals.auditAttempt.resource = input.accountId;
    const token = input.token || account.credentials.token;
    const credentials = await resolveS3(
      {
        token,
        accessKeyId:
          input.accessKeyId ||
          (token === account.credentials.token
            ? account.credentials.accessKeyId
            : undefined),
        secretAccessKey:
          input.secretAccessKey ||
          (token === account.credentials.token
            ? account.credentials.secretAccessKey
            : undefined),
      },
      input.accountId,
    );
    if (
      Boolean(credentials.accessKeyId) !== Boolean(credentials.secretAccessKey)
    )
      throw new ApiError(400, "R2 凭据必须成对提供");
    await new Cloudflare(token).call(
      `/zones?account.id=${input.accountId}&per_page=1`,
    );
    if (store.hasAccountId(input.accountId, account.id))
      throw new ApiError(409, "该 Cloudflare 账号已添加");
    response.json(store.saveAccount({ id: account.id, ...input, credentials }));
    store.audit("更新账号", account.name, input.accountId);
  });
  router.post("/:id/verify", async (request, response) => {
    const account = store.getAccount(String(request.params.id));
    if (!account) throw new ApiError(404, "账号不存在");
    response.locals.account = account;
    response.locals.auditAttempt = {
      action: "验证账号连接",
      resource: account.accountId,
    };
    const client = new Cloudflare(account.credentials.token);
    const results = await Promise.allSettled([
      client.call(`/zones?account.id=${account.accountId}&per_page=1`),
      client.call(`/accounts/${account.accountId}/r2/buckets?per_page=1`),
    ]);
    response.json({
      dns: results[0].status === "fulfilled",
      r2: results[1].status === "fulfilled",
      errors: results.map((result) =>
        result.status === "rejected" ? result.reason.message : null,
      ),
    });
  });
  router.delete("/:id", (request, response) => {
    const account = store.getAccount(String(request.params.id));
    if (!account) throw new ApiError(404, "账号不存在");
    response.locals.account = account;
    response.locals.auditAttempt = {
      action: "移除面板账号",
      resource: account.accountId,
    };
    store.db.prepare("DELETE FROM accounts WHERE id = ?").run(account.id);
    store.audit("移除面板账号", account.name, account.accountId);
    response.json({ ok: true });
  });
  return router;
}
