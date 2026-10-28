/**
 * The Wrapped summary as a shareable 1080×1350 PNG, drawn on a canvas (text only: covers come from
 * another origin and would taint the canvas).
 */

export interface WrappedCard {
  title: string;
  year: number;
  lines: { label: string; value: string }[];
  footer: string;
}

const WIDTH = 1080;
const HEIGHT = 1350;
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > max) cut = cut.slice(0, -1);
  return `${cut}…`;
}

export function drawWrappedCard(card: WrappedCard): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d")!;

  const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  bg.addColorStop(0, "#0b1530");
  bg.addColorStop(0.55, "#1c3f8f");
  bg.addColorStop(1, "#d9542a");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const x = 96;
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = `600 40px ${FONT}`;
  ctx.fillText(fit(ctx, card.title, WIDTH - 2 * x), x, 150);
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 200px ${FONT}`;
  ctx.fillText(String(card.year), x - 8, 360);

  let y = 500;
  for (const line of card.lines) {
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = `500 34px ${FONT}`;
    ctx.fillText(fit(ctx, line.label, WIDTH - 2 * x), x, y);
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 60px ${FONT}`;
    ctx.fillText(fit(ctx, line.value, WIDTH - 2 * x), x, y + 70);
    y += 140;
    if (y > HEIGHT - 160) break;
  }

  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = `500 32px ${FONT}`;
  ctx.fillText(card.footer, x, HEIGHT - 80);
  return canvas;
}

/** Shares the image when the device can (phones), otherwise downloads it. */
export async function shareWrappedCard(card: WrappedCard): Promise<"shared" | "downloaded"> {
  const canvas = drawWrappedCard(card);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Image impossible à créer");
  const file = new File([blob], `anisync-wrapped-${card.year}.png`, { type: "image/png" });
  if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `${card.title} ${card.year}` });
      return "shared";
    } catch (error) {
      if ((error as Error).name === "AbortError") return "shared";
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return "downloaded";
}
