import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TextPreview from "../src/pages/r2/TextPreview.js";

function renderPreview(text: string, extension: string) {
  return renderToStaticMarkup(createElement(TextPreview, { text, extension }));
}

test("代码预览高亮并安全显示文件内容", () => {
  const html = renderPreview("enabled: true\nmessage: '<script>alert(1)</script>'", "yaml");
  assert.match(html, /preview-code-line/);
  assert.match(html, /token/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("Markdown 预览不执行 HTML，也不自动加载外部图片", () => {
  const html = renderPreview("# 标题\n\n<script>alert(1)</script>\n\n![示例](https://example.com/a.png)", "md");
  assert.match(html, /<h1>标题<\/h1>/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /图片：示例/);
});

test("CSV 预览正确解析引号并限制表格尺寸", () => {
  const text = ["name,value", '"hello, world",42', ...Array.from({ length: 200 }, (_, index) => `row${index},1`)].join("\n");
  const html = renderPreview(text, "csv");
  assert.match(html, /hello, world/);
  assert.match(html, /表格仅显示前 200 行/);
  assert.doesNotMatch(html, />row199</);
});
