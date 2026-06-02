import type { Category, Model, Quant } from "./types.js";

// ---------------------------------------------------------------------------
// Live model sources. Each returns a list of normalized `Model`s (or [] on any
// failure — sources must NEVER throw, so the CLI still works offline).
// ---------------------------------------------------------------------------

const QUANTS: Quant[] = ["Q2_K", "Q3_K_M", "Q4_K_M", "Q5_K_M", "Q6_K", "Q8_0", "F16"];

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Pull a parameter count out of a model name/string, e.g. "7B", "1.5b", "8x7B". */
export function parseParams(text: string): { paramsB: number; activeParamsB?: number } | null {
  const moe = text.match(/(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*b\b/i);
  if (moe) {
    const experts = parseInt(moe[1], 10);
    const each = parseFloat(moe[2]);
    // MoE total params aren't experts×each (shared layers), but it's a usable
    // approximation; ~2 experts are active per token.
    return { paramsB: round(experts * each * 0.85), activeParamsB: round(each * 2) };
  }
  const m = text.match(/(\d+(?:\.\d+)?)\s*b\b/i);
  if (m) return { paramsB: parseFloat(m[1]) };
  return null;
}

/** Best-effort category tags from a model name. */
export function guessCategories(text: string): Category[] {
  const t = text.toLowerCase();
  const c = new Set<Category>();
  // Specialization needs a STRONG signal — bare "code" in metadata is too loose
  // (it tagged TinyLlama as a coder). Require a known coder family or word.
  if (/coder|codellama|code-?llama|codestral|codegemma|starcoder|deepseek.?coder|granite.?code|\bcoding\b/.test(t))
    c.add("coding");
  if (/llava|vision|[-_]vl\b|qwen2?-vl|moondream|multimodal|minicpm-?v|pixtral/.test(t)) c.add("vision");
  if (/deepseek-?r1|\bqwq\b|marco-o1|\bo1\b|reasoning|thinking/.test(t)) c.add("reasoning");
  if (/instruct|chat|[-_]it\b|hermes|dolphin/.test(t)) c.add("chat");
  if (/creative|story|writer|roleplay|nemo/.test(t)) c.add("creative");
  if (/128k|256k|\b1m\b|long.?context|\brag\b|summar/.test(t)) c.add("reading");
  c.add("general");
  return [...c];
}

// Repo names we'd rather not surface by default (spammy / NSFW-flavored uploads).
const JUNK = /uncensored|abliterat|nsfw|erp\b|roleplay|horny|smut|degenerate/i;

/** Turn a HF repo id into a clean display name. */
export function cleanName(id: string): string {
  const short = id.split("/")[1] ?? id;
  return short
    .replace(/[-_]?gguf$/i, "")
    .replace(/[-_](instruct|chat|hf)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeQuant(level: string): Quant | null {
  const up = level.toUpperCase().replace(/\s+/g, "");
  if ((QUANTS as string[]).includes(up)) return up as Quant;
  // Map close cousins onto the nearest bucket we model.
  if (/^Q4/.test(up)) return "Q4_K_M";
  if (/^Q5/.test(up)) return "Q5_K_M";
  if (/^Q3/.test(up)) return "Q3_K_M";
  if (/^Q2/.test(up)) return "Q2_K";
  if (/^Q6/.test(up)) return "Q6_K";
  if (/^Q8/.test(up)) return "Q8_0";
  if (/F16|FP16|BF16/.test(up)) return "F16";
  return null;
}

// ── Source 1: locally installed Ollama models (real sizes!) ─────────────────
interface OllamaTag {
  name: string;
  size: number; // bytes
  details?: { parameter_size?: string; quantization_level?: string; family?: string };
}

export async function fetchOllamaLocal(host = "http://localhost:11434"): Promise<Model[]> {
  try {
    const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: OllamaTag[] };
    return (data.models ?? [])
      .map((t): Model | null => {
        const params = parseParams(t.details?.parameter_size ?? t.name);
        if (!params) return null;
        const quant = normalizeQuant(t.details?.quantization_level ?? "");
        const realSizeGb = quant ? { [quant]: round(t.size / 1024 ** 3) } : undefined;
        return {
          name: t.name,
          paramsB: params.paramsB,
          activeParamsB: params.activeParamsB,
          categories: guessCategories(`${t.name} ${t.details?.family ?? ""}`),
          ollamaTag: t.name,
          maxCtx: 8192,
          source: "ollama-local",
          realSizeGb,
        };
      })
      .filter((m): m is Model => m !== null);
  } catch {
    return [];
  }
}

// ── Source 2: Hugging Face Hub — the big GGUF catalog ────────────────────────
interface HfModel {
  id: string;
  downloads?: number;
  likes?: number;
  tags?: string[];
}

export async function fetchHuggingFaceGGUF(limit = 100): Promise<Model[]> {
  try {
    const url =
      `https://huggingface.co/api/models?filter=gguf&sort=downloads&direction=-1&limit=${limit}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "model-fit" },
    });
    if (!res.ok) return [];
    const list = (await res.json()) as HfModel[];
    return list
      .map((m): Model | null => {
        const params = parseParams(m.id);
        if (!params || params.paramsB > 400) return null; // skip unparseable / absurd
        if (JUNK.test(m.id)) return null; // skip spammy / NSFW-flavored uploads
        return {
          name: cleanName(m.id),
          paramsB: params.paramsB,
          activeParamsB: params.activeParamsB,
          // Categorize from the repo NAME only (tags are noisy); keep it strict.
          categories: guessCategories(m.id),
          ollamaTag: "",
          hfRepo: m.id,
          maxCtx: 8192,
          source: "huggingface",
          popularity: m.downloads ?? 0,
        };
      })
      .filter((m): m is Model => m !== null);
  } catch {
    return [];
  }
}
