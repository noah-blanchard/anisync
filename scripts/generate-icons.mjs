// Renders public/icons/icon.svg to every PNG the PWA needs: manifest icons (any,
// maskable, monochrome), favicon, apple-touch-icon and iOS startup screens.
// One-off tool; sharp is intentionally not a project dependency. Copy this file into a
// scratch folder where `npm i sharp` was run, then execute it from the repo root:
//   node /path/to/scratch/generate-icons.mjs
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const dir = path.join(process.cwd(), "public", "icons");
const splashDir = path.join(dir, "splash");
await mkdir(splashDir, { recursive: true });

const svg = await readFile(path.join(dir, "icon.svg"));
const BACKGROUND = "#0b0c10";
const TILE = "#12131a";

/** The mark alone (no rounded tile), as SVG, in the given colours. */
function markSvg({ arcA = "url(#a)", arcB = "#e8ecff" } = {}) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 10 44 44">
  <defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7cc8ff"/><stop offset="1" stop-color="#5b7cfa"/></linearGradient></defs>
  <path d="M18 38a14 14 0 0 1 24-14" fill="none" stroke="${arcA}" stroke-width="6" stroke-linecap="round"/>
  <path d="M46 26a14 14 0 0 1-24 14" fill="none" stroke="${arcB}" stroke-width="6" stroke-linecap="round"/>
  <path d="M40 17l3 7.5-7.6 1.6" fill="none" stroke="${arcA}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M24 47l-3-7.5 7.6-1.6" fill="none" stroke="${arcB}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`);
}

async function rasterize(source, size) {
  return sharp(source, { density: 1200 }).resize(size, size).png().toBuffer();
}

async function canvas(width, height, background, layers) {
  const base = sharp({ create: { width, height, channels: 4, background } });
  return base.composite(layers).png({ compressionLevel: 9 }).toBuffer();
}

async function write(file, buffer) {
  await writeFile(file, buffer);
  console.log("wrote", path.relative(process.cwd(), file));
}

const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

// Standard icons: the rounded tile itself.
for (const size of [32, 96, 192, 512]) {
  const name = size === 32 ? "favicon-32.png" : `icon-${size}.png`;
  await write(path.join(dir, name), await rasterize(svg, size));
}

// Apple touch icon: iOS rounds corners itself, so fill the whole square.
await write(
  path.join(dir, "apple-touch-icon.png"),
  await canvas(180, 180, TILE, [{ input: await rasterize(markSvg(), 120), gravity: "center" }]),
);

// Maskable: full-bleed tile, mark inside the 80% safe zone.
await write(
  path.join(dir, "maskable-512.png"),
  await canvas(512, 512, TILE, [{ input: await rasterize(markSvg(), 300), gravity: "center" }]),
);

// Monochrome (Android themed icons): white mark on transparent, alpha is what matters.
await write(
  path.join(dir, "monochrome-512.png"),
  await canvas(512, 512, transparent, [
    { input: await rasterize(markSvg({ arcA: "#ffffff", arcB: "#ffffff" }), 300), gravity: "center" },
  ]),
);

// iOS startup screens (portrait): [cssWidth, cssHeight, pixelRatio]
const DEVICES = [
  [440, 956, 3], // iPhone 16/17 Pro Max
  [402, 874, 3], // iPhone 16/17 Pro
  [430, 932, 3], // iPhone 14/15 Pro Max, 15/16 Plus
  [393, 852, 3], // iPhone 14/15 Pro, 15/16
  [390, 844, 3], // iPhone 12/13/14
  [375, 812, 3], // iPhone X/XS/11 Pro, 12/13 mini
  [414, 896, 3], // iPhone XS Max, 11 Pro Max
  [414, 896, 2], // iPhone XR, 11
  [414, 736, 3], // iPhone 6-8 Plus
  [375, 667, 2], // iPhone SE 2/3, 6-8
  [820, 1180, 2], // iPad Air / iPad 10
  [834, 1194, 2], // iPad Pro 11
  [1024, 1366, 2], // iPad Pro 12.9
];

const splashes = [];
for (const [w, h, ratio] of DEVICES) {
  const width = w * ratio;
  const height = h * ratio;
  const logo = Math.round(Math.min(width, height) * 0.26);
  const glow = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><radialGradient id="g" gradientUnits="userSpaceOnUse" cx="${width / 2}" cy="${height * 0.46}" r="${Math.min(width, height) * 0.55}">
      <stop offset="0" stop-color="#5b7cfa" stop-opacity="0.24"/>
      <stop offset="1" stop-color="#5b7cfa" stop-opacity="0"/>
    </radialGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
  </svg>`);
  const file = `${width}x${height}.png`;
  const buffer = await sharp({ create: { width, height, channels: 3, background: BACKGROUND } })
    .composite([
      { input: glow, top: 0, left: 0 },
      {
        input: await rasterize(svg, logo),
        top: Math.round(height * 0.46 - logo / 2),
        left: Math.round((width - logo) / 2),
      },
    ])
    .png({ compressionLevel: 9, palette: true, quality: 90 })
    .toBuffer();
  await write(path.join(splashDir, file), buffer);
  splashes.push({ url: `/icons/splash/${file}`, w, h, ratio });
}

// Emit the startup image list consumed by app/layout.tsx.
const media = splashes.map(
  ({ url, w, h, ratio }) =>
    `  { url: "${url}", media: "(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: portrait)" },`,
);
await writeFile(
  path.join(process.cwd(), "lib", "splash-screens.ts"),
  `// Generated by scripts/generate-icons.mjs. Do not edit by hand.\nexport const SPLASH_SCREENS = [\n${media.join("\n")}\n];\n`,
);
console.log("wrote lib/splash-screens.ts");
