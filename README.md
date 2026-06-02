# model-fit

Find local LLMs that **actually run** on your hardware — with real fit math, not opaque scores.

Unlike tools that print a mystery "Score: 90/100", `model-fit` computes the real
memory budget for each model (**weights + KV cache for your context length +
runtime overhead**), tells you whether it lands on **full-GPU / hybrid /
CPU-only / won't-run**, estimates **tokens/sec**, and shows the score breakdown.

## Quick start (development)

```bash
npm install        # install dependencies
npm run dev -- detect            # run straight from TypeScript (no build)
npm run dev -- recommend --category coding --ctx 8192
npm run dev -- check llama3.1 --ctx 32768
```

To get a real `model-fit` command on your machine:

```bash
npm run build      # compile TypeScript -> dist/
npm link           # creates a global `model-fit` command
model-fit detect
```

## Commands

| Command | What it does |
| --- | --- |
| `model-fit detect` (alias `hw`) | Print detected CPU / RAM / GPU + the inference target |
| `model-fit recommend` | Rank models that fit, best first |
| `model-fit check <model>` | Deep-dive one model's fit |

Useful flags: `--ctx <tokens>` (sizes the KV cache — try 32768 to see VRAM cost
explode), `--category coding|reasoning|vision|...`, `--runtime ollama|llama.cpp`.

## How the math works (the honest part)

- **Weights** = `params(B) × bytes-per-weight[quant]`. Q4_K_M ≈ 0.56 B/param,
  so a 7B model ≈ 3.9 GB.
- **KV cache** = `(ctx/1000) × 0.5 × (params/7)` GB (fp16). Calibrated so
  Llama-7B @ 4k ctx ≈ 2 GB. This is the cost most tools ignore.
- **Speed** ≈ `memory bandwidth ÷ active weights` — generation is bandwidth
  bound, and MoE models only read their active experts.

All ballparks, but transparent: every number on screen is derived, and you can
see the inputs in `src/fit.ts`.

## Next steps / ideas to grow it

- Read real GPU memory bandwidth (e.g. `nvidia-smi`) instead of estimating.
- Add KV-cache quantization (`--kv-quant q8`) to the math.
- `model-fit run <model>` to pull + launch in one step.
- Clean up noisy Hugging Face repo names / prefer trusted uploaders.

## Model sources (where the suggestions come from)

The catalog (`src/catalog.ts`) merges three sources, then de-dupes:

| Source | Endpoint | Gives |
| --- | --- | --- |
| **Curated seed** | `src/models.ts` | Clean names/categories, works offline |
| **Ollama (local)** | `http://localhost:11434/api/tags` | Models you have installed, with **real byte sizes** |
| **Hugging Face Hub** | `/api/models?filter=gguf&sort=downloads` | The big GGUF catalog, by popularity |

Refresh the live data with `--refresh`; it's cached for 24h under
`~/.cache/model-fit/` so the tool stays fast and works offline.

## Testing (how to trust it on machines you don't own)

Detection is split into a **pure** `buildHardware(raw)` and the I/O wrapper
`detectHardware()`. That lets us simulate any machine:

```bash
npm test                         # unit tests: fit math + detection across fixtures
model-fit detect --raw             # dump YOUR machine's raw reading
model-fit --hw test/fixtures/macbook-m3-max.json recommend   # replay another machine
```

- `test/fixtures/*.json` are saved raw readings (Mac M3 Max, RTX 4090, no-GPU
  server, iGPU laptop). Add your testers' `--raw` dumps here as regression cases.
- `.github/workflows/ci.yml` runs the suite on **Windows + macOS + Linux** across
  Node 18/20/22 on every push.

**When a tester hits a bug:** have them run `model-fit detect --raw > my-pc.json`
and send the file. Drop it in `test/fixtures/`, reproduce with `--hw`, fix, and
the fixture becomes a permanent regression test.

## License

MIT
