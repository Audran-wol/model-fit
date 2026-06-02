import type { Model } from "./types.js";

// Curated seed catalog — the offline backbone. Live sources (Ollama + HF) get
// merged on top via `--refresh`. Params are in billions; maxCtx is the native
// context window. `gqaFactor` (query heads ÷ KV heads) is the model's real
// grouped-query-attention ratio — it sizes the KV cache accurately. Values are
// from each model's published architecture; CodeLlama/LLaVA-7B are old
// multi-head (factor 1), everything modern is GQA (2–8).
export const MODELS: Model[] = [
  // ── Tiny / general ────────────────────────────────────────────────────────
  { name: "Qwen2.5 0.5B", paramsB: 0.5, gqaFactor: 7, categories: ["general", "chat"], ollamaTag: "qwen2.5:0.5b", maxCtx: 32768 },
  { name: "Qwen2.5 1.5B", paramsB: 1.5, gqaFactor: 6, categories: ["general", "chat"], ollamaTag: "qwen2.5:1.5b", maxCtx: 32768 },
  { name: "Llama 3.2 1B", paramsB: 1, gqaFactor: 4, categories: ["general", "chat"], ollamaTag: "llama3.2:1b", maxCtx: 131072 },
  { name: "Gemma 2 2B", paramsB: 2, gqaFactor: 2, categories: ["general", "chat", "creative"], ollamaTag: "gemma2:2b", maxCtx: 8192 },
  { name: "Llama 3.2 3B", paramsB: 3, gqaFactor: 3, categories: ["general", "chat", "reasoning"], ollamaTag: "llama3.2:3b", maxCtx: 131072 },
  { name: "Qwen2.5 3B", paramsB: 3, gqaFactor: 8, categories: ["general", "chat"], ollamaTag: "qwen2.5:3b", maxCtx: 32768 },

  // ── Reasoning ─────────────────────────────────────────────────────────────
  { name: "Phi-4 Mini 3.8B", paramsB: 3.8, gqaFactor: 3, categories: ["reasoning", "general", "coding"], ollamaTag: "phi4-mini", maxCtx: 131072 },
  { name: "DeepSeek-R1 1.5B", paramsB: 1.5, gqaFactor: 6, categories: ["reasoning"], ollamaTag: "deepseek-r1:1.5b", maxCtx: 131072 },
  { name: "DeepSeek-R1 7B", paramsB: 7, gqaFactor: 7, categories: ["reasoning"], ollamaTag: "deepseek-r1:7b", maxCtx: 131072 },
  { name: "DeepSeek-R1 8B", paramsB: 8, gqaFactor: 4, categories: ["reasoning"], ollamaTag: "deepseek-r1:8b", maxCtx: 131072 },
  { name: "DeepSeek-R1 14B", paramsB: 14, gqaFactor: 5, categories: ["reasoning", "coding"], ollamaTag: "deepseek-r1:14b", maxCtx: 131072 },
  { name: "DeepSeek-R1 32B", paramsB: 32, gqaFactor: 5, categories: ["reasoning", "coding"], ollamaTag: "deepseek-r1:32b", maxCtx: 131072 },
  { name: "QwQ 32B", paramsB: 32, gqaFactor: 5, categories: ["reasoning"], ollamaTag: "qwq", maxCtx: 32768 },

  // ── Coding ────────────────────────────────────────────────────────────────
  { name: "Qwen2.5 Coder 1.5B", paramsB: 1.5, gqaFactor: 6, categories: ["coding"], ollamaTag: "qwen2.5-coder:1.5b", maxCtx: 32768 },
  { name: "Qwen2.5 Coder 7B", paramsB: 7, gqaFactor: 7, categories: ["coding"], ollamaTag: "qwen2.5-coder:7b", hfRepo: "Qwen/Qwen2.5-Coder-7B-Instruct-GGUF", maxCtx: 32768 },
  { name: "Qwen2.5 Coder 14B", paramsB: 14, gqaFactor: 5, categories: ["coding"], ollamaTag: "qwen2.5-coder:14b", maxCtx: 32768 },
  { name: "Qwen2.5 Coder 32B", paramsB: 32, gqaFactor: 5, categories: ["coding"], ollamaTag: "qwen2.5-coder:32b", maxCtx: 32768 },
  { name: "CodeLlama 7B", paramsB: 7, gqaFactor: 1, categories: ["coding"], ollamaTag: "codellama:7b", maxCtx: 16384 },
  { name: "CodeLlama 13B", paramsB: 13, gqaFactor: 1, categories: ["coding"], ollamaTag: "codellama:13b", maxCtx: 16384 },
  { name: "DeepSeek-Coder-V2 16B (MoE)", paramsB: 16, activeParamsB: 2.4, gqaFactor: 4, categories: ["coding"], ollamaTag: "deepseek-coder-v2:16b", maxCtx: 131072 },
  { name: "Codestral 22B", paramsB: 22, gqaFactor: 4, categories: ["coding"], ollamaTag: "codestral", maxCtx: 32768 },
  { name: "Starcoder2 3B", paramsB: 3, gqaFactor: 4, categories: ["coding"], ollamaTag: "starcoder2:3b", maxCtx: 16384 },

  // ── General mid / large ───────────────────────────────────────────────────
  { name: "Mistral 7B", paramsB: 7, gqaFactor: 4, categories: ["general", "chat", "creative"], ollamaTag: "mistral:7b", maxCtx: 32768 },
  { name: "Llama 3.1 8B", paramsB: 8, gqaFactor: 4, categories: ["general", "chat", "reasoning", "reading"], ollamaTag: "llama3.1:8b", hfRepo: "bartowski/Meta-Llama-3.1-8B-Instruct-GGUF", maxCtx: 131072 },
  { name: "Granite 3.3 8B", paramsB: 8, gqaFactor: 4, categories: ["general", "coding", "chat"], ollamaTag: "granite3.3:8b", maxCtx: 131072 },
  { name: "Gemma 2 9B", paramsB: 9, gqaFactor: 2, categories: ["general", "creative", "chat"], ollamaTag: "gemma2:9b", maxCtx: 8192 },
  { name: "Mistral Nemo 12B", paramsB: 12, gqaFactor: 4, categories: ["general", "creative", "reading"], ollamaTag: "mistral-nemo:12b", maxCtx: 131072 },
  { name: "Phi-4 14B", paramsB: 14, gqaFactor: 4, categories: ["reasoning", "general", "coding"], ollamaTag: "phi4", maxCtx: 16384 },
  { name: "Qwen2.5 14B", paramsB: 14, gqaFactor: 5, categories: ["general", "reasoning", "coding", "reading"], ollamaTag: "qwen2.5:14b", maxCtx: 32768 },
  { name: "Mistral Small 22B", paramsB: 22, gqaFactor: 4, categories: ["general", "creative"], ollamaTag: "mistral-small:22b", maxCtx: 32768 },
  { name: "Gemma 2 27B", paramsB: 27, gqaFactor: 2, categories: ["general", "creative", "chat"], ollamaTag: "gemma2:27b", maxCtx: 8192 },
  { name: "Qwen2.5 32B", paramsB: 32, gqaFactor: 5, categories: ["reasoning", "coding", "general"], ollamaTag: "qwen2.5:32b", maxCtx: 32768 },
  { name: "Mixtral 8x7B (MoE)", paramsB: 47, activeParamsB: 13, gqaFactor: 4, categories: ["general", "reasoning", "coding"], ollamaTag: "mixtral:8x7b", maxCtx: 32768 },
  { name: "Llama 3.3 70B", paramsB: 70, gqaFactor: 8, categories: ["reasoning", "general", "coding", "reading"], ollamaTag: "llama3.3:70b", maxCtx: 131072 },
  { name: "Qwen2.5 72B", paramsB: 72, gqaFactor: 8, categories: ["reasoning", "general", "coding"], ollamaTag: "qwen2.5:72b", maxCtx: 32768 },

  // ── Vision / multimodal ───────────────────────────────────────────────────
  { name: "Moondream 1.8B (vision)", paramsB: 1.8, gqaFactor: 2, categories: ["vision"], ollamaTag: "moondream", maxCtx: 2048 },
  { name: "LLaVA 7B (vision)", paramsB: 7, gqaFactor: 1, categories: ["vision", "chat"], ollamaTag: "llava:7b", maxCtx: 4096 },
  { name: "LLaVA-Llama3 8B (vision)", paramsB: 8, gqaFactor: 4, categories: ["vision", "chat"], ollamaTag: "llava-llama3:8b", maxCtx: 8192 },
  { name: "Llama 3.2 Vision 11B", paramsB: 11, gqaFactor: 4, categories: ["vision", "chat"], ollamaTag: "llama3.2-vision:11b", maxCtx: 131072 },
  { name: "MiniCPM-V 8B (vision)", paramsB: 8, gqaFactor: 7, categories: ["vision"], ollamaTag: "minicpm-v:8b", maxCtx: 32768 },

  // ── Creative / chat ───────────────────────────────────────────────────────
  { name: "Dolphin 2.9 Llama3 8B", paramsB: 8, gqaFactor: 4, categories: ["creative", "chat"], ollamaTag: "dolphin-llama3:8b", maxCtx: 8192 },
];
