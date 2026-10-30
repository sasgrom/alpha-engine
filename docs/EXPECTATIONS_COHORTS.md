# Expectations Cohort Packs

## Purpose

Cohort packs preserve the complete evidence context for one fiscal period without forcing a large document into a small prompt or silently truncating a table. They are deterministic local files, not a long-running LLM conversation.

- `cohort-pack-v2.json`: bounded source containers, sizes, token estimates, offsets and source hashes.
- `cohort-v2.json`: per-source extracted statements, timestamps, evidence validation and resume state.
- Raw LLM responses remain local and are excluded from the static UI report.

## Workflow

1. Group documents by fiscal period. 10-K/10-Q use `reportDate`; earnings 8-K/8-K/A use an explicit `quarter ended …` date extracted from content. If no defensible period exists, use `unresolved:<accession>` instead of guessing.
2. Sort primary documents, exhibits and amendments by `eventTs` and `sourceId`. Amendments never overwrite originals.
3. Preserve whole guidance, outlook and actual sections. Earnings exhibits remain whole when they fit. Long sections split only at complete subheadings or paragraph boundaries.
4. Start a new container by document when the next document would exceed the input budget.
5. If an indivisible table or block exceeds the budget, place it in `unpacked` with `indivisible_block_exceeds_context`. Do not truncate it.
6. Extract statements separately for every `sourceId`. Other documents in the container are context only. Evidence is validated only against the target source.
7. Merge the typed statements deterministically in `cohort-v2.json`.

## Commands

### Complete EX-99 coverage first

```powershell
npx tsx worker/edgar-exhibits.mts --universe research-universe-53.json
```

This is network-only and resumes by content hash. It does not require GPU.

### Build packs at the current safe 32K runtime context

```powershell
npx tsx worker/edgar-cohorts.mts --universe research-universe-53.json --context 32768
```

Optional environment equivalent:

```powershell
$env:OLLAMA_NUM_CTX = "32768"
npx tsx worker/edgar-cohorts.mts --universe research-universe-53.json
Remove-Item Env:OLLAMA_NUM_CTX
```

### Build packs at 64K / 128K / 256K

Use these only after the corresponding `ollama ps` memory test passes:

```powershell
npx tsx worker/edgar-cohorts.mts --universe research-universe-53.json --context 65536
npx tsx worker/edgar-cohorts.mts --universe research-universe-53.json --context 131072
npx tsx worker/edgar-cohorts.mts --universe research-universe-53.json --context 262144
```

The model's advertised 256K context is not the default runtime setting. Do not increase context merely because the model card allows it.

### Inspect packs without LLM calls

```powershell
npx tsx worker/edgar-cohort-extract.mts --universe research-universe-53.json --dry-run
```

For one company:

```powershell
npx tsx worker/edgar-cohorts.mts --only PFE --context 262144
npx tsx worker/edgar-cohort-extract.mts --only PFE --dry-run
```

The log shows each container's approximate tokens and each target source's KiB. Token estimate is `ceil(characters / 4)` and is a planning approximation, not a tokenizer guarantee.

### Extract and merge

```powershell
npx tsx worker/edgar-cohort-extract.mts --universe research-universe-53.json
```

The worker reads `cohort-pack-v2.json`, makes one bounded request per target source and writes `cohort-v2.json` atomically after every source. It resumes only when source, container, input hash, model and prompt version all match.

### Run the independent benchmark and build the static UI report

```powershell
npx tsx worker/expectations-benchmark.mts --cohorts
npx tsx worker/build-expectations-report.mts --cohorts
```

Reviewed publication requires a passing independent benchmark and full-history or explicitly aligned cohorts. Raw model responses are excluded from `src/data/expectations-report.ts` and `public/reports/expectations-report.json`.

## Overnight run without XOM_PRE

Use `worker/research-universe-52.json` when the predecessor alias is not worth debugging. The original 53-company file remains unchanged.

```powershell
npx tsx worker/edgar-exhibits.mts --universe research-universe-52.json
npx tsx worker/edgar-cohorts.mts --universe research-universe-52.json --context 32768
npx tsx worker/edgar-cohort-extract.mts --universe research-universe-52.json --dry-run
npx tsx worker/edgar-cohort-extract.mts --universe research-universe-52.json
```

For a memory-validated larger context, replace `32768` with `65536`, `131072` or `262144`. Do not use 256K for an unattended run until `ollama ps` confirms 100% GPU without offload on the same model.

After completion:

```powershell
npx tsx worker/expectations-benchmark.mts --cohorts
npx tsx worker/build-expectations-report.mts --universe worker/research-universe-52.json --cohorts
```

`missing packs 0` is still required before claiming complete 52-company coverage. A batch that merely finishes is not proof of complete extraction quality.

## Runtime budgets

`maxInputChars = floor(contextTokens × 0.8 × 4)`:

| Runtime context | Input character budget |
| ---: | ---: |
| 32,768 | 104,857 |
| 65,536 | 209,715 |
| 131,072 | 419,430 |
| 262,144 | 838,860 |

The remaining 20% covers the extraction instructions, JSON Schema, model template and response. Current response settings are `numPredict = 4096` tokens and at most 60 statements per source. Do not raise output size to compensate for a large cohort; split the source set instead.

## Failure semantics

- `no_candidate_text`: no relevant block found; no LLM call is needed.
- `indivisible_block_exceeds_context`: source is preserved but not sent. Increase context only after a memory test or review the section boundaries manually.
- `cache_unreadable`: source could not be read; never replace it with a model-generated substitute.
- `unparsed`: response was not valid against the typed schema; raw output is appended to `worker/.runs/cohort-extraction-failures.jsonl` and the batch continues.
- `request_failed`: transport or daemon failure; two consecutive failures checkpoint and abort. Parse failures are isolated per source and never abort the batch by themselves.

A missing result is never converted into a pass. No source, table or amendment is deliberately discarded to make a prompt smaller.

## Missing packs and aliases

Batch extraction skips a missing `cohort-pack-v2.json`, reports `missing packs N` and continues with the next company. `--only` remains fail-fast so a targeted run cannot silently hide a missing input. Dry-run counters are named `planned`, not `extracted`.

Filing pipelines dedupe shared CIKs and prefer the current ticker over a `_PRE` alias, preventing XOM/XOM_PRE from overwriting one another. An explicitly requested predecessor is still processed when `--only XOM_PRE` is used.

For the XOM_PRE missing-pack case, first check:

```powershell
Test-Path worker/cache/edgar/34088/manifest.json
Test-Path worker/cache/edgar/34088/cohort-pack-v2.json
```

If the manifest exists, build only the missing pack and resume:

```powershell
npx tsx worker/edgar-cohorts.mts --only XOM_PRE --context 32768
npx tsx worker/edgar-cohort-extract.mts --universe research-universe-53.json --dry-run
```

If the manifest is absent, restore primary documents first:

```powershell
npx tsx worker/edgar-fetch.mts --only XOM_PRE
npx tsx worker/edgar-exhibits.mts --only XOM_PRE
npx tsx worker/edgar-cohorts.mts --only XOM_PRE --context 32768
```

PowerShell `ParserError` lines after a Node stack trace are shell interpretation of pasted error text, not additional application failures. Do not execute the stack-trace lines as commands.
