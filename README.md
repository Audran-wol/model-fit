# model-fit

**Find the local LLMs that actually run on your hardware** — with real VRAM math, not opaque scores.

Stop pulling models that crash with "out of memory" or crawl at 2 tokens/sec.
`model-fit` reads your CPU / GPU / RAM and, for every model, computes the real
memory budget (**weights + KV cache for your context length + overhead**) to tell
you whether it runs **full-GPU**, **hybrid**, **CPU-only**, or **won't run** —
plus an estimated **tokens/sec** and *why*.

## Install

Run it instantly with no install:

```bash
npx model-fit
```

Or install it globally for a permanent `model-fit` command:

```bash
npm install -g model-fit
```

> Requires [Node.js](https://nodejs.org) 18 or newer. Works on Windows, macOS, and Linux.

## Usage

```bash
model-fit detect                 # show your hardware
model-fit recommend              # best models for your machine, by category
model-fit recommend -c coding    # focus on one category
model-fit check llama3.1         # can I run this specific model?
```

### Commands

| Command | What it does |
| --- | --- |
| `model-fit detect` | Detect and print your CPU / GPU / RAM |
| `model-fit recommend` | Recommend the models that fit, ranked |
| `model-fit check <model>` | Deep-dive whether one model fits (memory breakdown) |

### Options

| Flag | Description |
| --- | --- |
| `-c, --category <name>` | `coding`, `reasoning`, `vision`, `creative`, `chat`, `reading`, `general` |
| `--ctx <tokens>` | Context window to size the KV cache for (default `8192`) |
| `--runtime <name>` | Show commands for `ollama` (default) or `llama.cpp` |
| `--refresh` | Pull the latest models from Hugging Face + your local Ollama |
| `--top <n>` | How many models to list (with `--category`) |

**Tip:** raise `--ctx` (e.g. `--ctx 32768`) to watch the KV cache — and the VRAM
cost — grow. That's the part most tools ignore.

## Example

```
  [MF]  Model Fit Advisor  v0.1.2

  Detected system
  GPU:  NVIDIA GeForce GTX 1660 Ti (6 GB VRAM)     RAM:  16 GB
  CPU:  Intel Core i7-9750H (6 cores / 12 threads) OS:   Windows

  ★ BEST PICK: Llama 3.2 3B
    Runtime    VRAM           Context   Speed         Quality
    FULL GPU   5.4 / 5.4 GB   8,192     ~123 tok/s    33 / 100

  Best model per category
    Coding     Qwen2.5 Coder 7B   ████░░░░  hybrid
    Reasoning  DeepSeek-R1 8B     ██████░░  full-gpu
    Vision     LLaVA-Llama3 8B    ████░░░░  full-gpu
    ...
```

## How it works

Every number on screen is derived from your hardware and the model — no black-box scores:

- **Weights** = `params × bytes-per-weight[quant]` (Q4_K_M ≈ 0.56 GB per billion params).
- **KV cache** is sized to your context length **and** the model's real attention
  architecture (GQA-aware — so modern models like Llama 3 / Qwen2.5 aren't wrongly
  flagged "won't run" at long context).
- **Speed** ≈ `memory bandwidth ÷ active weights` (generation is bandwidth-bound;
  MoE models only read their active experts).

These are honest estimates: where the architecture is unverified, the output says so.

## Where the models come from

The catalog merges three sources and de-dupes:

- a **curated seed list** (works offline),
- your **local Ollama** models (`localhost:11434`) with real on-disk sizes,
- the **Hugging Face Hub** GGUF catalog, by popularity.

Live data is cached for 24h, so it's fast and works offline. Use `--refresh` to update.

## Development

```bash
git clone https://github.com/Audran-wol/model-fit
cd model-fit
npm install
npm run dev -- recommend   # run from source
npm test                   # run the test suite
npm run build              # compile to dist/
```

## License

MIT
