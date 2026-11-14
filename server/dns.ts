import { Router } from "express";
import { z } from "zod";
import { accountClient, ApiError, cfId, dnsSchema } from "./cloudflare.js";
import type { Store } from "./store.js";
import type { DnsRecord, Zone } from "../shared/types.js";

export function dnsRoutes(store: Store): Router {
  const router = Router({ mergeParams: true });
  router.use((request, response, next) => {
    const account = store.getAccount(String(request.params.account));
    if (!account) return next(new ApiError(404, "账号不存在"));
    response.locals.account = account;
    response.locals.cf = accountClient(account);
    next();
  });
  router.get("/zones", async (_request, response) => {
    response.json(
      await accountClient(response.locals.account).list<Zone>(
        `/zones?account.id=${response.locals.account.accountId}`,
      ),
    );
  });
  // 验证 Zone 归属，限制令牌可访问多个账号时的跨账号误操作
  router.use("/zones/:zone", async (request, response, next) => {
    const zoneId = cfId.parse(request.params.zone);
    const { result } = await accountClient(response.locals.account).call<
      Zone & { account: { id: string } }
    >(`/zones/${zoneId}`);
    if (result.account.id !== response.locals.account.accountId)
      throw new ApiError(403, "域名不属于当前账号");
    response.locals.zoneId = zoneId;
    response.locals.zoneName = result.name;
    next();
  });
  router.get("/zones/:zone/records", async (_request, response) => {
    response.json(
      await accountClient(response.locals.account).list<DnsRecord>(
        `/zones/${response.locals.zoneId}/dns_records`,
      ),
    );
  });
  router.post("/zones/:zone/records", async (request, response) => {
    const input = dnsSchema.parse(request.body);
    const { result } = await accountClient(response.locals.account).call(
      `/zones/${response.locals.zoneId}/dns_records`,
      { method: "POST", body: input },
    );
    store.audit(
      "新增 DNS 记录",
      response.locals.account.name,
      `${input.name} (${input.type})`,
    );
    response.status(201).json(result);
  });
  router.patch("/zones/:zone/records/:record", async (request, response) => {
    const record = cfId.parse(request.params.record);
    const input = z.object(dnsSchema.shape).partial().parse(request.body);
    if (!Object.keys(input).length)
      throw new ApiError(400, "未提供要修改的字段");
    const { result } = await accountClient(response.locals.account).call(
      `/zones/${response.locals.zoneId}/dns_records/${record}`,
      { method: "PATCH", body: input },
    );
    store.audit(
      "修改 DNS 记录",
      response.locals.account.name,
      `${response.locals.zoneName} / ${record}`,
    );
    response.json(result);
  });
  router.delete("/zones/:zone/records/:record", async (request, response) => {
    const record = cfId.parse(request.params.record);
    await accountClient(response.locals.account).call(
      `/zones/${response.locals.zoneId}/dns_records/${record}`,
      { method: "DELETE" },
    );
    store.audit(
      "删除 DNS 记录",
      response.locals.account.name,
      `${response.locals.zoneName} / ${record}`,
    );
    response.json({ ok: true });
  });
  router.post("/zones/:zone/batch", async (request, response) => {
    const input = z
      .object({
        deletes: z
          .array(z.object({ id: cfId }))
          .max(200)
          .optional(),
        patches: z
          .array(z.object({ id: cfId, proxied: z.boolean() }))
          .max(200)
          .optional(),
        posts: z.array(dnsSchema).max(200).optional(),
      })
      .parse(request.body);
    const count =
      (input.deletes?.length ?? 0) +
      (input.patches?.length ?? 0) +
      (input.posts?.length ?? 0);
    if (count < 1 || count > 200)
      throw new ApiError(400, "每批操作 1–200 条记录");
    const { result } = await accountClient(response.locals.account).call(
      `/zones/${response.locals.zoneId}/dns_records/batch`,
      { method: "POST", body: input },
    );
    store.audit(
      "批量修改 DNS",
      response.locals.account.name,
      response.locals.zoneName,
      "success",
      `${count} 条记录`,
    );
    response.json(result);
  });
  return router;
}
