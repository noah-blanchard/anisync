// Renders public/icons/icon.svg to the PNG sizes used by the manifest and iOS.
// One-off tool; sharp is intentionally not a project dependency. Copy this file into a
// scratch folder where `npm i sharp` was run, then execute it from the repo root:
//   node /path/to/scratch/generate-icons.mjs
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const dir = path.join(process.cwd(), "public", "icons");
const svg = await readFile(path.join(dir, "icon.svg"));
const background = "#12131a";

async function render(size, file, { padding = 0, flatten = false } = {}) {
  const inner = Math.round(size * (1 - padding * 2));
  const icon = await sharp(svg, { density: 1200 }).resize(inner, inner).png().toBuffer();
  let img = sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: icon, gravity: "center" }]);
  if (flatten) img = img.flatten({ background });
  await img.png().toFile(path.join(dir, file));
  console.log("wrote", file);
}

await render(192, "icon-192.png");
await render(512, "icon-512.png");
// Maskable: full-bleed background with the mark inside the 80% safe zone.
await render(512, "maskable-512.png", { padding: 0.1, flatten: true });
await render(180, "apple-touch-icon.png", { flatten: true });
