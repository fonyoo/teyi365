import type { ImageHostProvider, ImageUploadResponse } from "./types";

export const imageHostProviders: ImageHostProvider[] = ["r2"];
export const imageHostLabels: Record<ImageHostProvider, string> = {
  r2: "R2 存储"
};

const webpMaxDimension = 2560; // 浏览器端缩放的最大输出宽高
const webpQuality = 0.86;     // WebP 质量

export interface PreparedImage {
  file: File;
  convertedToWebp: boolean;
}

/** 将粘贴的静态图片转为有界 WebP，同时保留 GIF 动画。 */
export async function prepareImageForUpload(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.type === "image/webp") {
    return { file, convertedToWebp: false };
  }

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, webpMaxDimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return { file, convertedToWebp: false };
    }

    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await canvasToBlob(canvas, "image/webp", webpQuality);
    if (!blob) {
      return { file, convertedToWebp: false };
    }

    const baseName = file.name.replace(/\.[^.]+$/, "") || "pasted-image";
    return {
      file: new File([blob], `${baseName}.webp`, { type: "image/webp" }),
      convertedToWebp: true
    };
  } catch {
    return { file, convertedToWebp: false };
  }
}

/** 上传图片到自己的 R2 接口。 */
export async function uploadImageWithFallback(file: File): Promise<ImageUploadResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch("/api/upload", {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`上传失败：${res.status}`);
  }

  const data = await res.json() as { url: string };
  return { url: data.url, provider: "r2" };
}

/** 始终返回 R2，仅用于兼容旧测试或调用处。 */
export function orderedImageHostProviders(
  _failures: Partial<Record<ImageHostProvider, number>>,
  _now: number
): ImageHostProvider[] {
  return ["r2"];
}

/** 构建可替换临时上传占位符的 Markdown 图片语法。 */
export function markdownImage(url: string, alt = "图片") {
  return `![${alt}](${url})`;
}

/** 将基于回调的 canvas 编码器包装为 Promise。 */
function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}
