/**
 * Contrast-safe accent colours derived from AniList's coverImage.color.
 * Pure functions, unit-tested in tests/color.test.ts.
 */

type Rgb = [number, number, number];

export function parseHex(hex: string | null | undefined): Rgb | null {
  if (!hex) return null;
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) return null;
  const value = match[1].length === 3 ? [...match[1]].map((c) => c + c).join("") : match[1];
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16)) as Rgb;
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function luminance([r, g, b]: Rgb): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function mix([r, g, b]: Rgb, [r2, g2, b2]: Rgb, t: number): Rgb {
  return [Math.round(r + (r2 - r) * t), Math.round(g + (g2 - g) * t), Math.round(b + (b2 - b) * t)];
}

function toCss([r, g, b]: Rgb): string {
  return `rgb(${r} ${g} ${b})`;
}

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

/** Lightens colours that would disappear on a dark background, darkens those too pale for a light one. */
export function accentColors(hex: string | null | undefined): { dark: string; light: string } | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;

  let dark = rgb;
  for (let t = 0.1; luminance(dark) < 0.18 && t <= 1; t += 0.1) dark = mix(rgb, WHITE, t);

  let light = rgb;
  for (let t = 0.1; luminance(light) > 0.4 && t <= 1; t += 0.1) light = mix(rgb, BLACK, t);

  return { dark: toCss(dark), light: toCss(light) };
}

/** Inline style setting the accent CSS variables consumed by `.entry-accent`. */
export function accentStyle(hex: string | null | undefined): Record<string, string> {
  const colors = accentColors(hex);
  if (!colors) return {};
  return { "--entry-accent-dark": colors.dark, "--entry-accent-light": colors.light };
}
