// Shared shapes used across the whole CLI. Keeping them in one place means the
// hardware layer, the fit engine, and the formatter all agree on the data.

export interface GpuInfo {
  name: string;
  vendor: string;
  vramGb: number;
  /** True for dedicated cards (NVIDIA/AMD discrete), false for iGPUs. */
  dedicated: boolean;
  /** Rough memory bandwidth in GB/s — the #1 driver of token generation speed. */
  bandwidthGbs: number;
}

export interface Hardware {
  cpuBrand: string;
  cpuCores: number;
  cpuPhysicalCores: number;
  ramGb: number;
  gpus: GpuInfo[];
  /** The GPU we'll target for inference (dedicated card, or Apple unified GPU). */
  primaryGpu: GpuInfo | null;
  /** Usable VRAM for model offload (we leave headroom for the OS/display). */
  usableVramGb: number;
  /** Usable system RAM for CPU inference. */
  usableRamGb: number;
  /** "win32" | "darwin" | "linux" — affects how we read VRAM. */
  platform: string;
  /** Apple Silicon / APUs share one memory pool between CPU and GPU. */
  unifiedMemory: boolean;
  /** Where the numbers came from, for debugging users' machines remotely. */
  detectionNotes: string[];
}

/** The minimal raw shape we need from the OS. Mirrors `systeminformation`'s
 *  output but is small enough to hand-write in tests / fixtures. */
export interface RawSystem {
  cpu: { manufacturer: string; brand: string; cores: number; physicalCores: number };
  mem: { total: number };
  graphics: {
    controllers: Array<{
      vendor?: string;
      model?: string;
      name?: string;
      vram?: number | null;
      vramDynamic?: boolean;
    }>;
  };
  platform: string;
  arch: string;
}

export type Quant =
  | "Q2_K"
  | "Q3_K_M"
  | "Q4_K_M"
  | "Q5_K_M"
  | "Q6_K"
  | "Q8_0"
  | "F16";

export type Category =
  | "general"
  | "coding"
  | "reasoning"
  | "chat"
  | "vision"
  | "creative"
  | "reading";

export interface Model {
  /** Display name, e.g. "Llama 3.1 8B". */
  name: string;
  /** Parameter count in billions. */
  paramsB: number;
  /** For Mixture-of-Experts models, active params per token (drives speed). */
  activeParamsB?: number;
  categories: Category[];
  /** Ollama tag, e.g. "llama3.1:8b". Empty string = not on Ollama. */
  ollamaTag: string;
  /** HuggingFace GGUF repo for llama.cpp, if known. */
  hfRepo?: string;
  /** Native context window. */
  maxCtx: number;
  /** Grouped-query-attention factor = (query heads ÷ KV heads). Modern models
   *  use GQA (factor 2–8), which shrinks the KV cache by that factor vs old
   *  multi-head attention (factor 1). Drives KV-cache memory; omit if unknown. */
  gqaFactor?: number;
  /** Where this entry came from. */
  source?: "seed" | "ollama" | "ollama-local" | "huggingface";
  /** Real on-disk size in GB for a given quant, when a source reports it.
   *  When present we trust this over the params×bytes estimate. */
  realSizeGb?: Partial<Record<Quant, number>>;
  /** Popularity signal (Ollama pulls / HF downloads), for tie-breaking. */
  popularity?: number;
}

export type Placement = "full-gpu" | "hybrid" | "cpu" | "wont-run";

export interface FitResult {
  model: Model;
  quant: Quant;
  ctx: number;
  weightsGb: number;
  kvCacheGb: number;
  overheadGb: number;
  totalGb: number;
  placement: Placement;
  /** Estimated generation speed in tokens/sec (rough ballpark). */
  tokPerSec: number;
  /** GB that fit on the GPU vs spilled to CPU RAM. */
  onGpuGb: number;
  /** 0–100, with a transparent breakdown. */
  score: number;
  scoreBreakdown: { fit: number; speed: number; quality: number };
  notes: string[];
  /** True when the fit relies on estimated (not measured) numbers — i.e. the
   *  model's real file size and/or attention architecture were unknown. Lets
   *  the UI be honest instead of implying false precision. */
  estimated: boolean;
}
