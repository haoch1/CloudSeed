import { api, isDemoMode } from "./api";

interface UploadSession {
  id: string;
  url?: string;
  multipart: boolean;
  partSize: number;
  headers: Record<string, string>;
}
export interface UploadTask {
  id: string;
  file: File;
  key: string;
  progress: number;
  status: "queued" | "uploading" | "done" | "failed" | "cancelled";
  error?: string;
}

function put(
  url: string,
  blob: Blob,
  signal: AbortSignal,
  progress: (bytes: number) => void,
  headers: Record<string, string> = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    signal.addEventListener("abort", abort, { once: true });
    const clean = () => signal.removeEventListener("abort", abort);
    xhr.open("PUT", url);
    xhr.timeout = 15 * 60 * 1000;
    Object.entries(headers).forEach(([name, value]) =>
      xhr.setRequestHeader(name, value),
    );
    xhr.upload.onprogress = (event) => progress(event.loaded);
    xhr.onload = () => {
      clean();
      if (xhr.status >= 200 && xhr.status < 300)
        resolve(xhr.getResponseHeader("ETag") || "");
      else
        reject(
          new Error(
            xhr.status === 412
              ? "文件在上传期间被创建或修改，请重试"
              : `R2 上传失败 (${xhr.status})，请检查桶 CORS 和访问权限`,
          ),
        );
    };
    xhr.onerror = () => {
      clean();
      reject(new Error("无法连接 R2，请检查网络与桶 CORS 设置"));
    };
    xhr.ontimeout = () => {
      clean();
      reject(new Error("上传超时，请重试"));
    };
    xhr.onabort = () => {
      clean();
      reject(new DOMException("上传已取消", "AbortError"));
    };
    if (signal.aborted) {
      clean();
      reject(new DOMException("上传已取消", "AbortError"));
      return;
    }
    xhr.send(blob);
  });
}

function waitWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new DOMException("上传已取消", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("上传已取消", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

const multipartConcurrency = 3;

export async function uploadFile(
  base: string,
  file: File,
  key: string,
  overwrite: boolean,
  signal: AbortSignal,
  onProgress: (value: number) => void,
  request: typeof api = api,
): Promise<void> {
  if (isDemoMode()) {
    await request(`${base}/demo-upload`, {
      method: "POST",
      body: { file, key, overwrite },
      signal,
    });
    onProgress(100);
    return;
  }
  const session = await request<UploadSession>(`${base}/uploads`, {
    method: "POST",
    body: {
      key,
      size: file.size,
      contentType: file.type || "application/octet-stream",
      overwrite,
    },
    signal,
  });
  const uploadPath = `${base}/uploads/${session.id}`;
  const parts: { PartNumber: number; ETag: string }[] = [];
  try {
    if (!session.multipart) {
      try {
        await put(
          session.url!,
          file,
          signal,
          (bytes) =>
            onProgress(
              file.size ? Math.min(99, (bytes / file.size) * 100) : 99,
            ),
          session.headers,
        );
      } catch (error) {
        if (signal.aborted) throw error;
        // 响应丢失时，后端通过对象标识和大小核对实际上传结果
        await request(`${uploadPath}/complete`, {
          method: "POST",
          body: {},
        }).catch(() => {
          throw error;
        });
        onProgress(100);
        return;
      }
    } else {
      const totalParts = Math.ceil(file.size / session.partSize);
      const partLoaded = new Array<number>(totalParts).fill(0);
      const reportProgress = () => {
        const loaded = partLoaded.reduce((sum, bytes) => sum + bytes, 0);
        onProgress(Math.min(99, (loaded / file.size) * 100));
      };
      const multipartController = new AbortController();
      const onOuterAbort = () => multipartController.abort(signal.reason);
      if (signal.aborted) onOuterAbort();
      else signal.addEventListener("abort", onOuterAbort, { once: true });
      let nextPartIndex = 0;
      const uploadWorker = async () => {
        while (nextPartIndex < totalParts) {
          const partIndex = nextPartIndex++;
          const partNumber = partIndex + 1;
          const offset = partIndex * session.partSize;
          multipartController.signal.throwIfAborted();
          const blob = file.slice(
            offset,
            Math.min(file.size, offset + session.partSize),
          );
          let etag = "";
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const { url } = await request<{ url: string }>(
                `${uploadPath}/part`,
                {
                  method: "POST",
                  body: { partNumber },
                  signal: multipartController.signal,
                },
              );
              etag = await put(
                url,
                blob,
                multipartController.signal,
                (bytes) => {
                  partLoaded[partIndex] = bytes;
                  reportProgress();
                },
              );
              partLoaded[partIndex] = blob.size;
              reportProgress();
              break;
            } catch (error) {
              partLoaded[partIndex] = 0;
              reportProgress();
              if (multipartController.signal.aborted || attempt === 2) {
                multipartController.abort(error);
                throw error;
              }
              await waitWithAbort(
                500 * 3 ** attempt,
                multipartController.signal,
              );
            }
          }
          if (!etag) {
            const error = new Error(
              "R2 未返回 ETag，请在 CORS ExposeHeaders 中添加 ETag",
            );
            multipartController.abort(error);
            throw error;
          }
          parts.push({ PartNumber: partNumber, ETag: etag });
        }
      };
      try {
        await Promise.all(
          Array.from(
            { length: Math.min(multipartConcurrency, totalParts) },
            uploadWorker,
          ),
        );
      } finally {
        signal.removeEventListener("abort", onOuterAbort);
      }
      parts.sort((a, b) => a.PartNumber - b.PartNumber);
    }
    await request(`${uploadPath}/complete`, {
      method: "POST",
      body: { parts },
      signal,
    });
    onProgress(100);
  } catch (error) {
    await request(uploadPath, { method: "DELETE" }).catch(() => undefined);
    throw error;
  }
}
