import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import si from "systeminformation";
import type { GpuInfo, Hardware, RawSystem } from "./types.js";

// ---------------------------------------------------------------------------
// Hardware detection is split in two on purpose:
//   • buildHardware(raw)  — PURE. No I/O. This is what we unit-test against
//                            synthetic machines (Mac, 4090, no-GPU server…).
//   • detectHardware()    — gathers the real `raw` from the OS, then builds.
// That split is the whole strategy for "works on many computers": we can
// simulate any machine by feeding a fixture into buildHardware().
// ---------------------------------------------------------------------------

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

// Rough memory bandwidth (GB/s) — the #1 driver of token speed. We can't read
// it from the OS, so we infer from the GPU/chip name. All ballparks.
function estimateBandwidth(name: string, dedicated: boolean, unified: boolean): number {
  const n = name.toLowerCase();
  if (unified) {
    // Apple Silicon: bandwidth scales hard with the chip tier.
    if (/ultra/.test(n)) return 800;
    if (/max/.test(n)) return 400;
    if (/pro/.test(n)) return 200;
    if (/m[1-4]/.test(n)) return 100;
    return 80; // generic APU / iGPU on dual-channel RAM
  }
  if (!dedicated) return 50;
  if (/50[0-9]{2}|rtx 50/.test(n)) return 900;
  if (/40[0-9]{2}|rtx 40/.test(n)) return 700;
  if (/30[0-9]{2}|rtx 30/.test(n)) return 600;
  if (/20[0-9]{2}|16[0-9]{2}|rtx 20|gtx 16/.test(n)) return 300;
  if (/a100|h100|h200/.test(n)) return 1800;
  return 350;
}

function classify(vendor: string, model: string, unified: boolean): { vendor: string; dedicated: boolean } {
  const v = `${vendor} ${model}`.toLowerCase();
  if (unified && v.includes("apple")) return { vendor: "Apple", dedicated: false };
  if (/nvidia|geforce|quadro|tesla|rtx|gtx/.test(v)) return { vendor: "NVIDIA", dedicated: true };
  if (/radeon|amd/.test(v)) {
    const integrated = /vega|graphics|ryzen|radeon\(tm\) graphics/.test(v) && !/rx /.test(v);
    return { vendor: "AMD", dedicated: !integrated };
  }
  if (/intel/.test(v)) return { vendor: "Intel", dedicated: false };
  if (/apple/.test(v)) return { vendor: "Apple", dedicated: false };
  return { vendor: vendor || "Unknown", dedicated: false };
}

export function buildHardware(raw: RawSystem): Hardware {
  const notes: string[] = [];
  const ramGb = round(raw.mem.total / 1024 ** 3);
  const isApple =
    raw.platform === "darwin" &&
    (raw.arch === "arm64" || /apple/i.test(raw.cpu.manufacturer));
  const unified = isApple; // (AMD APUs are unified too, but VRAM split is murky; treat as iGPU)

  let gpus: GpuInfo[] = (raw.graphics.controllers || [])
    .map((c) => {
      const name = c.model || c.name || "Unknown GPU";
      const { vendor, dedicated } = classify(c.vendor || "", name, unified);
      let vramGb = round((c.vram || 0) / 1024); // si reports VRAM in MB
      // Dynamic/shared VRAM (iGPUs) is reported inconsistently; don't trust it
      // as dedicated memory.
      if (c.vramDynamic && !dedicated) vramGb = 0;
      return { name, vendor, vramGb, dedicated, bandwidthGbs: estimateBandwidth(name, dedicated, unified) };
    })
    .filter((g) => g.name !== "Unknown GPU" || g.vramGb > 0);

  let primaryGpu: GpuInfo | null;
  let usableVramGb: number;

  if (unified) {
    // Unified memory: the "GPU" can use most of system RAM. macOS lets the GPU
    // address ~70% of RAM by default for large allocations.
    const chip = gpus.find((g) => g.vendor === "Apple") ?? {
      name: raw.cpu.brand || "Apple Silicon",
      vendor: "Apple",
      vramGb: ramGb,
      dedicated: false,
      bandwidthGbs: estimateBandwidth(raw.cpu.brand, false, true),
    };
    chip.vramGb = ramGb;
    primaryGpu = chip;
    usableVramGb = round(ramGb * 0.7);
    notes.push(`Apple unified memory: GPU shares the ${ramGb}GB pool (~${usableVramGb}GB usable).`);
    if (!gpus.some((g) => g.vendor === "Apple")) gpus = [chip];
  } else {
    const dedicated = gpus.filter((g) => g.dedicated).sort((a, b) => b.vramGb - a.vramGb);
    primaryGpu = dedicated[0] ?? null;
    usableVramGb = primaryGpu ? round(primaryGpu.vramGb * 0.9) : 0;
    if (primaryGpu && primaryGpu.vramGb === 0) {
      notes.push("Dedicated GPU found but VRAM unknown — treating as CPU-only. Run `nvidia-smi` to confirm.");
      primaryGpu = null;
      usableVramGb = 0;
    }
    if (!primaryGpu) notes.push("No usable dedicated GPU detected — sizing for CPU inference.");
  }

  return {
    cpuBrand: `${raw.cpu.manufacturer} ${raw.cpu.brand}`.trim(),
    cpuCores: raw.cpu.cores,
    cpuPhysicalCores: raw.cpu.physicalCores,
    ramGb,
    gpus,
    primaryGpu,
    usableVramGb,
    usableRamGb: round(ramGb * 0.75),
    platform: raw.platform,
    unifiedMemory: unified,
    detectionNotes: notes,
  };
}

/** Best-effort NVIDIA cross-check: `nvidia-smi` reports true VRAM, which fixes
 *  the common Windows WDDM bug where systeminformation caps VRAM at 4GB. */
async function nvidiaSmiVram(): Promise<number | null> {
  return new Promise((resolve) => {
    execFile(
      "nvidia-smi",
      ["--query-gpu=memory.total", "--format=csv,noheader,nounits"],
      { timeout: 4000, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(null);
        const mb = parseInt(String(stdout).trim().split("\n")[0], 10);
        resolve(Number.isFinite(mb) ? round(mb / 1024) : null);
      },
    );
  });
}

export async function detectHardware(fixturePath?: string): Promise<Hardware> {
  // Replay a saved machine for testing/debugging: `--hw machine.json`.
  const fromFixture = fixturePath ?? process.env.LLMFIT_HW;
  if (fromFixture) {
    const raw = JSON.parse(await readFile(fromFixture, "utf8")) as RawSystem;
    return buildHardware(raw);
  }

  const [cpu, mem, graphics] = await Promise.all([si.cpu(), si.mem(), si.graphics()]);
  const raw: RawSystem = {
    cpu: {
      manufacturer: cpu.manufacturer,
      brand: cpu.brand,
      cores: cpu.cores,
      physicalCores: cpu.physicalCores,
    },
    mem: { total: mem.total },
    graphics: {
      controllers: (graphics.controllers || []).map((c) => ({
        vendor: c.vendor,
        model: c.model,
        name: c.name,
        vram: c.vram,
        vramDynamic: c.vramDynamic,
      })),
    },
    platform: process.platform,
    arch: process.arch,
  };

  const hw = buildHardware(raw);

  // If we have an NVIDIA target, trust nvidia-smi's VRAM over si when it differs.
  if (hw.primaryGpu?.vendor === "NVIDIA") {
    const smi = await nvidiaSmiVram();
    if (smi && Math.abs(smi - hw.primaryGpu.vramGb) > 0.5) {
      hw.detectionNotes.push(
        `nvidia-smi reports ${smi}GB VRAM (systeminformation said ${hw.primaryGpu.vramGb}GB) — using ${smi}GB.`,
      );
      hw.primaryGpu.vramGb = smi;
      hw.usableVramGb = round(smi * 0.9);
    }
  }

  return hw;
}

/** Dump the raw OS reading — testers send you this when something looks wrong. */
export async function dumpRaw(): Promise<RawSystem> {
  const [cpu, mem, graphics] = await Promise.all([si.cpu(), si.mem(), si.graphics()]);
  return {
    cpu: { manufacturer: cpu.manufacturer, brand: cpu.brand, cores: cpu.cores, physicalCores: cpu.physicalCores },
    mem: { total: mem.total },
    graphics: {
      controllers: (graphics.controllers || []).map((c) => ({
        vendor: c.vendor,
        model: c.model,
        name: c.name,
        vram: c.vram,
        vramDynamic: c.vramDynamic,
      })),
    },
    platform: process.platform,
    arch: process.arch,
  };
}
