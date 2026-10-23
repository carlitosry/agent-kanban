import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".md": "text/markdown; charset=utf-8",
  ".map": "application/json",
};

export function mimeFor(file: string): string {
  return MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
}

export interface StaticFile {
  body: Buffer;
  type: string;
}

/** Resolves a URL path inside `root`; unknown non-asset paths fall back to index.html (SPA). */
export async function readStatic(root: string, urlPath: string): Promise<StaticFile | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const rel = normalize(decoded).replace(/^([/\\])+/, "");
  const target = join(root, rel === "" ? "index.html" : rel);
  if (target !== root && !target.startsWith(root + sep)) return null;
  const direct = await readFile(target).catch(() => null);
  if (direct) return { body: direct, type: mimeFor(target) };
  if (extname(rel) !== "") return null; // missing asset: real 404
  const index = await readFile(join(root, "index.html")).catch(() => null);
  return index ? { body: index, type: mimeFor("index.html") } : null;
}
