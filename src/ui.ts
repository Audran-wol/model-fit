import pc from "picocolors";

// ---------------------------------------------------------------------------
// Low-level terminal drawing helpers: ANSI-aware padding, bars, gauges, boxes.
// Everything else builds on these so alignment stays correct even though color
// codes add invisible characters to strings.
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const ANSI = /\[[0-9;]*m/g;

/** Visible length of a string, ignoring ANSI color codes. */
export function vlen(s: string): number {
  return s.replace(ANSI, "").length;
}

export function padEnd(s: string, n: number): string {
  return s + " ".repeat(Math.max(0, n - vlen(s)));
}

export function padStart(s: string, n: string | number): string {
  const w = typeof n === "string" ? parseInt(n, 10) : n;
  return " ".repeat(Math.max(0, w - vlen(s))) + s;
}

/** Truncate to a visible width, adding an ellipsis if needed (ANSI-unsafe input). */
export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 1)) + "…";
}

const FULL = "█";
const EMPTY = "░";

/** A simple single-color progress bar. fraction is clamped to [0,1]. */
export function bar(fraction: number, width: number, color: (s: string) => string = pc.green): string {
  const f = Math.max(0, Math.min(1, fraction));
  const filled = Math.round(f * width);
  return color(FULL.repeat(filled)) + pc.dim(EMPTY.repeat(width - filled));
}

export interface Segment {
  frac: number;
  color: (s: string) => string;
}

/** A stacked, multi-color bar. Segments are drawn left to right; the leftover
 *  space is dimmed empty. Widths are rounded so the total stays exact. */
export function stackedBar(segments: Segment[], width: number): string {
  let used = 0;
  let out = "";
  for (const seg of segments) {
    const w = Math.round(Math.max(0, Math.min(1, seg.frac)) * width);
    const real = Math.min(w, width - used);
    out += seg.color(FULL.repeat(real));
    used += real;
  }
  out += pc.dim(EMPTY.repeat(Math.max(0, width - used)));
  return out;
}

/** A score gauge: ▕████░░░░▏ colored by tier. */
export function gauge(score: number, width = 12): string {
  const color = score >= 70 ? pc.green : score >= 40 ? pc.yellow : score >= 1 ? pc.red : pc.dim;
  return pc.dim("▕") + bar(score / 100, width, color) + pc.dim("▏");
}

export interface BoxOptions {
  title?: string;
  width?: number;
  color?: (s: string) => string;
  pad?: number;
}

/** Draw a rounded box around content lines (which may contain ANSI codes). */
export function box(lines: string[], opts: BoxOptions = {}): string {
  const border = opts.color ?? pc.dim;
  const pad = opts.pad ?? 1;
  const contentWidth = Math.max(
    opts.width ?? 0,
    opts.title ? vlen(opts.title) + 4 : 0,
    ...lines.map(vlen),
  );
  const inner = contentWidth + pad * 2;

  const top = opts.title
    ? border("╭─ ") + pc.bold(opts.title) + border(" " + "─".repeat(Math.max(0, inner - vlen(opts.title) - 3)) + "╮")
    : border("╭" + "─".repeat(inner) + "╮");
  const bottom = border("╰" + "─".repeat(inner) + "╯");

  const body = lines.map((l) => {
    const cell = " ".repeat(pad) + padEnd(l, contentWidth) + " ".repeat(pad);
    return border("│") + cell + border("│");
  });

  return [top, ...body, bottom].join("\n");
}

/** A full-width divider rule. */
export function rule(width = 64): string {
  return pc.dim("─".repeat(width));
}

/** Current usable terminal width, clamped so layouts stay sane when piped or
 *  resized. This is what makes the output responsive. */
export function termWidth(min = 64, max = 104): number {
  const env = process.env.COLUMNS ? parseInt(process.env.COLUMNS, 10) : 0;
  const cols = process.stdout.columns || env || 100;
  return Math.max(min, Math.min(max, cols - 2));
}

/** Word-wrap plain text to a visible width (input must be uncolored). */
export function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && vlen(cur) + 1 + vlen(w) > width) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}
