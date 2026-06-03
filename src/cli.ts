#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import { detectHardware, dumpRaw } from "./hardware.js";
import { loadCatalog } from "./catalog.js";
import { computeFit, pickBestQuant } from "./fit.js";
import {
  type CategoryPick,
  renderBestPick,
  renderByCategory,
  renderDetail,
  renderHardware,
  renderHeader,
  renderInstall,
  renderModels,
  renderSystem,
  renderTip,
} from "./format.js";
import type { Category, FitResult } from "./types.js";

// Display order + labels for the per-category overview.
const CATEGORIES: Array<{ key: Category; label: string }> = [
  { key: "coding", label: "Coding" },
  { key: "reasoning", label: "Reasoning" },
  { key: "vision", label: "Vision" },
  { key: "creative", label: "Creative" },
  { key: "chat", label: "Chat" },
  { key: "reading", label: "Reading" },
  { key: "general", label: "General" },
];

const program = new Command();

program
  .name("model-fit")
  .description("Find local LLMs that actually run on your hardware — with real fit math.")
  .version("0.1.2")
  .option("--hw <file>", "load hardware from a JSON dump instead of detecting");

function globalOpts() {
  return program.opts<{ hw?: string }>();
}

/** Detect hardware while timing it, so we can show "Scan complete · 1.2s". */
async function scan() {
  const t0 = Date.now();
  const hw = await detectHardware(globalOpts().hw);
  return { hw, elapsed: Date.now() - t0 };
}

program
  .command("detect")
  .alias("hw")
  .description("Detect and print your hardware")
  .option("--json", "print the analyzed hardware as JSON")
  .option("--raw", "print the raw OS reading (send this when reporting a bug)")
  .action(async (opts) => {
    if (opts.raw) return void console.log(JSON.stringify(await dumpRaw(), null, 2));
    const { hw, elapsed } = await scan();
    if (opts.json) return void console.log(JSON.stringify(hw, null, 2));
    console.log(renderHeader("Hardware detected", elapsed));
    console.log();
    console.log(renderHardware(hw));
    console.log();
  });

program
  .command("recommend")
  .description("Recommend models ranked by how well they fit + run")
  .option("-c, --category <cat>", "filter: general|coding|reasoning|chat|vision|creative")
  .option("--ctx <tokens>", "context window to size the KV cache for", "8192")
  .option("--runtime <name>", "ollama | llama.cpp", "ollama")
  .option("--top <n>", "how many models to show (with --category)", "10")
  .option("--refresh", "refresh the model catalog from live sources first")
  .action(async (opts) => {
    const { hw, elapsed } = await scan();
    const ctx = parseInt(opts.ctx, 10) || 8192;
    const top = parseInt(opts.top, 10) || 10;
    const category = opts.category as Category | undefined;
    const catalog = await loadCatalog({ refresh: !!opts.refresh });

    // Score every model once; keep only those that actually run.
    const byScore = (a: FitResult, b: FitResult) =>
      b.score - a.score || (b.model.popularity ?? 0) - (a.model.popularity ?? 0);
    const fitted = catalog.models
      .map((m) => computeFit(m, pickBestQuant(m, hw, ctx), hw, ctx))
      .filter((r) => r.placement !== "wont-run")
      .sort(byScore);

    console.log(renderHeader("Scan complete", elapsed));
    console.log();
    console.log(renderSystem(hw));
    console.log();

    if (fitted.length === 0) {
      console.log(pc.red("  No models fit — try a smaller --ctx, or check your hardware.\n"));
      return;
    }

    let shown: FitResult[];
    if (category) {
      // Deep ranked list for one category.
      const list = fitted.filter((r) => r.model.categories.includes(category)).slice(0, top);
      shown = list.length ? list : [fitted[0]];
      console.log(renderBestPick(shown[0], hw, ctx));
      console.log();
      console.log(renderModels(list));
      console.log();
      console.log(renderInstall(shown[0], opts.runtime));
    } else {
      // Overview: best overall + best per category (the llm-checker view, better).
      console.log(renderBestPick(fitted[0], hw, ctx));
      console.log();
      const picks: CategoryPick[] = CATEGORIES.map(({ key, label }) => ({
        label,
        result: fitted.find((r) => r.model.categories.includes(key)) ?? null,
      }));
      console.log(renderByCategory(picks));
      console.log();
      console.log(renderInstall(fitted[0], opts.runtime));
      shown = [fitted[0], ...picks.map((p) => p.result).filter((r): r is FitResult => !!r)];
    }

    if (shown.some((r) => r.estimated)) {
      console.log(pc.dim("  ≈ some picks use an assumed architecture (unverified KV math) — run ") + pc.cyan("check <model>"));
    }
    console.log(renderTip("Filter with --category coding (or reasoning, vision, creative, chat, reading)."));
    console.log(
      pc.dim(`  Source: ${catalog.label} · ${fitted.length} runnable · ${catalog.models.length} analyzed · ctx ${ctx.toLocaleString()}`),
    );
    console.log();
  });

program
  .command("check <model>")
  .description("Deep-dive whether a specific model fits (memory breakdown)")
  .option("--ctx <tokens>", "context window", "8192")
  .option("--quant <q>", "force a quant, e.g. Q4_K_M (default: auto-pick best)")
  .option("--runtime <name>", "ollama | llama.cpp", "ollama")
  .option("--refresh", "refresh the model catalog from live sources first")
  .action(async (query: string, opts) => {
    const { hw, elapsed } = await scan();
    const ctx = parseInt(opts.ctx, 10) || 8192;
    const catalog = await loadCatalog({ refresh: !!opts.refresh });
    const q = query.toLowerCase();
    const matches = catalog.models.filter(
      (m) => m.name.toLowerCase().includes(q) || m.ollamaTag.toLowerCase().includes(q),
    );

    console.log(renderHeader(`Check · ${query}`, elapsed));
    console.log();
    console.log(renderSystem(hw));
    console.log();

    if (matches.length === 0) {
      console.log(pc.red(`  No model matching "${query}".`) + pc.dim("  Try: model-fit recommend\n"));
      return;
    }
    matches.slice(0, 10).forEach((m) => {
      const quant = opts.quant ?? pickBestQuant(m, hw, ctx);
      console.log(renderDetail(computeFit(m, quant, hw, ctx), hw, opts.runtime));
      console.log();
    });
  });

if (process.argv.length <= 2) process.argv.push("recommend");

program.parseAsync(process.argv).catch((err) => {
  console.error(pc.red("Error:"), err?.message ?? err);
  process.exit(1);
});
