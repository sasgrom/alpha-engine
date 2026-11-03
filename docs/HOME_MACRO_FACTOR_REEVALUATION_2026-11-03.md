# Домашние Macro Event Study, Transmission Atlas и first-vintage factor reevaluation

- Дата составления: 2026-11-03T21:51:02Z.
- Основной evidence interval: 2026-11-03T10:34:15Z–10:52:01Z.
- Baseline Git: `5a1ec4141089cd394bdd4ca6ff4ea4639ef4feed` (`5a1ec41`, `Subscribe before live prompt`).
- Рабочая директория: `C:\dev\alpha-engine`.
- Macro archive: `D:\research\alpha-engine\macro`.
- Research universe: `research-universe-51.json`.

## Резюме

Выполнены реальные домашние runs OFAC, Macro Manifest QA, Macro Event Study, Macro Transmission Atlas, factor rematerialization, cross-sectional factor-IC и три независимые research evaluation. Все итоговые проверки TypeScript, 113 test files / 613 tests, production build и финальный локальный file-readiness gate завершились успешно.

Главные результаты:

- FRED refresh не начал collection: в shell отсутствует `FRED_API_KEY`. Существующий архив содержит 20/20 complete series и проходит QA; это не свежий FRED capture за 2026-11-03.
- OFAC capture успешен: 47 событий, 0 новых; QA `pass`, 0 errors / 0 warnings.
- Event Study: `ready`, 47 eligible events, 47 with baseline, 46 with any outcome, discovery/OOS 32/15.
- Transmission Atlas: `partial`, 1 462 records, 24 studies; 6 estimated pilot, 18 insufficient coverage, только 2 OOS evaluations.
- Factor rematerialization: 51 companies, 21 439 factor points, 0 failed CIKs; current-universe coverage 51/51.
- Pre/post first-vintage IC comparison: 2 900 → 2 840 rows; 720 rows изменили `n`, 1 329 — Spearman, 202 — знак.
- AssetGrowth mean quarterly Spearman снизился с 0,2313 до 0,2219 на 63d и с 0,1942 до 0,1802 на 126d.
- 126d final-holdout vol-target CI95 теперь включает ноль: +4,69% `[-0,75%; +9,65%]` против исторических +5,40% `[+0,62%; +9,76%]`.
- Production apply/deploy, migrations, cloud collection, credential inspection, schema changes, `db:push`, reset/stash и force operations не выполнялись.

**Вывод ограничивается изменением исследовательских оценок. Repaired alpha, investable alpha и production promotion не доказаны.**

## 1. Scope и соблюдение ограничений

| Область | Фактическое действие |
|---|---|
| Source code | Не изменялся. |
| Schema / migrations | Не изменялись и не запускались. |
| Credentials | Не читались, не выводились, не ротировались; зафиксировано только отсутствие FRED key в shell. |
| Production | Никаких apply, deploy, production collection или production URLs в командах. |
| Локальная БД | Только запрошенная замена `factor_points` через существующий materializer; research evaluations read-only. |
| D: macro archive | Существующий FRED archive прочитан; OFAC raw/normalized/manifest обновлены штатным collector. |
| Generated evidence | Основные копии и SHA256 index находятся в ignored `worker/.runs`. |
| Git | Без reset, stash, hard reset, force-push; pre-existing generated modifications не включались в документационный delivery. |
| Параметры research | Universes, thresholds, protocols и bootstrap settings не изменялись; лучший результат не выбирался. |

## 2. Начальное состояние и последовательность команд

Перед collectors прочитаны `docs/LLM_CONTEXT.md`, `docs/OPERATIONS.md`, `docs/MACRO_DATA.md` и `docs/KIMI_CODE_HANDOFF.md`. Исторические `NOW` и test counts использовались только как исторические данные; текущее состояние установлено через Git и новые runs.

Начальный `git status --short --branch`:

```text
## main...origin/main [behind 1]
 M public/reports/schwab-context.json
```

Из-за dirty tree `git pull --rebase origin main` не выполнялся. Reset/stash не применялись. Входящий коммит `272463a` менял только `docs/ALPHA_COMMANDS.jsonl` и не пересекался с локальным Schwab diff. Scheduler был online, `current=null`, queue пуста, поэтому ручной Macro Ops не дублировал активный collector.

### 2.1. Command ledger

| Команда / действие | Результат | Evidence |
|---|---|---|
| `git status --short --branch` | Успешно; обнаружен pre-existing dirty generated report и behind 1. | Раздел 2. |
| `npm install --no-audit --no-fund` | Успешно, `up to date`; manifest не изменён. | Console evidence. |
| `npx tsx worker/macro-fred-fetch.mts --group all` | **Exit 1 до collection**: отсутствует `FRED_API_KEY`; повтор не выполнялся. | `20261103T103415Z-macro-fred-fetch.log`. |
| `npx tsx worker/macro-events-fetch.mts --pages 1` | Успешно; 47 events, 0 new. | `20261103T103529Z-macro-events-fetch.log`. |
| `npx tsx worker/macro-manifest-qa.mts` | Успешно; `pass`, 0 errors, 0 warnings. | `20261103T103539Z-macro-manifest-qa.log`, timestamped QA JSON. |
| `npx tsx scripts/build-macro-event-study.mts --macro-root D:\research\alpha-engine\macro` | Успешно; `ready`, 188 observations. | `20261103T103643Z-macro-event-study.log`. |
| `npx tsx scripts/build-macro-transmission-atlas.mts` | Успешно; research status `partial`, 1 462 records / 24 studies. | `20261103T103655Z-macro-transmission-atlas.log`. |
| `npx tsx scripts/build-daily-operations-report.mts --macro-root D:\research\alpha-engine\macro` | Builder успешен; health status `critical`. | `20261103T103930Z-daily-operations-report.log`. |
| Baseline `crossSectionFactorIc()` через исходный `npx tsx -e '... await ...'` | **Exit 1 до вызова функции**: CJS top-level-await limitation. | Зафиксировано в handoff; JSON затем перезаписан успешным baseline. |
| Baseline `crossSectionFactorIc()` через async IIFE | Успешно, defaults не изменены. | `factor-ic-before-rematerialization.json`. |
| `npx tsx scripts/materialize-research-factors.mts --universe research-universe-51.json --only AAPL` | Успешно; 545 points, 0 failed. | `20261103T104127Z-materialize-research-factors-smoke-aapl.log`. |
| `npx tsx scripts/materialize-research-factors.mts --universe research-universe-51.json` | Успешно; 51 companies / 21 439 points / 0 failed. | `20261103T104142Z-materialize-research-factors-full.log`. |
| `npx tsx scripts/check-factor-coverage.mts` | Успешно; только XOM/XOM_PRE вне current universe. | `check-factor-coverage.json`. |
| Post-run `crossSectionFactorIc()` через async IIFE | Успешно; полный JSON сохранён. | `factor-ic-reevaluation.json`. |
| `npx tsx scripts/macro-validation.mts` | Exit 0. | `macro-validation.json`. |
| `npx tsx scripts/sector-portfolio-eval.mts` | Exit 0. | `sector-portfolio-eval.json`. |
| `npx tsx scripts/sector-vol-target-eval.mts` | Exit 0. | `sector-vol-target-eval.json`. |
| `npx tsx scripts/production-readiness.mts` | Первый и финальный runs: `ready`, `missing=[]`. | `production-readiness.log` содержит финальный run. |
| Промежуточный readiness после удаления untracked public macro reports | `missing`: после successful QA эти standard-path reports обязательны. Exact evidence copies восстановлены; builders не повторялись. | Зафиксировано в handoff и разделе 11.2. |
| `npm run check` | Успешно. | TypeScript gate. |
| `npm test -- --run` | 113 files / 613 tests passed. | Test gate. |
| `npm run build` | Успешно; только установленные chunk-size warnings. | Build gate. |
| `git diff --check` | Успешно; whitespace errors нет. | Финальная проверка. |

## 3. FRED / OFAC coverage и manifest QA

### 3.1. FRED manifest

Manifest generated at `2026-11-02T07:47:01.003Z`; все 20 series имеют `status=complete`, `error=null`. Ниже — фактические последние captures из существующего архива, а не результат failed refresh.

| Series | Group | Status | Captured at | Rows | Last observation | Last vintage |
|---|---|---|---|---:|---|---|
| BAMLC0A0CM | credit | complete | 2026-11-02T06:18:20.502Z | 1 726 | 2026-10-29 | 2026-10-29 |
| BAMLH0A0HYM2 | credit | complete | 2026-11-02T06:18:26.299Z | 1 725 | 2026-10-29 | 2026-10-29 |
| CPIAUCSL | inflation | complete | 2026-11-02T06:18:47.207Z | 5 774 | 2026-09-01 | 2026-10-14 |
| CPILFESL | inflation | complete | 2026-11-02T06:19:20.921Z | 5 678 | 2026-09-01 | 2026-10-14 |
| DCOILBRENTEU | oil | complete | 2026-11-02T06:15:47.900Z | 81 514 | 2026-10-27 | 2026-10-28 |
| DCOILWTICO | oil | complete | 2026-11-02T06:15:24.100Z | 81 528 | 2026-10-27 | 2026-10-28 |
| DFF | rates | complete | 2026-11-02T06:11:37.478Z | 132 509 | 2026-10-29 | 2026-10-30 |
| DGS10 | rates | complete | 2026-11-02T06:07:27.022Z | 7 260 | 2026-10-29 | 2026-10-30 |
| DGS2 | rates | complete | 2026-11-02T06:09:16.791Z | 94 620 | 2026-10-29 | 2026-10-30 |
| DGS30 | rates | complete | 2026-11-02T06:09:46.519Z | 94 610 | 2026-10-29 | 2026-10-30 |
| DTWEXBGS | usd | complete | 2026-11-02T06:17:17.228Z | 53 124 | 2026-10-23 | 2026-10-26 |
| GDP | growth | complete | 2026-11-02T07:46:27.188Z | 2 439 | 2026-07-01 | 2026-10-29 |
| GDPC1 | growth | complete | 2026-11-02T07:45:53.415Z | 2 493 | 2026-07-01 | 2026-10-29 |
| MORTGAGE30US | rates | complete | 2026-11-02T06:12:59.290Z | 16 843 | 2026-10-29 | 2026-10-29 |
| PAYEMS | labor | complete | 2026-11-02T06:41:18.283Z | 8 303 | 2026-09-01 | 2026-10-02 |
| PCEPI | inflation | complete | 2026-11-02T06:19:54.812Z | 7 654 | 2026-09-01 | 2026-10-29 |
| PCEPILFE | inflation | complete | 2026-11-02T06:20:29.321Z | 7 653 | 2026-09-01 | 2026-10-29 |
| SOFR | rates | complete | 2026-11-02T06:11:26.756Z | 10 904 | 2026-10-29 | 2026-10-30 |
| T10Y2Y | rates | complete | 2026-11-02T06:11:08.434Z | 71 172 | 2026-10-30 | 2026-10-30 |
| UNRATE | labor | complete | 2026-11-02T06:41:52.159Z | 4 783 | 2026-09-01 | 2026-10-02 |

Ограничение credit history сохранено: с April 2026 FRED предоставляет только три года наблюдений по соответствующим ICE BofA series. Никакого retrospective backfill из неавторизованного источника не выполнялось.

### 3.2. OFAC

- Collector завершился `2026-11-03T10:35:32.076Z`.
- Recent Actions page 0: 10 parsed events.
- Accumulated normalized history: 47 events.
- New events: 0.
- Raw page SHA256: `cb461a75d4dceca34e3ee2e2b9338617ad5ce4a2e6f1ae63c1d00821ca984909`.
- Coverage остаётся incremental forward history, а не полным OFAC archive.
- `effectiveAt` и intraday timestamps не выдумывались.

### 3.3. Manifest QA

Исходный run QA зафиксирован `2026-11-03T10:35:55.374Z`:

```json
{
  "status": "pass",
  "errors": 0,
  "warnings": 0,
  "issues": []
}
```

Позже scheduler перезаписал mutable `worker/.runs/macro-manifest-qa.json` новым QA. Для неизменяемой lineage исходный результат восстановлен из run summary как `macro-manifest-qa-20261103T103555Z.json`; его SHA256 совпал с первоначальным index hash. Все 23 indexed evidence files затем повторно прошли hash verification.

## 4. Macro Event Study

Artifact: `worker/.runs/macro-event-study.json`, generated at `2026-11-03T10:36:45.055Z`, `dataMode=live`, `status=ready`.

### 4.1. Зафиксированный протокол

- Только first-release observation на economic period; revisions не подставляются.
- Event должен удовлетворять `publishedAt`, `researchEligibleAt`, `ingestedAt <= asOf`.
- Baseline обязан быть известен на event eligibility.
- Outcomes начинаются на первый observation day после publication day.
- DGS10 и BAMLH0A0HYM2: decimal absolute differences; DCOILWTICO и DTWEXBGS: log returns.
- Chronological split: earliest 70% discovery / latest 30% OOS.
- Minimum 5 observations на split; 500 moving-block bootstrap replicates, block length ≤3.
- Horizons: 1 / 5 / 21 / 63 observations.

Coverage: total 47, eligible 47, with baseline 47, with any observation 46, discovery 32, OOS 15. `ready` обозначает coverage, не directional forecast.

### 4.2. Полные summary-результаты

Значения округлены для читаемости; точные double values и per-event vintage IDs находятся в JSON. `—` означает, что summary не сформировано по protocol gate.

| Series | Horizon | Split | n | Mean | Median | CI95 mean |
|---|---:|---|---:|---:|---:|---:|
| DGS10 | 1 | discovery | 32 | 0.000246875 | 0.000300000 | [-0.000034375; 0.000537500] |
| DGS10 | 1 | OOS | 14 | -0.000221429 | -0.000100000 | [-0.000507143; 0.000057143] |
| DGS10 | 5 | discovery | 32 | 0.000828125 | 0.000400000 | [0.000309375; 0.001353125] |
| DGS10 | 5 | OOS | 11 | -0.000990909 | -0.000800000 | [-0.001309091; -0.000663636] |
| DGS10 | 21 | discovery | 31 | 0.002170968 | 0.001800000 | [0.000864516; 0.003383871] |
| DGS10 | 21 | OOS | — | — | — | — |
| DGS10 | 63 | discovery | 5 | 0.003280000 | 0.003100000 | [0.002940000; 0.003620000] |
| DGS10 | 63 | OOS | — | — | — | — |
| DCOILWTICO | 1 | discovery | 32 | 0.002549027 | 0.007954998 | [-0.019968737; 0.021105947] |
| DCOILWTICO | 1 | OOS | 12 | 0.027299478 | 0.025543780 | [-0.002882076; 0.061954043] |
| DCOILWTICO | 5 | discovery | 32 | 0.012811265 | 0.007954998 | [-0.027565211; 0.054837476] |
| DCOILWTICO | 5 | OOS | 10 | 0.059624826 | 0.032248402 | [0.034998537; 0.090815041] |
| DCOILWTICO | 21 | discovery | 30 | 0.071527708 | 0.067724030 | [0.042094455; 0.101805031] |
| DCOILWTICO | 21 | OOS | — | — | — | — |
| DCOILWTICO | 63 | discovery/OOS | — | — | — | — |
| DTWEXBGS | 1 | discovery | 32 | 0.000862358 | 0.001006507 | [-0.002418726; 0.003716546] |
| DTWEXBGS | 1 | OOS | 11 | 0.001006587 | -0.000271413 | [-0.001205000; 0.003789006] |
| DTWEXBGS | 5 | discovery | 32 | 0.002009248 | 0.000088085 | [-0.002275872; 0.007513248] |
| DTWEXBGS | 5 | OOS | 9 | 0.001042992 | -0.000494418 | [-0.002358904; 0.005114838] |
| DTWEXBGS | 21 | discovery | 28 | 0.007550331 | 0.015005669 | [-0.003135729; 0.019664326] |
| DTWEXBGS | 21 | OOS | — | — | — | — |
| DTWEXBGS | 63 | discovery/OOS | — | — | — | — |
| BAMLH0A0HYM2 | 1 | discovery | 32 | 0.000084375 | 0.000000000 | [-0.000103125; 0.000290625] |
| BAMLH0A0HYM2 | 1 | OOS | 14 | 0.000007143 | -0.000200000 | [-0.000321429; 0.000300000] |
| BAMLH0A0HYM2 | 5 | discovery | 32 | 0.000253125 | -0.000100000 | [-0.000278125; 0.000981250] |
| BAMLH0A0HYM2 | 5 | OOS | 11 | 0.000454545 | 0.000200000 | [-0.000245455; 0.001163636] |
| BAMLH0A0HYM2 | 21 | discovery | 32 | 0.001931250 | 0.001300000 | [0.000446875; 0.003493750] |
| BAMLH0A0HYM2 | 21 | OOS | — | — | — | — |
| BAMLH0A0HYM2 | 63 | discovery | 6 | 0.004800000 | 0.004800000 | [0.004166667; 0.005433333] |
| BAMLH0A0HYM2 | 63 | OOS | — | — | — | — |

Наблюдаемые discovery/OOS различия, включая смену знака DGS10, не интерпретировались как trading signal или подтверждённый causal effect.

## 5. Macro Transmission Atlas

Artifact: `worker/.runs/macro-transmission-atlas.json`, generated at `2026-11-03T10:38:39.294Z`, `asOf=2026-11-03T10:36:45.055Z`, `dataMode=live`, `status=partial`.

### 5.1. Метод и coverage

Atlas использует 50 companies и 188 macro observations. Exposure пересчитывается на каждый event eligibility только из available, non-stale SEC evidence. Debt burden — balance-sheet proxy, не floating-rate share. Модель: intercept + shock + exposure + shock×exposure + sector fixed effects. Discovery coefficients заморожены для OOS; OOS не переобучается. Market-model OLS использует 120 estimation returns, minimum 60, SPY benchmark и post-close availability.

Gates: minimum 30 rows / 10 events / 5 companies и full-rank design. `pilot`: 5–19 companies или 10–29 events; `full_sample`: ≥20 companies и ≥30 events. Interaction CI95: 500 event-cluster bootstrap replicates, block length ≤3.

| Coverage field | Count |
|---|---:|
| Candidate pairs | 14 100 |
| Exposure missing | 10 810 |
| Exposure partial | 2 110 |
| Exposure stale | 465 |
| Price missing | 132 |
| Shock missing | 870 |
| Records used | 1 462 |
| Studies total | 24 |
| Estimated / pilot | 6 |
| Insufficient coverage | 18 |
| Full sample | 0 |
| OOS evaluations present | 2 |

### 5.2. Все studies

`β3` — shock×exposure interaction, не автоматически causal effect. CI и R² округлены; `—` означает отсутствие estimate/OOS.

| Series | Exposure | Horizon | Status | Coverage | Discovery rows / companies / events | β3 | CI95 β3 | OOS R² vs discovery mean |
|---|---|---:|---|---|---|---:|---:|---:|
| DGS10 | debt_burden | 1 | estimated | pilot | 185 / 8 / 32 | 0.101867 | [-0.527240; 0.518497] | -0.040850 |
| DGS10 | debt_burden | 5 | estimated | pilot | 185 / 8 / 32 | 0.340086 | [-0.842901; 1.541578] | — |
| DGS10 | debt_burden | 21 | estimated | pilot | 161 / 8 / 29 | -0.393306 | [-1.779068; 1.204296] | — |
| DGS10 | debt_burden | 63 | insufficient_coverage | — | — | — | — | — |
| DCOILWTICO | fuel_cost | 1 / 5 / 21 / 63 | insufficient_coverage | — | — | — | — | — |
| DCOILWTICO | oil_revenue | 1 / 5 / 21 / 63 | insufficient_coverage | — | — | — | — | — |
| DCOILWTICO | oil_cost | 1 / 5 / 21 / 63 | insufficient_coverage | — | — | — | — | — |
| DTWEXBGS | foreign_revenue | 1 / 5 / 21 / 63 | insufficient_coverage | — | — | — | — | — |
| BAMLH0A0HYM2 | debt_burden | 1 | estimated | pilot | 185 / 8 / 32 | 0.814761 | [-0.408137; 2.036673] | -0.064934 |
| BAMLH0A0HYM2 | debt_burden | 5 | estimated | pilot | 185 / 8 / 32 | 0.629898 | [-0.757295; 1.721853] | — |
| BAMLH0A0HYM2 | debt_burden | 21 | estimated | pilot | 161 / 8 / 29 | 1.428822 | [0.755562; 2.129504] | — |
| BAMLH0A0HYM2 | debt_burden | 63 | insufficient_coverage | — | — | — | — | — |

Объединённые строки oil/USD представляют 16 отдельных insufficient studies: 4 fuel_cost + 4 oil_revenue + 4 oil_cost + 4 foreign_revenue. Вместе с DGS10-63 и HY-63 это 18 insufficient studies.

Для DGS10-1 OOS: 103 rows / 11 companies / 11 events, MAE 0.018250, RMSE 0.023958, R² -0.040850. Для HY-1 OOS R² -0.064934. У DGS10-5/21 и HY-5/21 указано `OOS gate was not met`. HY-21 discovery CI не включает ноль, но OOS отсутствует; это не независимое подтверждение transmission или alpha.

## 6. Daily Operations health

Report generated at `2026-11-03T10:39:31.973Z`, UTC date 2026-11-03.

| Показатель | Результат |
|---|---|
| Overall status | `critical` |
| Scheduler | `online`, heartbeat `2026-11-03T10:39:25.815Z`, current job `null`, queue 0 |
| Schwab captured today / expected | **51 / 51** |
| Readable latest chains | 51 / 51 |
| Contracts | 122 218 |
| Latest Schwab capture | `2026-11-03T00:10:50.992Z` |
| Schwab manifest errors | 0 |
| Feature Lab lineage | Source hash совпадает |
| Schwab context | 58 / 58 endpoints, 0 errors |
| FRED health | 20 / 20 complete, manifest age 26.9h, допустимо для weekly schedule |
| OFAC health | 47 events, свежий capture |
| Macro QA | `pass` |
| Macro derivedCurrent | `false` |
| Checks OK / warning / error / pending | **13 / 1 / 2 / 20** |
| Jobs done / failed today на момент report | 6 / 0 |

Error checks:

1. `macro-scenario-lineage`: report `2026-11-02T23:02:28.720Z` предшествует текущему QA.
2. `macro-calibration-lineage`: report `2026-11-02T23:02:20.787Z` предшествует текущему QA; 4/4 calibrations ready, но lineage stale.

Warning: `macro-atlas-lineage` — current with QA, но `partial`, 1 462 records. Event Study lineage `ok`: current with QA, 46/47 events имеют outcomes. Незапрошенные Scenario/Calibration builders не запускались для сокрытия этих findings.

## 7. Factor rematerialization

### 7.1. Smoke и полный run

AAPL smoke завершился с 545 points и 0 failed. Полный run затем атомарно заменил factor rows для каждой из 51 companies через существующий `materializeFactorPoints`: research values из `computeCompanyFactors(cik, "first")`, availability — MAX(first-filed) по точным required concepts и lookback/TTM periods; batch inserts ≤500.

Итог: **51 companies, 21 439 factor points, 0 failed CIKs**.

| Ticker | Factor points | Ticker | Factor points |
|---|---:|---|---:|
| NVDA | 512 | CAT | 411 |
| AMD | 549 | AMT | 433 |
| INTC | 471 | JPM | 376 |
| PLTR | 318 | KMI | 475 |
| META | 439 | AAPL | 545 |
| NFLX | 540 | IBM | 442 |
| AMZN | 502 | LMT | 477 |
| TSLA | 536 | T | 389 |
| NKE | 447 | GOOGL | 406 |
| LULU | 497 | JNJ | 502 |
| RCL | 395 | PG | 367 |
| GS | 394 | WMT | 400 |
| COF | 432 | CVX | 362 |
| UNH | 437 | MA | 357 |
| PFE | 379 | V | 212 |
| FCX | 316 | COST | 494 |
| BA | 465 | AIG | 397 |
| PLD | 458 | COP | 362 |
| NEE | 430 | LIN | 368 |
| MSFT | 510 | RIVN | 296 |
| AVGO | 350 | ENLT | 67 |
| ANET | 450 | MU | 540 |
| SMCI | 486 | FSLR | 555 |
| MRNA | 307 | LLY | 366 |
| DAL | 415 | DASH | 270 |
| HD | 535 | — | — |

### 7.2. Coverage gate

`check-factor-coverage.mts` сообщил:

- universe companies: 51;
- fact companies: 53;
- factor companies: 51;
- missing CIK `34088` (`XOM_PRE`), `inCurrentUniverse=false`;
- missing CIK `2115436` (`XOM`), `inCurrentUniverse=false`.

Текущая universe покрыта полностью. XOM/XOM_PRE специально не считались ошибкой; никакого silent entity merge не выполнялось.

## 8. Cross-sectional factor-IC: direct pre/post comparison

Baseline был снят до AAPL smoke и полного rematerialization; post-run использовал ту же функцию `crossSectionFactorIc()` без `requestedCiks`. Исходный `npx tsx -e` с top-level await не поддержался CJS transform, поэтому оба фактических вызова выполнены через async IIFE без изменения function arguments или evaluation logic.

В raw output поле `quarter` формируется implementation как `filedAt.slice(0,7)`, то есть YYYY-MM anchor key. Для каждого factor/horizon ниже:

- `observations` — сумма `n` по rows;
- `mean` — невзвешенное среднее Spearman по rows, где Spearman не `null`;
- `n-weighted` — среднее Spearman с весом `n`;
- это descriptive comparison без нового bootstrap CI и без выбора лучшего фактора.

Aggregate comparison:

| Metric | Before | After | Delta / count |
|---|---:|---:|---:|
| Raw IC rows | 2 900 | 2 840 | -60 |
| Added keys | — | — | 4 |
| Removed keys | — | — | 64 |
| Rows with changed `n` | — | — | 720 |
| Rows with changed Spearman | — | — | 1 329 |
| Rows with Spearman sign flip | — | — | 202 |

Полный factor/horizon comparison:

| Factor | Horizon | Observations before → after | Mean before → after | Δ mean | n-weighted before → after |
|---|---:|---:|---:|---:|---:|
| accruals | 63 | 2 304 → 2 261 | -0.0041 → -0.0140 | -0.0099 | -0.0165 → -0.0179 |
| accruals | 126 | 2 261 → 2 220 | -0.0057 → -0.0118 | -0.0061 | -0.0460 → -0.0415 |
| assetGrowth | 63 | 2 495 → 2 520 | 0.2313 → 0.2219 | -0.0094 | 0.1802 → 0.1739 |
| assetGrowth | 126 | 2 444 → 2 471 | 0.1942 → 0.1802 | -0.0141 | 0.2168 → 0.2087 |
| bookToMarket | 63 | 785 → 778 | 0.0889 → 0.0912 | +0.0023 | 0.0318 → 0.0375 |
| bookToMarket | 126 | 741 → 736 | 0.1055 → 0.1114 | +0.0059 | 0.0715 → 0.0825 |
| buybackYield | 63 | 1 379 → 1 377 | -0.1295 → -0.1222 | +0.0073 | -0.1315 → -0.1294 |
| buybackYield | 126 | 1 350 → 1 349 | -0.1535 → -0.1475 | +0.0061 | -0.1880 → -0.1827 |
| earningsYield | 63 | 872 → 862 | 0.0096 → 0.0419 | +0.0323 | 0.0065 → 0.0328 |
| earningsYield | 126 | 823 → 815 | 0.0373 → 0.0935 | +0.0562 | 0.0300 → 0.0805 |
| evEbit | 63 | 508 → 493 | -0.0347 → -0.0580 | -0.0233 | -0.0558 → -0.0693 |
| evEbit | 126 | 479 → 464 | -0.0398 → -0.1017 | -0.0620 | -0.0553 → -0.1003 |
| evEbitda | 63 | 346 → 326 | 0.0000 → -0.0619 | -0.0619 | -0.0117 → -0.0563 |
| evEbitda | 126 | 327 → 307 | -0.1187 → -0.1675 | -0.0488 | -0.0855 → -0.1389 |
| fcfYield | 63 | 692 → 686 | -0.0027 → -0.0133 | -0.0106 | -0.0037 → -0.0041 |
| fcfYield | 126 | 654 → 649 | 0.0132 → 0.0334 | +0.0202 | 0.0267 → 0.0449 |
| grossProfitability | 63 | 1 121 → 1 079 | -0.0177 → -0.0560 | -0.0383 | 0.0040 → -0.0355 |
| grossProfitability | 126 | 1 102 → 1 060 | 0.0210 → -0.0099 | -0.0309 | 0.0718 → 0.0363 |
| high52 | 63 | 2 280 → 2 280 | -0.0177 → -0.0167 | +0.0009 | -0.0175 → -0.0165 |
| high52 | 126 | 2 127 → 2 127 | 0.0091 → 0.0026 | -0.0065 | 0.0094 → 0.0030 |
| momentum122 | 63 | 2 280 → 2 280 | -0.0005 → -0.0069 | -0.0064 | 0.0001 → -0.0062 |
| momentum122 | 126 | 2 127 → 2 127 | 0.0153 → 0.0075 | -0.0079 | 0.0159 → 0.0082 |
| netDebtToEbitda | 63 | 346 → 326 | -0.1316 → -0.1243 | +0.0073 | -0.0927 → -0.0930 |
| netDebtToEbitda | 126 | 327 → 307 | -0.1091 → -0.1471 | -0.0380 | -0.1082 → -0.1298 |
| ocfYield | 63 | 887 → 872 | 0.0519 → 0.0591 | +0.0072 | 0.0380 → 0.0479 |
| ocfYield | 126 | 837 → 824 | 0.1066 → 0.1305 | +0.0239 | 0.0703 → 0.0971 |
| peRatio | 63 | 775 → 768 | 0.0125 → -0.0592 | -0.0717 | 0.0175 → -0.0281 |
| peRatio | 126 | 729 → 724 | -0.0094 → -0.0981 | -0.0887 | 0.0186 → -0.0514 |
| salesYield | 63 | 868 → 846 | 0.0318 → 0.0524 | +0.0206 | 0.0290 → 0.0391 |
| salesYield | 126 | 820 → 799 | 0.0123 → 0.0526 | +0.0403 | 0.0466 → 0.0807 |
| sue | 63 | 2 375 → 2 303 | 0.0491 → 0.0187 | -0.0304 | 0.0540 → 0.0360 |
| sue | 126 | 2 325 → 2 255 | 0.0233 → 0.0122 | -0.0112 | 0.0579 → 0.0591 |

AssetGrowth positive-quarter share также снизилась: 72,67% → 70,00% на 63d и 74,05% → 72,61% на 126d. В то же время observations выросли 2 495 → 2 520 и 2 444 → 2 471. Это не universal deterioration всех factors: например, earningsYield и ocfYield выросли, а peRatio и EV multiples снизились. Правильный вывод — first-vintage correction существенно меняет panel и оценки, а не «чинит alpha» в заданном направлении.

## 9. Независимые evaluations

Все команды завершились с exit 0. Параметры, thresholds, universes и protocols не изменялись.

### 9.1. Sector-neutral portfolio

| Horizon | Direction | n | Mean return | CI95 | Max DD | Sharpe |
|---:|---|---:|---:|---:|---:|---:|
| 63 | high asset growth minus low | 131 | +6.487% | [+3.127%; +9.911%] | 71.302% | 0.3327 |
| 63 | low asset growth minus high | 131 | -7.075% | [-10.496%; -3.713%] | 100.000% | -0.3628 |
| 126 | high asset growth minus low | 129 | +12.811% | [+6.468%; +19.243%] | 99.460% | 0.3344 |
| 126 | low asset growth minus high | 129 | -13.398% | [-19.823%; -7.055%] | 100.000% | -0.3497 |

High-minus-low сохраняет положительный mean CI, но maxDD 71,3% / 99,5% и потеря всего капитала противоположным направлением не дают основания называть стратегию investable. Raw compounded `totalReturn` также сохранён в JSON и не использовался для отбора результата.

### 9.2. Sector volatility-target chronological segments

| Horizon / segment | Baseline mean [CI95] | Vol-target mean [CI95] | Max DD baseline → vol | Raw total return baseline → vol |
|---|---|---|---:|---:|
| 63 / development | +8.975% [+5.651%; +12.611%] | +3.332% [+1.881%; +4.682%] | 29.354% → 22.840% | 346.0248 → 9.3324 |
| 63 / validation | -0.529% [-6.549%; +5.651%] | +1.125% [-2.761%; +5.567%] | 71.302% → 39.739% | -0.3195 → +0.1661 |
| 63 / final-holdout | +6.057% [-1.689%; +16.653%] | +1.342% [-1.620%; +4.839%] | 55.764% → 36.346% | +1.4923 → +0.2502 |
| 126 / development | +16.222% [+9.617%; +23.271%] | +4.619% [+2.824%; +6.424%] | 83.031% → 24.412% | 7 121.7553 → 23.8073 |
| 126 / validation | -2.712% [-11.892%; +7.327%] | -1.126% [-4.105%; +2.002%] | 91.663% → 52.945% | -0.7432 → -0.3024 |
| 126 / final-holdout | +18.232% [+2.121%; +36.122%] | +4.688% [-0.751%; +9.655%] | 98.678% → 41.115% | -0.5363 → +1.3793 |

Vol targeting снижает drawdown, но это risk-control evidence, не гарантия positive return alpha. Raw total return и mean могут расходиться из-за path/compounding; оба сохранены без сглаживания.

### 9.3. Independent universe и leave-one-sector-out final holdout

| Universe / sector | Companies | Baseline mean | Vol-target mean | Vol-target CI95 | Max DD baseline → vol |
|---|---:|---:|---:|---:|---:|
| odd | 25 | +0.623% | +0.712% | [-0.529%; +1.986%] | 19.724% → 16.451% |
| even | 25 | -0.925% | -0.610% | [-3.185%; +1.749%] | 62.102% → 50.183% |
| Consumer Discretionary | 7 | +4.834% | +3.775% | [+1.046%; +6.291%] | 28.305% → 23.930% |
| Financials | 6 | -0.626% | -0.464% | [-5.055%; +3.588%] | 51.231% → 44.500% |
| Health Care | 5 | -12.961% | -4.618% | [-9.657%; +0.233%] | 100.000% → 78.650% |
| Information Technology | 11 | -0.729% | +0.283% | [-2.515%; +2.919%] | 83.589% → 44.277% |

Communication Services, Consumer Staples и Energy имеют 3 / 3 / 4 companies и помечены `insufficient for quintiles`; они не были удалены для улучшения картины.

### 9.4. Pre-registered macro regimes

| Kind | Regime | n | Baseline mean | Baseline CI95 | Vol-target mean | Vol-target CI95 |
|---|---|---:|---:|---:|---:|---:|
| VIX | high | 12 | -0.193% | [-5.099%; +4.006%] | -0.463% | [-2.196%; +1.071%] |
| VIX | low | 123 | +11.394% | [+7.429%; +15.643%] | +4.316% | [+2.808%; +5.761%] |
| VIX | mid | 24 | -0.532% | [-5.014%; +4.758%] | +0.294% | [-2.257%; +3.600%] |
| Curve | inversion | 25 | +3.953% | [-2.234%; +9.694%] | +2.395% | [-0.970%; +5.501%] |
| Curve | normal | 134 | +9.597% | [+5.735%; +13.602%] | +3.525% | [+2.098%; +4.949%] |
| HY | mid | 1 | +6.575% | [+6.575%; +6.575%] | +3.851% | [+3.851%; +3.851%] |
| HY | tight | 29 | +11.240% | [+1.632%; +23.873%] | +3.968% | [+0.742%; +7.280%] |
| SPY trend | above200dma | 135 | +10.407% | [+6.759%; +14.518%] | +3.823% | [+2.469%; +5.175%] |
| SPY trend | below200dma | 24 | -0.807% | [-5.991%; +4.471%] | +0.661% | [-2.589%; +5.064%] |

HY mid имеет только n=1 и не интерпретируется. Положительные risk-on intervals не использовались для добавления regime gate на том же sample.

## 10. Подтверждённые расхождения со старыми результатами

Сравнение ниже разделяет direct pre/post IC и исторические записи старого research state. Исторические цифры взяты из `docs/LLM_CONTEXT.md`; новые — из свежих raw artifacts при неизменных scripts/protocols.

| Метрика | Исторический результат | Новый результат | Подтверждённое отличие |
|---|---|---|---|
| 126d final-holdout vol-target mean / CI95 | +5.40% `[+0.62%; +9.76%]` (`LLM_CONTEXT.md:26`) | +4.69% `[-0.75%; +9.65%]` | CI теперь включает ноль; прежняя robustness не подтверждена. |
| 126d final-holdout total return / maxDD | baseline -51.2% / 98.9%; vol +200.8% / 31.7% | baseline -53.63% / 98.68%; vol +137.93% / 41.11% | Доходность и drawdown изменились; risk reduction сохранился, но слабее. |
| 63d final-holdout total return | baseline +84.5%; vol +39.7% | baseline +149.23%; vol +25.02% | Существенное расхождение после rematerialization. |
| Sector high-minus-low mean 63d | +3.58% (`LLM_CONTEXT.md:27`) | +6.49%, CI `[+3.13%; +9.91%]` | Mean вырос, maxDD остаётся 71.3%. |
| Sector high-minus-low mean 126d | +11.15% | +12.81%, CI `[+6.47%; +19.24%]` | Mean вырос, maxDD 99.5%. |
| IT final-holdout vol-target | -1.3% (`LLM_CONTEXT.md:25`) | +0.283%, CI `[-2.515%; +2.919%]` | Знак изменился, CI включает ноль. |
| Health Care final-holdout vol-target | -3.1% | -4.618%, CI `[-9.657%; +0.233%]` | Результат хуже, CI включает ноль. |
| Odd / even final-holdout vol-target | +0.2% / -1.5% | +0.712% / -0.610% | Оба значения изменились; оба CI включают ноль. |

Эти расхождения не объясняются субъективным выбором другого варианта: независимые scripts были запущены с defaults. Для IC direct pre/post comparison является более строгим доказательством влияния rematerialization; исторические portfolio comparisons дополнительно включают изменение доступных данных со времени старого run.

## 11. Verification и readiness

### 11.1. Финальные gates

| Gate | Результат |
|---|---|
| `production-readiness.mts` | Финальный `ready`, `missing=[]`; optional shock calibration, event study, Atlas и production bundle `present=true`. |
| `npm run check` | Успешно, `tsc -b`. |
| `npm test -- --run` | **113 test files passed, 613 tests passed**, 0 failed. |
| `npm run build` | Успешно; Vite 2 572 modules, `dist/boot.js` собран. |
| Build warnings | Только известные chunk-size warnings, включая большой Expectations chunk; build не завершился ошибкой. |
| Test warnings | Не-fatal Recharts width/height warning в Analytics test; все tests passed. |
| `git diff --check` | Успешно; whitespace errors нет. LF/CRLF warning для pre-existing Schwab report не является failure. |

`production-readiness=ready` — локальный file gate, а не подтверждение alpha, operational health или разрешение production apply. Daily Operations на исходном cutoff оставался `critical`, Atlas — `partial`.

### 11.2. Промежуточный readiness failure и восстановление

После первого successful readiness четыре новых untracked public macro reports были временно удалены после копирования в `worker/.runs`. Повторный readiness вернул `status=missing` для Event Study и Atlas: после successful macro QA эти standard-path reports становятся обязательными. Это было не исследовательской ошибкой и не исправлялось повторными builders.

Точные копии были восстановлены из `worker/.runs`, побайтовое сравнение подтвердило совпадение, финальный readiness снова вернул `ready`, `missing=[]`. Оба результата зафиксированы; failure не скрыт.

### 11.3. Evidence integrity

`home-research-evidence-index.json` содержит 23 artifacts. После более позднего scheduler QA mutable QA file был заменён в index на timestamped original; финальная проверка: **23/23 hashes match, 0 mismatches**.

| Artifact | Bytes | SHA256 |
|---|---:|---|
| `worker/.runs/20261103T103415Z-macro-fred-fetch.log` | 629 | `dd85815a44fd1d8517c529d8102279b64386a22e3e782bf87680015815ef1710` |
| `worker/.runs/20261103T103529Z-macro-events-fetch.log` | 346 | `51af4b92fcbf0f16eb61b94c1f576182a591dee04fdd418318b99953544ce7f3` |
| `worker/.runs/20261103T103539Z-macro-manifest-qa.log` | 76 | `223f56af716bfceda15d3b0dab6eae150f242632e1f87c02b29dad050dc3365d` |
| `worker/.runs/20261103T103643Z-macro-event-study.log` | 272 | `f3f57287a6ff519c0af1b94dc37aeb7cd9403069d91b02ed1c22cab64227cf9f` |
| `worker/.runs/20261103T103655Z-macro-transmission-atlas.log` | 5 347 | `fbe0cd51fbb4a9d2c955230f677028518abeaff0fcc627df7e50c0e07c95afe7` |
| `worker/.runs/20261103T103930Z-daily-operations-report.log` | 164 | `2c8264c00fbe97f3e0bd11083de3d28c91c5efb53b1e08e67c29418304ec4b4a` |
| `worker/.runs/20261103T104127Z-materialize-research-factors-smoke-aapl.log` | 99 | `cfdc163efd0c06548c0ffe8ea01418bbad0e2f7e2257e90c137d3ae8017e9278` |
| `worker/.runs/20261103T104142Z-materialize-research-factors-full.log` | 2 054 | `9d5795be4d3d59c986651321d5104258f71f498bfd352f7ad67256443fb4a28d` |
| `worker/.runs/check-factor-coverage.json` | 442 | `fe5a7472118426be8332a8afbb83f228ea00d270d86f4bea75d4f0387eff46a2` |
| `worker/.runs/factor-ic-before-rematerialization.json` | 463 861 | `2d774971030012c1d5f5c24b0757cbc191a23c86e678f443cfcb2310636838a9` |
| `worker/.runs/factor-ic-comparison.json` | 28 278 | `37e7bffd81e5e91e5c6be1396ea9907f9e8fabab3ccdf9c91cd1b46df54e8d98` |
| `worker/.runs/factor-ic-reevaluation.json` | 455 055 | `686332589bb8ea1a8429c8a513755374cda5ff0ce4688319e6b4105f69a68c1b` |
| `worker/.runs/independent-evaluation-summary.json` | 22 451 | `7a898207ca251ed165b2bca16ba9221d86a2d0728f3e7cbefe6920b3203aaaec` |
| `worker/.runs/macro-event-study.json` | 267 886 | `c2936f61d2fa8fbe42182fbd0e1c72adf1d4313083ee9e0192c7cc866025fc9c` |
| `worker/.runs/macro-event-study.md` | 2 939 | `390055564516384c8823df37361c615eaf4313997e050943a952c696ae73bf47` |
| `worker/.runs/macro-home-run-summary.json` | 8 590 | `be05383255239a0f0e78b1f3c82f9917add4d854e9f62065cb66bcfbee0fbe40` |
| `worker/.runs/macro-manifest-qa-20261103T103555Z.json` | 177 | `bce2519a03910e0a1864ce09db373577def3a41b9997f35d8310ccaf599f788f` |
| `worker/.runs/macro-transmission-atlas.json` | 733 202 | `2013497ac62029f3acf9392f41b123f8e3198875cf3623d40f50c0b1c89e9802` |
| `worker/.runs/macro-transmission-atlas.md` | 2 458 | `c6a7c1d251f4a7db5c37187e77a75e59a44ec325cdb885464fe0e3b378bafe37` |
| `worker/.runs/macro-validation.json` | 19 168 | `34dd1fa40df812e0aaa90973e246f5ca6b21751bab38851e6ee8ca0ced0ea958` |
| `worker/.runs/production-readiness.log` | 975 | `12736fac1e20b5a81ba0370f9d020e0350f596fadb796a30c5cf391b9ac9204e` |
| `worker/.runs/sector-portfolio-eval.json` | 15 697 | `97329ba57351166220a3c4ff95582b92f3ab1233b536527eeb5eb8bf7e96a862` |
| `worker/.runs/sector-vol-target-eval.json` | 4 642 | `0c37888b03db1185f08606f404d760f863409daba4c07c65c06c70435dafc79a` |

## 12. Фактически произведённые изменения

### 12.1. Локальная БД

- Для каждой из 51 current-universe companies существующий materializer транзакционно заменил `factor_points`.
- Суммарный результат полного run: 21 439 points.
- Другие companies не удалялись и не перезаписывались этим full run.
- XOM и XOM_PRE остались вне текущей universe и в missing list coverage.
- Research evaluations только читали БД.

### 12.2. D: macro archive

- OFAC raw Recent Actions page, normalized events и `manifest-events.json` обновлены штатным collector; accumulated count 47, new 0.
- FRED raw archive не был обновлён failed command: ошибка возникла до HTTP collection.
- Ни один raw response не был перезаписан model-generated substitute.

### 12.3. Локальные generated files

- Созданы real Event Study и Atlas JSON/Markdown, command logs, daily health, IC baseline/reevaluation, independent evaluations, summaries и hash index.
- Основные неизменяемые evidence copies находятся в ignored `worker/.runs`.
- Standard-path macro reports существуют как untracked files в `public/reports` и требуются readiness.
- `npm run build` обновил ignored `dist` output.
- Исходный `public/reports/schwab-context.json` modification не редактировался и не ревертировался.

### 12.4. Документация для Git

Документационный delivery состоит только из:

1. этого отчёта `docs/HOME_MACRO_FACTOR_REEVALUATION_2026-11-03.md`;
2. обновлённого `docs/KIMI_CODE_HANDOFF.md`.

Generated JSON/Markdown reports, `worker/.runs`, raw archives и pre-existing Schwab/Shock Calibration modifications не включаются в документационный commit. Source code и schema не изменялись, поэтому source diff отсутствует.

## 13. Последующие scheduler runs после evidence interval

Эти события не подменяют исходные manual-run artifacts и не включены в его metrics:

- `2026-11-03T13:55:04Z`: scheduled Macro QA завершился успешно; mutable QA file обновлён.
- `13:55:19Z`: scheduler dependency `shock-calibration` завершился exit 0; это объясняет более поздний tracked generated Shock Calibration diff.
- `13:55:34Z`: scheduler Macro Event Study завершился exit 0.
- `13:55:49Z–13:57:41Z`: scheduler Macro Transmission Atlas завершился exit 0.
- `11:00:11Z`: `facts-fetch-daily` завершился ошибкой до collection: `Local server is unavailable on port 3000; start exactly one dev or production server`. Я его не перезапускал и не изменял server state.

Поэтому текущие standard-path generated reports могут быть новее indexed manual-run copies. Отчёт относится к зафиксированному evidence interval; актуальность любого более позднего artifact должна проверяться по его собственному `generatedAt` и lineage.

## 14. Оставшиеся blockers и следующие безопасные действия

### 14.1. Blockers

1. **FRED key:** свежий FRED refresh невозможен до настройки `FRED_API_KEY` в shell. Существующий archive валиден, но не свежий за 2026-11-03.
2. **Git baseline:** ветка была behind 1; pre-existing generated modifications нельзя silently discard, reset или stash.
3. **Исходный daily health:** Scenario/Calibration lineage errors и Atlas warning на 10:39Z; более поздние scheduler runs требуют отдельного fresh health report для текущего статуса.
4. **Facts scheduler:** поздний scheduled facts run остановлен отсутствием local server на port 3000; повтор без проверки server/process state небезопасен.
5. **Atlas coverage:** 18/24 studies insufficient, все 6 estimated только pilot, full_sample=0, OOS только 2.
6. **OFAC coverage:** 47 incremental events, не complete historical archive; day precision не поддерживает intraday claims.
7. **Research robustness:** знаки и IC изменились, 126d vol-target CI включает ноль, independent universes/sectors не универсальны, drawdowns экстремальны.
8. **Credit history:** официальный FRED limitation с тремя годами observations сохраняется; authorized longer history отсутствует.

### 14.2. Следующие безопасные действия в порядке приоритета

1. Настроить `FRED_API_KEY` локально без вывода значения, выполнить один `macro-fred-fetch --group all`, затем Macro QA; при QA `fail` остановить builders и перечислить issues.
2. Перед любым повтором `facts-fetch-daily` подтвердить exactly one reachable local server на port 3000 и отсутствие duplicate scheduler/collector; сам failed log уже указывает deterministic prerequisite failure.
3. Перед будущим data commit отдельно review Schwab/Shock Calibration/generated diffs; не использовать reset/stash для сокрытия unreviewed work.
4. Перестроить daily health для оценки состояния после scheduler runs, не смешивая его с исходным 10:39Z evidence.
5. Для Atlas сначала улучшать источник и coverage exposure; не настраивать parameters ради статистически приятного результата.
6. Не продвигать factor/model/regime gate. Требуются независимые OOS evidence и приемлемый economic risk profile, а не только положительный in-sample mean.
7. Production apply/deploy остаётся отдельным explicit owner decision и этим отчётом не авторизуется.

## 15. Итоговая формулировка

Работа доказала воспроизводимость реальных домашних macro builders, полноту current-universe factor rematerialization и измеримое влияние first-vintage correction на IC и portfolio evaluations. Она также выявила ограничения coverage и подтверждённые расхождения со старыми результатами, включая потерю CI robustness у 126d final-holdout vol-target.

**Зафиксированный результат — обновлённая research evidence base, а не repaired alpha и не production readiness в смысле разрешения на эксплуатацию или deployment.**
