import pc from "picocolors";
import type { FitResult, Hardware, Placement } from "./types.js";
import { bar, box, padEnd, padStart, stackedBar, termWidth, vlen, wrap } from "./ui.js";

// ---------------------------------------------------------------------------
// The renderer. It turns plain data (FitResult / Hardware) into the styled
// terminal "UI". Layout adapts to terminal width: wide = single-line rows,
// narrow = stacked cards.
// ---------------------------------------------------------------------------

const W = () => termWidth();

// Mode label + color per placement (the mockup's blue/green/yellow "Mode").
function modeLabel(p: Placement): string {
  switch (p) {
    case "full-gpu":
      return pc.green("FULL GPU");
    case "hybrid":
      return pc.yellow("HYBRID");
    case "cpu":
      return pc.blue("CPU");
    default:
      return pc.red("CANNOT RUN");
  }
}

// ── Header / logo ───────────────────────────────────────────────────────────
export function renderHeader(subtitle: string, elapsedMs?: number): string {
  const logo = pc.green(pc.bold("[MF]"));
  const title = pc.green(pc.bold("Model Fit Advisor")) + pc.dim("  v0.1.3");
  const status =
    elapsedMs != null
      ? pc.dim(`${subtitle} · ${(elapsedMs / 1000).toFixed(1)}s`)
      : pc.dim(subtitle);
  return (
    "\n" +
    `  ${logo}  ${title}\n` +
    `       ${status}\n` +
    "  " +
    pc.green("─".repeat(W() - 2))
  );
}

// ── Detected system (two-column) ────────────────────────────────────────────
function osLabel(platform: string): string {
  if (platform === "win32") return "Windows";
  if (platform === "darwin") return "macOS";
  if (platform === "linux") return "Linux";
  return platform;
}

// ── Boxed hardware panel (used by `detect` — specs only, no models) ─────────
export function renderHardware(hw: Hardware): string {
  const k = (s: string) => pc.dim(padEnd(s, 9));
  const lines: string[] = [];
  lines.push(k("CPU") + pc.white(hw.cpuBrand));
  lines.push(k("") + pc.dim(`${hw.cpuCores} threads · ${hw.cpuPhysicalCores} cores`));
  lines.push(k("RAM") + pc.white(`${hw.ramGb} GB`) + pc.dim(`  ·  ${hw.usableRamGb} GB usable`));
  if (hw.gpus.length === 0) {
    lines.push(k("GPU") + pc.dim("none detected"));
  } else {
    for (const g of hw.gpus) {
      const tag = g.dedicated ? pc.green("dedicated") : pc.dim("integrated");
      const star = g === hw.primaryGpu ? pc.yellow("★ ") : "  ";
      lines.push(k("GPU") + star + pc.white(g.name) + pc.dim(`  ${g.vramGb}GB `) + tag);
    }
  }
  lines.push(pc.dim("─".repeat(50)));
  if (hw.primaryGpu) {
    const mem = hw.unifiedMemory ? "unified" : "VRAM";
    lines.push(
      k("TARGET") +
        pc.bold(pc.green(hw.primaryGpu.name)) +
        pc.dim(`  ${hw.usableVramGb}GB ${mem} · ~${hw.primaryGpu.bandwidthGbs} GB/s`),
    );
  } else {
    lines.push(k("TARGET") + pc.bold(pc.blue("CPU")) + pc.dim("  no dedicated GPU"));
  }
  for (const n of hw.detectionNotes) lines.push(pc.dim("ⓘ " + n));
  return box(lines, { title: "HARDWARE", width: 56, color: pc.cyan });
}

export function renderSystem(hw: Hardware): string {
  const label = (s: string) => pc.green(padEnd(s + ":", 5));
  const gpu = hw.primaryGpu
    ? `${hw.primaryGpu.name} (${hw.unifiedMemory ? `${hw.usableVramGb} GB unified` : `${hw.primaryGpu.vramGb} GB VRAM`})`
    : "none (CPU inference)";
  const cpu = `${hw.cpuBrand} (${hw.cpuPhysicalCores} cores / ${hw.cpuCores} threads)`;

  // left column padded to a fixed width, right column follows.
  const COL = Math.min(58, W() - 22);
  const row = (l: string, lv: string, r: string, rv: string) =>
    "  " + padEnd(`${label(l)} ${pc.white(lv)}`, COL) + `${label(r)} ${pc.white(rv)}`;

  const lines = [
    pc.bold("  Detected system"),
    row("GPU", gpu, "RAM", `${hw.ramGb} GB`),
    row("CPU", cpu, "OS", osLabel(hw.platform)),
  ];
  for (const n of hw.detectionNotes) lines.push(pc.dim("    ⓘ " + n));
  return lines.join("\n");
}

// ── Column layout helper: aligned label row + value row ─────────────────────
interface Col {
  label: string;
  value: string;
  width: number;
}
function columns(cols: Col[]): { labels: string; values: string; offsetOf: (i: number) => number } {
  let labels = "";
  let values = "";
  const offsets: number[] = [];
  let cursor = 0;
  for (const c of cols) {
    offsets.push(cursor);
    labels += padEnd(pc.dim(c.label), c.width);
    values += padEnd(c.value, c.width);
    cursor += c.width;
  }
  return { labels, values, offsetOf: (i) => offsets[i] };
}

// ── BEST PICK box ───────────────────────────────────────────────────────────
export function renderBestPick(r: FitResult, hw: Hardware, ctx: number): string {
  const memCap = hw.usableVramGb || hw.usableRamGb;
  const memUnit = hw.usableVramGb ? "VRAM" : "RAM";
  const fitPct = Math.round((r.totalGb / memCap) * 100);

  const cols: Col[] = [
    { label: "Runtime", value: modeLabel(r.placement), width: 13 },
    { label: memUnit, value: pc.white(`${r.totalGb} / ${memCap} GB`), width: 17 },
    { label: "Context", value: pc.white(ctx.toLocaleString()), width: 11 },
    { label: "Speed", value: pc.white(`~${r.tokPerSec} tok/s`), width: 13 },
    { label: "Quality", value: tierVal(r.scoreBreakdown.quality), width: 11 },
  ];
  const { labels, values, offsetOf } = columns(cols);
  const barColor = fitPct > 90 ? pc.yellow : pc.green;
  const barLine = " ".repeat(offsetOf(1)) + bar(r.totalGb / memCap, 12, barColor);

  const lines = [
    pc.yellow("★ ") + pc.bold(pc.green("BEST PICK: ")) + pc.bold(pc.white(r.model.name)),
    pc.dim("  Best balance of fit, speed, and quality for this machine."),
    "",
    "  " + labels,
    "  " + values,
    "  " + barLine,
  ];
  return box(lines, { width: W() - 6, color: pc.green });
}

// ── Recommended model rows (responsive) ─────────────────────────────────────
function dispName(name: string, max: number): string {
  return name.length > max ? name.slice(0, max - 1) + "…" : name;
}

function rowWide(r: FitResult, rank: number): string {
  const fit = r.scoreBreakdown.fit;
  // Fixed-width cells (visible widths) sized to fit comfortably, then the whole
  // line is padded to the box width so every row box is identical.
  const cells =
    pc.dim(padStart(String(rank), 2)) +
    "  " +
    pc.white(padEnd(dispName(r.model.name, 18), 18)) +
    "  " +
    pc.dim("Fit ") +
    padEnd(`${fit}%`, 4) +
    bar(fit / 100, 8) +
    "  " +
    pc.dim("Speed ") +
    padEnd(pc.white(`${r.tokPerSec} tok/s`), 13) +
    pc.dim("Quality ") +
    padEnd(tierVal(r.scoreBreakdown.quality), 9) +
    pc.dim("Mode ") +
    padEnd(modeLabel(r.placement), 11);
  return box([padEnd(cells, W() - 6)], { width: W() - 6, pad: 1 });
}

function rowStacked(r: FitResult, rank: number): string {
  const fit = r.scoreBreakdown.fit;
  const lines = [
    pc.dim(`${rank}  `) + pc.bold(pc.white(r.model.name)),
    "   " + pc.dim("Fit     ") + padEnd(`${fit}%`, 5) + bar(fit / 100, 10),
    "   " + pc.dim("Speed   ") + pc.white(`${r.tokPerSec} tok/s`),
    "   " + pc.dim("Quality ") + tierVal(r.scoreBreakdown.quality),
    "   " + pc.dim("Mode    ") + modeLabel(r.placement),
  ];
  return box(lines, { width: W() - 4, pad: 1 });
}

export function renderModels(results: FitResult[]): string {
  const wide = W() >= 98;
  const out = [pc.bold("  Recommended models"), ""];
  results.forEach((r, i) => out.push(wide ? rowWide(r, i + 1) : rowStacked(r, i + 1)));
  return out.join("\n");
}

// ── Best-per-category overview (beats llm-checker's category list) ──────────
export interface CategoryPick {
  label: string;
  result: FitResult | null;
}

export function renderByCategory(picks: CategoryPick[]): string {
  const rows = picks.map(({ label, result }) => {
    const left = pc.cyan(padEnd(label, 11));
    if (!result) return "  " + left + pc.dim("— nothing fits");
    const r = result;
    return (
      "  " +
      left +
      pc.white(padEnd(dispName(r.model.name, 22), 22)) +
      " " +
      bar(r.scoreBreakdown.fit / 100, 8) +
      "  " +
      padEnd(pc.white(`${r.tokPerSec} tok/s`), 12) +
      pc.dim("Q ") +
      padEnd(tierVal(r.scoreBreakdown.quality), 9) +
      modeLabel(r.placement)
    );
  });
  const lines = [pc.bold("Best model per category"), "", ...rows];
  return box(lines, { width: W() - 6, color: pc.cyan });
}

// ── Detailed single-model view (for `check`) ────────────────────────────────
export function renderDetail(r: FitResult, hw: Hardware, runtime: string): string {
  const speed = r.tokPerSec > 0 ? `~${r.tokPerSec} tok/s` : "—";
  const head =
    pc.bold(pc.white(r.model.name)) +
    "  " +
    modeLabel(r.placement) +
    pc.dim(`  · score ${r.score}/100 · ${speed}`);
  const lines = [head, budgetBar(r, hw), compositionBar(r)];
  lines.push(
    pc.dim("  fit ") +
      tierNum(r.scoreBreakdown.fit) +
      pc.dim("  speed ") +
      tierNum(r.scoreBreakdown.speed) +
      pc.dim("  quality ") +
      tierNum(r.scoreBreakdown.quality) +
      pc.dim(`   @ ${r.quant} · ctx ${r.ctx.toLocaleString()}`),
  );
  for (const n of r.notes) lines.push(pc.dim("  ⓘ " + n));
  const cmd = buildCommand(r, runtime);
  if (cmd) lines.push(pc.cyan("  $ " + cmd));
  return box(lines, { width: W() - 6, color: pc.cyan });
}

function budgetBar(r: FitResult, hw: Hardware): string {
  const Wb = 28;
  const vram = hw.usableVramGb;
  const ram = hw.usableRamGb;
  if (r.placement === "full-gpu") {
    const pct = Math.round((r.totalGb / vram) * 100);
    return pc.dim("VRAM ") + bar(r.totalGb / vram, Wb, pct > 90 ? pc.yellow : pc.green) + pc.dim(`  ${r.totalGb}/${vram} GB · ${pct}%`);
  }
  if (r.placement === "hybrid") {
    const cap = vram + ram;
    const spill = r.totalGb - vram;
    return (
      pc.dim("SPLIT ") +
      stackedBar([{ frac: vram / cap, color: pc.green }, { frac: spill / cap, color: pc.yellow }], Wb) +
      pc.dim(`  ${pc.green(`${vram}`)}+${pc.yellow(spill.toFixed(1))} GB`)
    );
  }
  if (r.placement === "cpu") {
    const pct = Math.round((r.totalGb / ram) * 100);
    return pc.dim("RAM  ") + bar(r.totalGb / ram, Wb, pc.blue) + pc.dim(`  ${r.totalGb}/${ram} GB · ${pct}%`);
  }
  return pc.dim("OVER ") + bar(1, Wb, pc.red) + pc.red(`  needs ${r.totalGb} GB > ${(vram + ram).toFixed(1)} GB`);
}

function compositionBar(r: FitResult): string {
  const Wb = 28;
  const t = r.totalGb || 1;
  return (
    pc.dim("MEM  ") +
    stackedBar(
      [
        { frac: r.weightsGb / t, color: pc.cyan },
        { frac: r.kvCacheGb / t, color: pc.magenta },
        { frac: r.overheadGb / t, color: pc.white },
      ],
      Wb,
    ) +
    pc.dim("  ") +
    pc.cyan(`w ${r.weightsGb}`) +
    pc.dim(" · ") +
    pc.magenta(`kv ${r.kvCacheGb}`) +
    pc.dim(" · ") +
    pc.white(`oh ${r.overheadGb}`)
  );
}

// ── Small helpers ───────────────────────────────────────────────────────────
function tierVal(n: number): string {
  const c = n >= 70 ? pc.green : n >= 40 ? pc.yellow : pc.red;
  return c(`${n} / 100`);
}
function tierNum(n: number): string {
  const c = n >= 70 ? pc.green : n >= 40 ? pc.yellow : pc.red;
  return c(String(n).padStart(2));
}

export function buildCommand(r: FitResult, runtime = "ollama"): string {
  if (runtime === "llama.cpp" || runtime === "llamacpp") {
    if (!r.model.hfRepo) return "";
    return `llama-cli -hf ${r.model.hfRepo}:${r.quant} -c ${r.ctx}`;
  }
  if (!r.model.ollamaTag) return "";
  return `ollama pull ${r.model.ollamaTag}`;
}

export function renderTip(text: string): string {
  return "  " + pc.yellow("Tip ") + pc.dim(text);
}

export function renderInstall(r: FitResult, runtime: string): string {
  const cmd = buildCommand(r, runtime);
  return cmd ? "  " + pc.dim("Install ") + pc.cyan(cmd) : "";
}

export function smartReason(r: FitResult, hw: Hardware, ctx: number): string {
  const where =
    r.placement === "full-gpu"
      ? `fits entirely in your ${hw.primaryGpu?.name ?? "GPU"} (${hw.usableVramGb}GB ${hw.unifiedMemory ? "unified" : "VRAM"})`
      : r.placement === "hybrid"
        ? "runs mostly on your GPU with some spill to system RAM"
        : `runs on your CPU + ${hw.usableRamGb}GB RAM`;
  const quality =
    ["F16", "Q8_0", "Q6_K", "Q5_K_M"].includes(r.quant) ? `at high-quality ${r.quant}` : `quantized to ${r.quant} so it fits`;
  const feel = r.tokPerSec >= 30 ? "comfortably fast" : r.tokPerSec >= 10 ? "usable speed" : "slow but workable";
  return `Strongest model that ${where} at ${ctx.toLocaleString()}-token context, ${quality} — ~${r.tokPerSec} tok/s (${feel}).`;
}
