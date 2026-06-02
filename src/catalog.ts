import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MODELS } from "./models.js";
import { fetchHuggingFaceGGUF, fetchOllamaLocal } from "./sources.js";
import type { Model } from "./types.js";

// ---------------------------------------------------------------------------
// The catalog merges three sources, newest-priority, and caches the remote
// part to disk so the tool stays fast and works offline.
//   seed (always)  +  ollama-local (if running)  +  HF GGUF (cached ~24h)
// ---------------------------------------------------------------------------

const CACHE_DIR = path.join(os.homedir(), ".cache", "model-fit");
const CACHE_FILE = path.join(CACHE_DIR, "huggingface.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface Catalog {
  models: Model[];
  label: string; // e.g. "seed + ollama(4) + hf(50)"
}

/** A stable identity for de-duplication across sources. */
function key(m: Model): string {
  const base = (m.ollamaTag || m.hfRepo || m.name)
    .toLowerCase()
    .replace(/[:_\s-]+/g, "")
    .replace(/gguf$/, "");
  return `${base}@${m.paramsB}`;
}

/** Merge lists; earlier lists win on conflicts but we backfill missing fields. */
function merge(lists: Model[][]): Model[] {
  const byKey = new Map<string, Model>();
  for (const list of lists) {
    for (const m of list) {
      const k = key(m);
      const existing = byKey.get(k);
      if (!existing) {
        byKey.set(k, { ...m });
      } else {
        // Backfill: keep curated fields, but adopt real sizes / popularity / repo.
        existing.realSizeGb = { ...m.realSizeGb, ...existing.realSizeGb };
        existing.popularity = Math.max(existing.popularity ?? 0, m.popularity ?? 0);
        existing.ollamaTag ||= m.ollamaTag;
        existing.hfRepo ||= m.hfRepo;
      }
    }
  }
  return [...byKey.values()];
}

async function readCache(): Promise<{ at: number; models: Model[] } | null> {
  try {
    const raw = JSON.parse(await readFile(CACHE_FILE, "utf8"));
    if (Array.isArray(raw.models)) return raw;
    return null;
  } catch {
    return null;
  }
}

async function writeCache(models: Model[]): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify({ at: Date.now(), models }), "utf8");
  } catch {
    /* cache is best-effort */
  }
}

export async function loadCatalog(opts: { refresh?: boolean } = {}): Promise<Catalog> {
  const parts: string[] = ["seed"];

  // 1) Locally installed Ollama models — fast and authoritative.
  const local = await fetchOllamaLocal();
  if (local.length) parts.push(`ollama(${local.length})`);

  // 2) Hugging Face GGUF — from cache unless refreshing or stale.
  let hf: Model[] = [];
  const cached = await readCache();
  const fresh = cached && Date.now() - cached.at < CACHE_TTL_MS;
  if (opts.refresh || !fresh) {
    const fetched = await fetchHuggingFaceGGUF(100);
    if (fetched.length) {
      hf = fetched;
      await writeCache(fetched);
      parts.push(`hf(${fetched.length})`);
    } else if (cached) {
      hf = cached.models;
      parts.push(`hf(${cached.models.length}, cached)`);
    }
  } else if (cached) {
    hf = cached.models;
    parts.push(`hf(${cached.models.length}, cached)`);
  }

  // Seed first so curated names/categories/context windows win.
  const models = merge([MODELS, local, hf]);
  return { models, label: parts.join(" + ") };
}
