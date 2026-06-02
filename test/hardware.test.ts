import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { test } from "node:test";
import { buildHardware } from "../src/hardware.js";
import type { RawSystem } from "../src/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): RawSystem =>
  JSON.parse(readFileSync(path.join(here, "fixtures", `${name}.json`), "utf8"));

// These tests simulate machines we don't physically own — the whole point of
// keeping buildHardware() pure. If detection logic regresses, CI catches it.

test("Apple Silicon → unified memory, GPU shares the RAM pool", () => {
  const hw = buildHardware(fixture("macbook-m3-max"));
  assert.equal(hw.unifiedMemory, true);
  assert.ok(hw.primaryGpu, "should pick the Apple GPU as target");
  assert.equal(hw.primaryGpu?.vendor, "Apple");
  // 64GB unified, ~70% usable → big VRAM budget despite no discrete card.
  assert.ok(hw.usableVramGb > 40, `expected >40GB usable, got ${hw.usableVramGb}`);
  assert.ok(hw.primaryGpu!.bandwidthGbs >= 300, "M3 Max should be high-bandwidth");
});

test("RTX 4090 → dedicated NVIDIA target with ~22GB usable", () => {
  const hw = buildHardware(fixture("rtx4090-desktop"));
  assert.equal(hw.unifiedMemory, false);
  assert.equal(hw.primaryGpu?.vendor, "NVIDIA");
  assert.ok(hw.usableVramGb > 20 && hw.usableVramGb < 24);
  assert.ok(hw.primaryGpu!.bandwidthGbs >= 600);
});

test("No GPU → CPU-only, no inference target", () => {
  const hw = buildHardware(fixture("no-gpu-server"));
  assert.equal(hw.primaryGpu, null);
  assert.equal(hw.usableVramGb, 0);
  assert.ok(hw.usableRamGb > 20);
  assert.ok(hw.detectionNotes.some((n) => /CPU/i.test(n)));
});

test("Integrated-only laptop → iGPU is not treated as VRAM", () => {
  const hw = buildHardware(fixture("intel-igpu-laptop"));
  assert.equal(hw.primaryGpu, null, "shared-memory iGPU is not an offload target");
  assert.equal(hw.usableVramGb, 0);
});

test("buildHardware never throws on garbage input", () => {
  const junk: RawSystem = {
    cpu: { manufacturer: "", brand: "", cores: 0, physicalCores: 0 },
    mem: { total: 0 },
    graphics: { controllers: [{}] },
    platform: "freebsd",
    arch: "ppc64",
  };
  assert.doesNotThrow(() => buildHardware(junk));
});
