import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { test } from "node:test";
import { buildHardware } from "../src/hardware.js";
import { computeFit, kvCacheGb, pickBestQuant, weightsGb } from "../src/fit.js";
import type { Model, RawSystem } from "../src/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const hw = (name: string) =>
  buildHardware(JSON.parse(readFileSync(path.join(here, "fixtures", `${name}.json`), "utf8")) as RawSystem);

const llama8b: Model = {
  name: "Llama 3.1 8B",
  paramsB: 8,
  gqaFactor: 4,
  categories: ["general"],
  ollamaTag: "llama3.1:8b",
  maxCtx: 131072,
};

test("weights math: 7B Q4_K_M lands near the real ~3.9GB", () => {
  const w = weightsGb(7, "Q4_K_M");
  assert.ok(w > 3.5 && w < 4.3, `got ${w}`);
});

test("KV cache grows with context and model size", () => {
  assert.ok(kvCacheGb(7, 8192) > kvCacheGb(7, 2048));
  assert.ok(kvCacheGb(14, 8192) > kvCacheGb(7, 8192));
});

test("GQA shrinks the KV cache (modern models use far less than multi-head)", () => {
  const mha = kvCacheGb(8, 32768, 1); // old multi-head assumption
  const gqa = kvCacheGb(8, 32768, 4); // Llama 3 / Qwen2.5 reality
  assert.ok(gqa < mha / 3.5, `GQA should be ~4x smaller: mha=${mha} gqa=${gqa}`);
});

test("REGRESSION: Llama 3.1 8B (GQA) runs at 32k on a 24GB card — not 'won't run'", () => {
  // Before the GQA fix this falsely reported "won't run" (KV ~18.7GB). With
  // real GQA (factor 4) the KV is ~4.7GB and it fits comfortably on a 4090.
  const r = computeFit(llama8b, "Q4_K_M", hw("rtx4090-desktop"), 32768);
  assert.notEqual(r.placement, "wont-run");
  assert.ok(r.kvCacheGb < 6, `KV should be ~4-5GB with GQA, got ${r.kvCacheGb}`);
});

test("unknown architecture is flagged as estimated", () => {
  const noArch: Model = { ...llama8b, gqaFactor: undefined };
  const r = computeFit(noArch, "Q4_K_M", hw("rtx4090-desktop"), 8192);
  assert.equal(r.estimated, true);
});

test("same model: fits at small ctx, won't fit at huge ctx (6GB card)", () => {
  const small = computeFit(llama8b, "Q4_K_M", hw("intel-igpu-laptop"), 2048);
  // iGPU laptop has no VRAM, so 8B Q4 should not be full-gpu there.
  assert.notEqual(small.placement, "full-gpu");

  const big4090 = computeFit(llama8b, "Q4_K_M", hw("rtx4090-desktop"), 8192);
  assert.equal(big4090.placement, "full-gpu", "8B easily fits a 4090");

  const huge4090 = computeFit(llama8b, "F16", hw("rtx4090-desktop"), 131072);
  // 128k context KV cache is enormous — even a 4090 should strain.
  assert.ok(["hybrid", "cpu", "wont-run"].includes(huge4090.placement));
});

test("won't-run scores zero and is flagged", () => {
  const r = computeFit({ ...llama8b, paramsB: 70 }, "F16", hw("intel-igpu-laptop"), 8192);
  assert.equal(r.placement, "wont-run");
  assert.equal(r.score, 0);
});

test("pickBestQuant prefers a full-GPU fit when one exists", () => {
  const q = pickBestQuant(llama8b, hw("rtx4090-desktop"), 8192);
  const r = computeFit(llama8b, q, hw("rtx4090-desktop"), 8192);
  assert.equal(r.placement, "full-gpu");
});

test("real measured size overrides the estimate", () => {
  const withReal: Model = { ...llama8b, realSizeGb: { Q4_K_M: 99 } };
  const r = computeFit(withReal, "Q4_K_M", hw("rtx4090-desktop"), 4096);
  assert.ok(r.weightsGb === 99, "should trust the measured size");
  assert.equal(r.placement, "wont-run", "99GB weights can't fit a 24GB card");
});
