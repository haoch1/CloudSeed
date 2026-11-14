import { useMemo, useState } from "react";
import { CopyIcon, FileTextIcon, TableIcon } from "@phosphor-icons/react";
import { Highlight } from "prism-react-renderer";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Papa from "papaparse";
import { Button, useAction } from "../../ui";

const languageByExtension: Record<string, string> = {
  js: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  json: "json",
  css: "css",
  html: "markup",
  xml: "markup",
  yml: "yaml",
  yaml: "yaml",
  md: "markdown",
  markdown: "markdown",
  py: "python",
  go: "go",
  rs: "rust",
  sql: "sql",
  c: "c",
  cpp: "cpp",
  h: "c",
  swift: "swift",
  kt: "kotlin",
};
const emptyTheme = { plain: {}, styles: [] };
const maxHighlightedCharacters = 200_000;
const maxHighlightedLines = 4_000;
const maxTableRows = 200;
const maxTableColumns = 50;

function CodeView({ text, extension }: { text: string; extension: string }) {
  if (
    text.length > maxHighlightedCharacters ||
    text.split("\n", maxHighlightedLines + 1).length > maxHighlightedLines
  ) {
    return (
      <pre className="preview-plain">
        <code>{text}</code>
      </pre>
    );
  }
  return (
    <Highlight
      code={text}
      language={languageByExtension[extension] || "plaintext"}
      theme={emptyTheme}
    >
      {({ tokens, getLineProps, getTokenProps }) => (
        <pre className={`preview-code ${languageByExtension[extension] ? "" : "is-plain"}`}>
          <code>
            {tokens.map((line, index) => (
              <span {...getLineProps({ line })} className="preview-code-line" key={index}>
                <span className="preview-line-number" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="preview-line-content">
                  {line.map((token, tokenIndex) => (
                    <span {...getTokenProps({ token })} key={tokenIndex} />
                  ))}
                </span>
              </span>
            ))}
          </code>
        </pre>
      )}
    </Highlight>
  );
}

function CsvView({ text, extension }: { text: string; extension: string }) {
  const parsed = useMemo(
    () =>
      Papa.parse<string[]>(text, {
        delimiter: extension === "tsv" ? "\t" : ",",
        preview: maxTableRows + 1,
      }),
    [text, extension],
  );
  const rows = parsed.data.slice(0, maxTableRows);
  const truncated =
    parsed.meta.truncated ||
    parsed.data.length > maxTableRows ||
    rows.some((row) => row.length > maxTableColumns);
  return (
    <>
      {truncated && (
        <p className="preview-notice">
          表格仅显示前 200 行、前 50 列；可切换到源码查看完整内容。
        </p>
      )}
      <div className="preview-table-scroll">
        <table className="preview-data-table">
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <th scope="row">{rowIndex + 1}</th>
                {row.slice(0, maxTableColumns).map((cell, cellIndex) => (
                  <td key={cellIndex} title={cell}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function TextPreview({
  text,
  extension,
}: {
  text: string;
  extension: string;
}) {
  const isMarkdown = extension === "md" || extension === "markdown";
  const isCsv = extension === "csv" || extension === "tsv";
  const largeMarkdown = isMarkdown && text.length > maxHighlightedCharacters;
  const [source, setSource] = useState((!isMarkdown && !isCsv) || largeMarkdown);
  const { pending, run } = useAction();
  const typeLabel = isMarkdown
    ? "Markdown"
    : extension
      ? extension.toUpperCase()
      : "文本";
  return (
    <div className="preview-frame">
      <div className="preview-toolbar">
        <div className="preview-toolbar-title">
          {isCsv ? <TableIcon size={18} /> : <FileTextIcon size={18} />}
          <span>{typeLabel}</span>
        </div>
        <div className="preview-toolbar-actions">
          {(isMarkdown || isCsv) && !largeMarkdown && (
            <div className="preview-view-switch" role="group" aria-label="预览方式">
              <button type="button" aria-pressed={!source} onClick={() => setSource(false)}>
                {isCsv ? "表格" : "预览"}
              </button>
              <button type="button" aria-pressed={source} onClick={() => setSource(true)}>
                源码
              </button>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() =>
              run(async () => {
                await navigator.clipboard.writeText(text);
              }, "内容已复制")
            }
          >
            <CopyIcon size={16} />
            复制内容
          </Button>
        </div>
      </div>
      {largeMarkdown && (
        <p className="preview-notice">文件较大，已显示源码以保证流畅。</p>
      )}
      {source ? (
        <div className="preview-code-scroll">
          <CodeView text={text} extension={extension} />
        </div>
      ) : isCsv ? (
        <CsvView text={text} extension={extension} />
      ) : (
        <div className="preview-markdown">
          <Markdown
            remarkPlugins={[remarkGfm]}
            skipHtml
            components={{
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noreferrer noopener">
                  {children}
                </a>
              ),
              img: ({ src, alt }) =>
                src && /^https?:\/\//i.test(src) ? (
                  <a href={src} target="_blank" rel="noreferrer noopener">
                    图片：{alt || src}
                  </a>
                ) : (
                  <span>图片：{alt || src || "未命名"}</span>
                ),
            }}
          >
            {text}
          </Markdown>
        </div>
      )}
    </div>
  );
}
