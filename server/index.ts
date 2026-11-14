import { Store } from "./store.js";
import { createApp } from "./app.js";
import { existsSync } from "node:fs";
import { bootstrapAdmin } from "./auth.js";

process.title = "cloudseed";
if (existsSync(".env")) process.loadEnvFile(".env");
const store = new Store(process.env.DATA_DIR || "data");
const initialAdmin = bootstrapAdmin(
  store,
  process.env.CLOUDSEED_ADMIN_USERNAME || "admin",
  process.env.CLOUDSEED_ADMIN_PASSWORD || store.setupToken,
);
const port = Number(process.env.PORT || 3180);
const host = process.env.HOST || "127.0.0.1";
const server = createApp(store).listen(port, host, () => {
  console.log(`cloudseed 已启动 http://${host}:${port}`);
  if (initialAdmin) {
    console.log(`初始用户名 ${initialAdmin.username}`);
    console.log(`初始密码 ${initialAdmin.password}`);
  }
});

for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    server.close(() => {
      store.db.close();
      process.exit(0);
    });
  });
