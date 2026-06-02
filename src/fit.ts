import type { FitResult, Hardware, Model, Placement, Quant } from "./types.js";

// ---------------------------------------------------------------------------
// The fit engine. This is the part that makes llm-fit better than a static
// "score": every number below is derived from your hardware + the model, and
// we can explain where it came from.
// ---------------------------------------------------------------------------

// Effective bytes-per-weight for each quantization (bits/8). These are the
// real-world averages llama.cpp produces, not the nominal bit count.
const BYTES_PER_WEIGHT: Record<Quant, number> = {
  Q2_K: 0.33,
  Q3_K_M: 0.43,
  Q4_K_M: 0.56,
  Q5_K_M: 0.69,
  Q6_K: 0.81,
  Q8_0: 1.06,
  F16: 2.0,
};

/** Model weights in GB = params (billions) × bytes-per-weight. */
export function weightsGb(paramsB: number, quant: Quant): number {
  return paramsB * BYTES_PER_WEIGHT[quant];
}

// When a model's attention architecture is unknown, assume modern GQA. Almost
// every current GGUF model uses grouped-query attention with ~4–8 groups; the
// old multi-head assumption (factor 1) overstated KV by 4–8× and produced false
// "won't run" verdicts for popular models like Llama 3 and Qwen2.5.
export const DEFAULT_GQA = 4;

/**
 * KV cache in GB. Holds attention state for every token in the context window,
 * so it grows with context length and model size — and SHRINKS with the GQA
 * factor (fewer KV heads = less cache). The base (gqaFactor=1, multi-head) is
 * calibrated so Llama-2-7B @ 4k ≈ 2GB (fp16). Runtimes can quantize KV to halve.
 */
export function kvCacheGb(paramsB: number, ctx: number, gqaFactor = 1): number {
  return ((ctx / 1000) * 0.5 * (paramsB / 7)) / Math.max(1, gqaFactor);
}

/** Runtime/activation/compute buffers. Small but real; grows a little with ctx. */
function overheadGb(ctx: number): number {
  return 0.8 + (ctx / 1000) * 0.05;
}

const QUANT_ORDER: Quant[] = ["F16", "Q8_0", "Q6_K", "Q5_K_M", "Q4_K_M", "Q3_K_M", "Q2_K"];

/**
 * Pick the highest-quality quant that still runs well on this hardware. We try
 * from best to smallest and stop at the first that fits fully on GPU (or, if
 * nothing fits on GPU, the first that fits in RAM).
 */
export function pickBestQuant(model: Model, hw: Hardware, ctx: number): Quant {
  let cpuFallback: Quant | null = null;
  for (const q of QUANT_ORDER) {
    const r = computeFit(model, q, hw, ctx);
    if (r.placement === "full-gpu") return q;
    if (r.placement !== "wont-run" && cpuFallback === null) cpuFallback = q;
  }
  return cpuFallback ?? "Q4_K_M";
}

export function computeFit(
  model: Model,
  quant: Quant,
  hw: Hardware,
  ctx: number,
): FitResult {
  const cappedCtx = Math.min(ctx, model.maxCtx);
  // Prefer a real measured on-disk size (from Ollama/HF) over the estimate.
  const measuredSize = model.realSizeGb?.[quant];
  const w = measuredSize ?? weightsGb(model.paramsB, quant);
  // GQA-aware KV: use the model's real attention factor, or the modern default.
  const gqa = model.gqaFactor ?? DEFAULT_GQA;
  const kv = kvCacheGb(model.paramsB, cappedCtx, gqa);
  // Honest confidence: the weights estimate (params×bytes) is reliable, but an
  // unknown attention architecture means the KV cache is a guess. Flag that.
  const estimated = model.gqaFactor == null;
  const oh = overheadGb(cappedCtx);
  const total = w + kv + oh;

  const vram = hw.usableVramGb;
  const ram = hw.usableRamGb;

  // Where does it run?
  let placement: Placement;
  let onGpuGb: number;
  const notes: string[] = [];

  if (vram > 0 && total <= vram) {
    placement = "full-gpu";
    onGpuGb = total;
  } else if (vram > 0 && w < vram && total <= vram + ram) {
    // Some layers fit on the GPU, the rest spill to system RAM (hybrid offload).
    placement = "hybrid";
    onGpuGb = vram;
    notes.push("Partial GPU offload — slower than full-GPU, faster than CPU-only.");
  } else if (total <= ram) {
    placement = "cpu";
    onGpuGb = 0;
    notes.push("Runs on CPU/RAM only — expect modest speeds, especially at long context.");
  } else {
    placement = "wont-run";
    onGpuGb = 0;
    notes.push(`Needs ~${total.toFixed(1)}GB but only ~${(vram + ram).toFixed(1)}GB usable.`);
  }

  // ----- Speed estimate (tokens/sec) -----
  // Generation is memory-bandwidth bound: tok/s ≈ bandwidth / bytes-read-per-token.
  // Bytes read per token ≈ active weights (MoE reads only active experts).
  const activeW = model.activeParamsB
    ? weightsGb(model.activeParamsB, quant)
    : w;
  const gpuBw = hw.primaryGpu?.bandwidthGbs ?? 0;
  const cpuBw = 50; // typical dual-channel DDR4/5 system RAM
  let tokPerSec: number;
  if (placement === "full-gpu") {
    tokPerSec = gpuBw / activeW;
  } else if (placement === "hybrid") {
    // Weighted by how much sits on the fast GPU vs slow RAM.
    const gpuFrac = Math.max(0, Math.min(1, onGpuGb / total));
    const effBw = gpuBw * gpuFrac + cpuBw * (1 - gpuFrac);
    tokPerSec = effBw / activeW;
  } else if (placement === "cpu") {
    tokPerSec = cpuBw / activeW;
  } else {
    tokPerSec = 0;
  }
  tokPerSec = Math.round(tokPerSec * 10) / 10;

  // ----- Transparent score (0–100) -----
  // Philosophy: recommend the SMARTEST model that still runs comfortably.
  //   quality — the main driver: bigger params + decent quant ≈ smarter.
  //   speed   — a usability gate, not a race: ~15 tok/s reads fine, and
  //             300 tok/s is no better than 40, so we cap the reward.
  //   fit     — mild bonus for breathing room (won't OOM at longer prompts).
  // Placement then scales the whole thing: spilling to CPU is a real penalty.
  const headroom = vram > 0 ? (vram - total) / vram : (ram - total) / ram;
  const fit =
    placement === "wont-run" ? 0 : Math.round(Math.max(0, Math.min(1, 0.5 + headroom)) * 100);
  const speed = Math.round(Math.min(1, tokPerSec / 15) * 100); // 15 tok/s = comfortable

  // Quality: log-scaled params (diminishing returns past ~70B) × quant factor,
  // where Q4_K_M and up count as "full" quality and lower quants are penalized.
  const paramFactor = Math.min(1, Math.log10(model.paramsB + 1) / Math.log10(71));
  const quantFactor = Math.min(1, BYTES_PER_WEIGHT[quant] / BYTES_PER_WEIGHT.Q4_K_M);
  const quality = Math.round(paramFactor * quantFactor * 100);

  const PLACEMENT_FACTOR: Record<Placement, number> = {
    "full-gpu": 1,
    hybrid: 0.6,
    cpu: 0.35,
    "wont-run": 0,
  };
  const score = Math.round(
    PLACEMENT_FACTOR[placement] * (0.62 * quality + 0.23 * speed + 0.15 * fit),
  );

  if (estimated) notes.push("KV cache estimated — model architecture is unverified.");

  return {
    model,
    quant,
    ctx: cappedCtx,
    weightsGb: round(w),
    kvCacheGb: round(kv),
    overheadGb: round(oh),
    totalGb: round(total),
    placement,
    tokPerSec,
    onGpuGb: round(onGpuGb),
    score,
    scoreBreakdown: { fit, speed, quality },
    notes,
    estimated,
  };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
