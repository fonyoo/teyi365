export async function onRequestGet(context: any) {
  const { request, env } = context;
  const url = new URL(request.url);
  const key = url.pathname.replace("/images/", "");

  if (!key) return new Response("Not found", { status: 404 });

  const object = await env.BLOG_IMAGES.get(key);
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  headers.set("Content-Type", object.httpMetadata?.contentType || "application/octet-stream");
  headers.set("Cache-Control", "public, max-age=31536000, immutable");

  return new Response(object.body, { headers });
}
