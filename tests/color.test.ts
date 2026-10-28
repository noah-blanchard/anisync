import { describe, expect, it } from "vitest";
import { accentColors, accentStyle, luminance, parseHex } from "@/lib/color";

function parseRgb(css: string): [number, number, number] {
  const [r, g, b] = css.match(/\d+/g)!.map(Number);
  return [r!, g!, b!];
}

describe("accent colours", () => {
  it("parses 3 and 6 digit hex", () => {
    expect(parseHex("#fff")).toEqual([255, 255, 255]);
    expect(parseHex("#e4a15d")).toEqual([228, 161, 93]);
    expect(parseHex("nope")).toBeNull();
    expect(parseHex(null)).toBeNull();
  });

  it("returns null without a colour (falls back to the theme primary)", () => {
    expect(accentColors(undefined)).toBeNull();
    expect(accentStyle(null)).toEqual({});
  });

  it("lightens very dark colours for the dark theme", () => {
    const colors = accentColors("#1a0d35")!;
    expect(luminance(parseRgb(colors.dark))).toBeGreaterThanOrEqual(0.18);
  });

  it("darkens very pale colours for the light theme", () => {
    const colors = accentColors("#f1f1e4")!;
    expect(luminance(parseRgb(colors.light))).toBeLessThanOrEqual(0.4);
  });

  it("keeps mid-tone colours untouched", () => {
    expect(accentColors("#e4a15d")?.dark).toBe("rgb(228 161 93)");
  });
});
