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
      for (
        let offset = 0, partNumber = 1;
        offset < file.size;
        offset += session.partSize, partNumber++
      ) {
        signal.throwIfAborted();
        const blob = file.slice(
          offset,
          Math.min(file.size, offset + session.partSize),
        );
        let etag = "";
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const { url } = await request<{ url: string }>(
              `${uploadPath}/part`,
              { method: "POST", body: { partNumber }, signal },
            );
            etag = await put(url, blob, signal, (bytes) =>
              onProgress(Math.min(99, ((offset + bytes) / file.size) * 100)),
            );
            break;
          } catch (error) {
            if (signal.aborted || attempt === 2) throw error;
          }
        }
        if (!etag)
          throw new Error(
            "R2 未返回 ETag，请在 CORS ExposeHeaders 中添加 ETag",
          );
        parts.push({ PartNumber: partNumber, ETag: etag });
      }
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
