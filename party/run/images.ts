// Charts from a run: the API returns files written to $OUTPUT_DIR (and each plt.show() figure) as
// files: [{ name, content_base64, ... }] (docs/run-code "Output files"). PNG and SVG become data: URLs the
// output panel shows as <img>, which never runs an SVG's scripts.
// shortcut: 4 images / 600 KB of base64 per run, because the whole room doc is one storage value and one websocket
// message (1 MiB) for each newcomer; store images outside the doc (R2) if bigger charts are needed.
export const MAX_IMAGES = 4;
export const MAX_IMAGE_CHARS = 600_000;

const TYPES: Record<string, string> = { png: "image/png", svg: "image/svg+xml" };
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export type RunImage = { name: string; src: string };

export function runImages(files: unknown): { images: RunImage[]; skipped: number } {
  const images: RunImage[] = [];
  let skipped = 0, chars = 0;
  for (const f of Array.isArray(files) ? files : []) {
    const name = typeof f?.name === "string" ? f.name : "";
    const data = typeof f?.content_base64 === "string" ? f.content_base64 : "";
    const type = TYPES[name.split(".").pop()?.toLowerCase() ?? ""];
    if (!type || !data || !BASE64.test(data)) continue; // csv, json, txt: not a chart
    if (images.length >= MAX_IMAGES || chars + data.length > MAX_IMAGE_CHARS) { skipped++; continue; }
    chars += data.length;
    images.push({ name: name.slice(0, 100), src: `data:${type};base64,${data}` });
  }
  return { images, skipped };
}
