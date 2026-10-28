/**
 * Haptic feedback. Android: navigator.vibrate patterns.
 * iOS Safari has no vibrate API, but toggling a native switch plays the system tick (iOS 18+):
 * one fixed intensity, and only inside a user gesture (tap, pointerup), so it is best effort.
 */

export type HapticKind = "tick" | "light" | "medium" | "heavy" | "legendary";

const PATTERNS: Record<HapticKind, number | number[]> = {
  tick: 6,
  light: 12,
  medium: 22,
  heavy: [18, 40, 28],
  legendary: [30, 50, 30, 50, 90],
};

let iosSwitch: HTMLLabelElement | null = null;

function isIos(): boolean {
  // iPadOS reports itself as a Mac: tell them apart with touch support.
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
}

function iosTick(): void {
  if (!iosSwitch) {
    const label = document.createElement("label");
    label.setAttribute("aria-hidden", "true");
    label.style.cssText = "position:fixed;left:-100px;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    input.tabIndex = -1;
    label.appendChild(input);
    document.body.appendChild(label);
    iosSwitch = label;
  }
  iosSwitch.click();
}

export function haptic(kind: HapticKind): void {
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate === "function") {
    navigator.vibrate(PATTERNS[kind]);
    return;
  }
  // The iOS tick has a single strength: keep it for meaningful moments, not the tear ticks.
  if (kind !== "tick" && isIos()) iosTick();
}
