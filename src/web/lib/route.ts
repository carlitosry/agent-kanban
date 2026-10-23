/** Board id from the URL: `#/<board-id>` (preferred) or `?board=<id>`. */
export function boardFromLocation(search: string, hash: string): string | null {
  const h = /^#\/?([^/?#]+)/.exec(hash);
  if (h?.[1]) return safeDecode(h[1]);
  const q = new URLSearchParams(search).get("board");
  return q ? q : null;
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

export function hashForBoard(id: string): string {
  return `#/${encodeURIComponent(id)}`;
}
