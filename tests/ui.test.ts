import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Input } from "../src/ui.js";

test("管理页输入框忽略密码管理器，登录字段允许自动填充", () => {
  const credential = renderToStaticMarkup(
    createElement(Input, { label: "API Token", type: "password" }),
  );
  assert.match(credential, /data-1p-ignore="true"/);

  const username = renderToStaticMarkup(
    createElement(Input, {
      label: "用户名",
      name: "username",
      autoComplete: "username",
      passwordManagerIgnore: false,
    }),
  );
  assert.doesNotMatch(username, /data-1p-ignore/);
  assert.match(username, /autocomplete="username"/i);

  const password = renderToStaticMarkup(
    createElement(Input, {
      label: "密码",
      type: "password",
      autoComplete: "current-password",
      passwordManagerIgnore: false,
    }),
  );
  assert.doesNotMatch(password, /data-1p-ignore/);
  assert.match(password, /autocomplete="current-password"/i);
});
