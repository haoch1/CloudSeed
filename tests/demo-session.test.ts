import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadDemoSession,
  resetDemoSession,
  saveDemoSession,
} from "../src/demo-session.js";

test("演示登录有效期在页面刷新后保持，重置后恢复默认", () => {
  const values = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  try {
    const initial = loadDemoSession();
    assert.equal(initial.durationSeconds, 30 * 24 * 60 * 60);
    assert.deepEqual(loadDemoSession(), initial);

    const saved = saveDemoSession(7 * 24 * 60 * 60);
    assert.deepEqual(loadDemoSession(), saved);

    resetDemoSession();
    assert.equal(loadDemoSession().durationSeconds, 30 * 24 * 60 * 60);
    values.set("cloudseed-demo-session", "invalid");
    assert.equal(loadDemoSession().durationSeconds, 30 * 24 * 60 * 60);
  } finally {
    if (previous) Object.defineProperty(globalThis, "sessionStorage", previous);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
  }
});
