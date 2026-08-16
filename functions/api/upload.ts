import { getSession } from "../utils/auth"; // 假设项目有 session 工具函数，没有则自行实现鉴权

export async function onRequestPost(context: any) {
  const { request, env } = context;

  // 1. 管理员鉴权（复用现有 session 机制）
  const session = await getSession(request, env);
  if (!session || !session.isAdmin) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 2. 获取上传的文件
  const formData = await request.formData();
  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return new Response("No file uploaded", { status: 400 });
  }

  // 3. 生成唯一文件名
  const ext = file.name.split(".").pop() || "png";
  const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  // 4. 上传到 R2
  const arrayBuffer = await file.arrayBuffer();
  await env.BLOG_IMAGES.put(key, arrayBuffer, {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
  });

  // 5. 返回图片 URL（通过 Pages Functions 提供访问）
  const url = new URL(request.url);
  const imageUrl = `${url.origin}/images/${key}`;

  return new Response(JSON.stringify({ url: imageUrl }), {
    headers: { "Content-Type": "application/json" },
  });
}