import type http from "node:http";

export function actionRequestError(req: http.IncomingMessage) {
  if (req.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json") return { status: 415, error: "Actions require application/json" };
  if (req.headers.origin) {
    try {
      const origin = new URL(req.headers.origin);
      if (!/^https?:$/.test(origin.protocol) || origin.host !== req.headers.host) return { status: 403, error: "Cross-origin actions are not allowed" };
    } catch { return { status: 403, error: "Invalid request origin" }; }
  }
  if (req.headers["sec-fetch-site"] === "cross-site") return { status: 403, error: "Cross-site actions are not allowed" };
  return null;
}

const inlineTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/avif", "image/svg+xml", "audio/mpeg", "audio/wav", "audio/ogg", "video/mp4", "video/webm"]);
export function acceptedEncodings(header = "") {
  return header.split(",").map((part) => {
    const [encoding, ...parameters] = part.trim().split(";");
    const q = parameters.find((item) => item.trim().startsWith("q="));
    return { encoding: encoding.trim(), quality: q ? Number(q.trim().slice(2)) : 1 };
  }).filter((item) => ["br", "gzip"].includes(item.encoding) && item.quality > 0 && item.quality <= 1)
    .sort((a, b) => b.quality - a.quality || Number(b.encoding === "br") - Number(a.encoding === "br")).map((item) => item.encoding);
}
export function fileHeaders(file: { mime: string; name: string; size: number }, inline: boolean) {
  const mime = inlineTypes.has(file.mime.toLowerCase()) ? file.mime.toLowerCase() : "application/octet-stream";
  return {
    "Content-Type": mime, "Content-Length": file.size,
    "Content-Disposition": `${inline && mime !== "application/octet-stream" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
}
