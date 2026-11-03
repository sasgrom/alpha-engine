# Home Macro Recovery — FRED, derived lineage и facts prerequisites

Документ создан по operational блоку после `docs/HOME_MACRO_FACTOR_REEVALUATION_2026-11-03.md`. Имя файла соответствует заданию (`2026-11-04`); фактические run timestamps находятся 2026-11-03 UTC и указаны без изменения часового пояса.

- Baseline HEAD: `31f635138785b4e24e37e1e466b0c666b7781a17`.
- Рабочая директория: `C:\dev\alpha-engine`.
- Macro archive: `D:\research\alpha-engine\macro`.
- Основной operational interval: 2026-11-03T22:27Z–22:53Z.
- Evidence index: `worker/.runs/home-macro-recovery-evidence-index.json`.
- `facts-fetch-daily`: **NOT RUN**.

## Резюме

- Единственный FRED refresh завершился успешно: 20/20 series complete, 779 664 rows, 0 errors; manifest `2026-11-03T22:40:27.034Z`.
- Macro Manifest QA: `pass`, 0 errors / 0 warnings, `2026-11-03T22:42:38.572Z`.
- Shock Calibration: 4/4 ready; Event Study: `ready`, 47/47 events with outcomes; Atlas: `partial`, 1 462 records / 24 studies; Macro Scenarios: 4 scenario records, channel statuses сохранены как `partial` / `not_computable`.
- Все четыре derived artifact новее текущего QA; `predatesQa=false` для каждого.
- Fresh Daily Operations: `critical`, 24 OK / 3 warnings / 4 errors / 5 pending; macro `derivedCurrent=true`.
- Полностью отсутствующий web server был запущен ровно один раз как Vite dev server; финальный HTTP 200, listener PID 5440, второй server отсутствует.
- Scheduler существует как одна process chain, `current=null`, queue пуста; `INGEST_URL` классифицируется как local.
- Facts prerequisites: **ready_for_future_run**. Сам collector не запускался.
- Production apply/deploy/sync, migrations, `db:push`, schema changes, production URLs в командах, reset/stash/hard reset/force-push, duplicate collectors/schedulers/servers и factor/model/regime promotion не выполнялись.

## 1. Startup baseline и защита pre-existing changes

Прочитаны `AGENTS.md`, `docs/KIMI_CODE_HANDOFF.md`, `docs/OPERATIONS.md`, `docs/MACRO_DATA.md` и требуемый проектом `docs/LLM_CONTEXT.md`.

Начальный Git state:

```text
## main...origin/main
 M docs/ALPHA_COMMANDS.jsonl
 M public/reports/schwab-context.json
 M public/reports/shock-calibration.json
 M public/reports/shock-calibration.md
 M worker/lib/alpha-live.ts
?? public/reports/macro-event-study.json
?? public/reports/macro-event-study.md
?? public/reports/macro-transmission-atlas.json
?? public/reports/macro-transmission-atlas.md
```

HEAD совпал с обязательным `31f635138785b4e24e37e1e466b0c666b7781a17`. Schwab, Shock Calibration, untracked macro reports, runtime `ALPHA_COMMANDS` и дополнительный pre-existing source diff `worker/lib/alpha-live.ts` не редактировались вручную, не ревертились и не удалялись. Разрешённый Shock Calibration builder обновил свой обычный generated output; generated changes не включаются в документационный commit.

Scheduler baseline: `current=null`, `queue=[]`, heartbeat `2026-11-03T22:27:42.130Z`. Активных macro collector/builder processes не найдено. Scheduler process evidence:

| PID | Parent PID | Назначение |
|---:|---:|---|
| 8080 | 13116 | `npx-cli.js tsx worker\operations-scheduler.mts` |
| 13616 | 13592 | `tsx/dist/cli.mjs worker\operations-scheduler.mts` |
| 13688 | 13616 | Node preflight/import + `worker\operations-scheduler.mts` |

Это одна parent/child chain одного scheduler, а не три scheduler. Дополнительные cmd parents: 13116 и 13592. Перед каждым ручным macro/builder запуском `operations-state.json` повторно проверялся; аналогичного активного job не было.

## 2. Полный command ledger

| Команда / действие | Exit / status | Результат и evidence |
|---|---|---|
| `git status --short --branch`, `git rev-parse HEAD` | 0 | HEAD соответствует baseline; pre-existing diffs зафиксированы. |
| Windows `Get-CimInstance Win32_Process` для macro/scheduler | 0 | Macro processes нет; одна scheduler chain. |
| `curl http://127.0.0.1:3000/` до server start | Connection failure / HTTP 000 | Web server полностью отсутствовал. |
| `Get-NetTCPConnection -LocalPort 3000` | Нет listeners | Второй/существующий server отсутствовал. |
| INGEST_URL classification через `dotenv/config` | 0 | Только classification `local`; значение и другие env не выводились. |
| `schtasks.exe /Query ...` напрямую из Git Bash | 1 | Slash options были преобразованы Git Bash в paths; read-only invocation исправлен через PowerShell. Никакого operational effect. |
| `schtasks /Query ...` через PowerShell | 0 | Home Server task `Disabled`; Operations Scheduler task `Ready` / enabled. |
| `npx tsx worker/macro-fred-fetch.mts --group all` | **0, один run** | 20/20 series, 779 664 rows, 0 errors. Log `20261103T222930Z-macro-fred-fetch.log`. |
| `npx tsx worker/macro-manifest-qa.mts` | **0, один run** | `pass`, 0 errors / 0 warnings. Log `20261103T224233Z-macro-manifest-qa.log`. |
| `npx tsx scripts/build-shock-calibration.mts` | **0, один run** | 4 calibrations ready. Log `20261103T224310Z-build-shock-calibration.log`. |
| `npx tsx scripts/build-macro-event-study.mts --macro-root D:\research\alpha-engine\macro` | **0, один run** | `ready`, 188 observations. Log `20261103T224334Z-build-macro-event-study.log`. |
| `npx tsx scripts/build-macro-transmission-atlas.mts` | **0, один run** | `partial`, 1 462 records / 24 studies. Log `20261103T224350Z-build-macro-transmission-atlas.log`. |
| `npx tsx scripts/build-macro-scenarios.mts` | **0, один run** | 4 scenarios. Log `20261103T224649Z-build-macro-scenarios.log`. |
| `npx tsx scripts/build-daily-operations-report.mts --macro-root D:\research\alpha-engine\macro` | **0, один run** | Health `critical`; реальные errors/warnings сохранены. Log `20261103T224755Z-daily-operations-report.log`. |
| `npm run dev -- --host 127.0.0.1 --port 3000` | Один managed background process | Log `home-dev-server.log`; manager task PID 16636, listener PID 5440. |
| Initial HTTP wait после Vite start | Timeout / HTTP 000 | Vite уже написал ready, но первый response ещё формировался; второй server не запускался. |
| Финальный `curl http://127.0.0.1:3000/` | **HTTP 200** | Время последнего response 0.004494s. |
| `npm run check` | 0 | TypeScript passed. |
| `npm test -- --run` | 0 | 113 files / 613 tests passed. |
| `npm run build` | 0 | Build passed; только chunk-size warnings. |
| `worker/facts-fetch.mts` | **NOT RUN** | Проверялись только prerequisites. |

Никакой failed collector/builder не перезапускался. FRED credential presence проверялась только штатным `dotenv/config` внутри collector; `.env` не открывался для ручного чтения, не выводился и не копировался. Значения credentials и другие env values не запрашивались.

## 3. FRED refresh

Pre-run manifest snapshot: `worker/.runs/20261103T222930Z-fred-manifest-before.json`, SHA256 `67a3d1f80605f4a76996bd68557f353a506d058ba3135c1359d3b4d2d5397039`.

Post-run snapshot: `worker/.runs/20261103T224027Z-fred-manifest-after.json`.

Итог console log: `series 20 · rows 779664 · errors 0`. Manifest `generatedAt=2026-11-03T22:40:27.034Z`; capture timestamps всех 20 series обновлены в диапазоне `22:29:32.504Z–22:39:51.134Z`.

| Series | Captured at before → after | Rows before → after | Last observation | Last vintage | Status |
|---|---|---:|---|---|---|
| BAMLC0A0CM | 2026-11-02T06:18:20.502Z → 2026-11-03T22:35:42.074Z | 1 726 → 1 712 | 2026-11-02 | 2026-11-02 | complete |
| BAMLH0A0HYM2 | 2026-11-02T06:18:26.299Z → 2026-11-03T22:35:48.051Z | 1 725 → 1 711 | 2026-11-02 | 2026-11-02 | complete |
| CPIAUCSL | 2026-11-02T06:18:47.207Z → 2026-11-03T22:35:53.823Z | 5 774 → 5 774 | 2026-09-01 | 2026-10-14 | complete |
| CPILFESL | 2026-11-02T06:19:20.921Z → 2026-11-03T22:36:27.714Z | 5 678 → 5 678 | 2026-09-01 | 2026-10-14 | complete |
| DCOILBRENTEU | 2026-11-02T06:15:47.900Z → 2026-11-03T22:35:06.832Z | 81 514 → 81 514 | 2026-10-27 | 2026-10-28 | complete |
| DCOILWTICO | 2026-11-02T06:15:24.100Z → 2026-11-03T22:34:43.717Z | 81 528 → 81 528 | 2026-10-27 | 2026-10-28 | complete |
| DFF | 2026-11-02T06:11:37.478Z → 2026-11-03T22:33:02.281Z | 132 509 → 132 513 | 2026-11-02 | 2026-11-03 | complete |
| DGS10 | 2026-11-02T06:07:27.022Z → 2026-11-03T22:30:01.977Z | 7 260 → 94 623 | 2026-11-02 | 2026-11-03 | complete |
| DGS2 | 2026-11-02T06:09:16.791Z → 2026-11-03T22:29:32.504Z | 94 620 → 94 622 | 2026-11-02 | 2026-11-03 | complete |
| DGS30 | 2026-11-02T06:09:46.519Z → 2026-11-03T22:32:02.204Z | 94 610 → 94 612 | 2026-11-02 | 2026-11-03 | complete |
| DTWEXBGS | 2026-11-02T06:17:17.228Z → 2026-11-03T22:35:29.645Z | 53 124 → 53 129 | 2026-10-30 | 2026-11-02 | complete |
| GDP | 2026-11-02T07:46:27.188Z → 2026-11-03T22:39:51.134Z | 2 439 → 2 439 | 2026-07-01 | 2026-10-29 | complete |
| GDPC1 | 2026-11-02T07:45:53.415Z → 2026-11-03T22:39:17.162Z | 2 493 → 2 493 | 2026-07-01 | 2026-10-29 | complete |
| MORTGAGE30US | 2026-11-02T06:12:59.290Z → 2026-11-03T22:34:21.489Z | 16 843 → 16 843 | 2026-10-29 | 2026-10-29 | complete |
| PAYEMS | 2026-11-02T06:41:18.283Z → 2026-11-03T22:38:10.014Z | 8 303 → 8 303 | 2026-09-01 | 2026-10-02 | complete |
| PCEPI | 2026-11-02T06:19:54.812Z → 2026-11-03T22:37:02.639Z | 7 654 → 7 654 | 2026-09-01 | 2026-10-29 | complete |
| PCEPILFE | 2026-11-02T06:20:29.321Z → 2026-11-03T22:37:36.424Z | 7 653 → 7 653 | 2026-09-01 | 2026-10-29 | complete |
| SOFR | 2026-11-02T06:11:26.756Z → 2026-11-03T22:32:51.363Z | 10 904 → 10 906 | 2026-11-02 | 2026-11-03 | complete |
| T10Y2Y | 2026-11-02T06:11:08.434Z → 2026-11-03T22:32:32.560Z | 71 172 → 71 174 | 2026-11-03 | 2026-11-03 | complete |
| UNRATE | 2026-11-02T06:41:52.159Z → 2026-11-03T22:38:43.668Z | 4 783 → 4 783 | 2026-09-01 | 2026-10-02 | complete |

Все 20 captures обновились. DGS10 перешёл от прежнего ограниченного 7 260-row artifact к 94 623-row vintage history; QA проверил полученные raw hashes и availability invariants. Уменьшение rows в credit series сохранено как факт source window, а не скрытое удаление: официальное трёхлетнее ограничение ICE BofA/FRED не обходилось.

## 4. Macro Manifest QA

Timestamped QA artifact: `worker/.runs/20261103T224238Z-macro-manifest-qa.json`.

```json
{
  "generatedAt": "2026-11-03T22:42:38.572Z",
  "status": "pass",
  "errors": 0,
  "warnings": 0,
  "issues": []
}
```

QA проверил manifest presence, per-series errors, raw SHA256 hashes, normalized row counts, duplicate vintages/events, availability inversions и research window 2000+. Ни одной error/warning issue нет. Derived builders были разрешены только после этого результата.

## 5. Derived builders и lineage

### 5.1. Сводная таблица

QA timestamp для lineage: `2026-11-03T22:42:38.572Z`. Ни один builder не предшествует QA.

| Builder | Exit | Generated at | Status / coverage | Artifact | Предшествует QA? |
|---|---:|---|---|---|---|
| Shock Calibration | 0 | 2026-11-03T22:43:12.669Z | 4/4 calibrations `ready` | `public/reports/shock-calibration.json` | Нет |
| Macro Event Study | 0 | 2026-11-03T22:43:36.348Z | `ready`; 188 observations; 47/47 with outcomes | `public/reports/macro-event-study.json` | Нет |
| Macro Transmission Atlas | 0 | 2026-11-03T22:45:52.634Z | `partial`; 1 462 records / 24 studies | `public/reports/macro-transmission-atlas.json` | Нет |
| Macro Scenarios | 0 | 2026-11-03T22:46:51.809Z | 4 scenarios; 2 `partial`, 2 `not_computable` по channel | `public/reports/macro-scenarios.json` | Нет |

Timestamped recovery copies находятся в `worker/.runs`: `20261103T224312Z-shock-calibration.json`, `20261103T224336Z-macro-event-study.json`, `20261103T224552Z-macro-transmission-atlas.json`, `20261103T224651Z-macro-scenarios.json`.

### 5.2. Shock Calibration

| Series | Status | Observations |
|---|---|---:|
| DGS10 | ready | 6 711 |
| DCOILWTICO | ready | 6 751 |
| DTWEXBGS | ready | 5 352 |
| BAMLH0A0HYM2 | ready | 784 |

Протокол не менялся: latest eligible vintage per observation, 200 moving-block bootstrap replicates, max block length 20. Percentiles не интерпретируются как directional forecast.

### 5.3. Macro Event Study

- `dataMode=live`, `status=ready`.
- Total / eligible / with baseline: 47 / 47 / 47.
- With any observation: **47**, против 46 в предыдущем manual run.
- Discovery / OOS: 32 / 15.
- Observation records: 188.
- First-release observations, baseline known at event eligibility, next-observation-day outcomes и chronological split сохранены.

### 5.4. Macro Transmission Atlas

| Поле | Count |
|---|---:|
| Candidate pairs | 14 100 |
| Exposure missing | 10 810 |
| Exposure partial | 2 110 |
| Exposure stale | 465 |
| Price missing | 132 |
| Shock missing | 870 |
| Records | 1 462 |
| Studies | 24 |
| Estimated / pilot | 6 |
| Insufficient coverage | 18 |
| OOS evaluations | 2 |

`partial` сохранён как research coverage status. Повторный run для получения более «красивого» результата не выполнялся; factor/model promotion отсутствует.

### 5.5. Exposure parent gates перед Macro Scenarios

| Parent | Generated at | Age перед scenario | Records / validation |
|---|---|---:|---|
| Company exposures | 2026-11-02T20:17:08.616Z | 26.49h | 51 companies; universe SHA256 совпал с `research-universe-51.json` |
| Pilot exposure evidence | 2026-11-03T14:05:07.673Z | 8.69h | DAL, RCL, CVX, COP, PFE; 5/5 source hashes присутствуют |

Лимит dependency freshness: 48h (`DEPENDENCY_FRESH_MS`). Оба JSON парсятся, не missing, находятся внутри лимита и имеют ожидаемые counts. Company universe SHA256: `f253b8c5622e380bdc0a4e3781157c8d043be756994651b9fb9510eedb27bbbe`, совпадает с текущей universe.

Company exposure не имеет registered scheduler `lastRuns` entry; это зафиксировано как operational caveat и видно в Daily Operations warning. Существующий artifact не подменялся и дополнительные SEC collectors не запускались.

### 5.6. Macro Scenarios

| Channel | Status | Baseline period | Impact statuses |
|---|---|---|---|
| rates | `partial` | 2026-10-30 | 1 computable, 4 not_computable |
| oil | `partial` | 2026-10-27 | 1 computable, 3 historical_only, 1 not_computable |
| usd | `not_computable` | 2026-10-30 | 5 not_computable |
| credit | `not_computable` | 2026-11-02 | 5 not_computable |

Все baselines имеют availability и `ingestedAt` от нового FRED run. Missing fixed/floating share, hedge terms, foreign revenue и new-issuance terms не подставлялись. Upper bound/gross exposure не выдаются за profit forecasts.

## 6. Fresh Daily Operations Report

Artifact: `public/reports/daily-operations.json`; timestamped recovery copy `worker/.runs/20261103T224757Z-daily-operations.json`.

Generated at `2026-11-03T22:47:57.596Z`, report UTC date 2026-11-03.

### 6.1. Overall

| Показатель | Результат |
|---|---|
| Overall status | **critical** |
| Scheduler | online |
| Heartbeat | 2026-11-03T22:47:57.347Z |
| Current job / queue | `null` / 0 |
| Enabled jobs | 27 |
| Checks OK / warning / error / pending | **24 / 3 / 4 / 5** |
| Jobs done today / failed today | 16 / 3 |
| Schwab captured today / expected | **51 / 51** |
| Readable latest chains | 51 / 51 |
| Contracts | 122 218 |
| Schwab manifest errors | 0 |
| Feature Lab source current | true |
| Schwab context | 2026-11-03T22:10:15.735Z, 0 errors |
| FRED generated at | 2026-11-03T22:40:27.034Z |
| OFAC generated at | 2026-11-03T13:40:05.339Z; 47 events |
| Macro QA | pass |
| Macro derivedCurrent | **true** |

### 6.2. Macro lineage

| Check | Status | Evidence |
|---|---|---|
| Scenario lineage | `ok` | Current with QA, generated 2026-11-03T22:46:51.809Z |
| Calibration lineage | `ok` | Current with QA; 4/4 calibrations ready |
| Event Study lineage | `ok` | Current with QA; `ready`; 47/47 eligible events have outcomes |
| Atlas lineage | `warning` | Current with QA; `partial`; 1 462 records |

### 6.3. Оставшиеся errors

| Check / job | Evidence | Причина |
|---|---|---|
| `stocktwits-hourly` | Last run 2026-11-03T22:30:12Z | Local server тогда отсутствовал на port 3000 |
| `facts-fetch-daily` | Last run 2026-11-03T11:00:11Z | Local server тогда отсутствовал на port 3000 |
| `research-series` | Parent failure | Dependency blocked из-за failed facts parent |
| `daily-digest` | Last run 2026-11-03T15:15:08Z | Local server тогда отсутствовал на port 3000 |

Это три failed jobs плюс один dependency-blocked check, поэтому `jobsFailedToday=3`, а `checksError=4`. Ни один failed job не перезапускался в этом блоке.

### 6.4. Warnings и pending

Warnings:

1. Atlas `partial` при current lineage.
2. `macro-scenarios`: parent completed today, но scheduler dependency не имеет собственного completed run. Ручной artifact существует и current with QA, но не регистрируется как scheduler `lastRuns`.
3. `ui-production-build`: parent completed today, но scheduler dependency не имеет собственного completed run.

Pending checks: `research-factors`, `analytics-snapshot`, `macro-fred-weekly` (next 2026-11-08), `company-exposure-evidence`, `13f-refresh` (next 2026-11-05). Health не был искусственно приведён к `ok`.

## 7. Server / scheduler diagnostics для facts prerequisites

### 7.1. Состояние до запуска

- `curl http://127.0.0.1:3000/` вернул connection failure / HTTP 000.
- `Get-NetTCPConnection -LocalPort 3000 -State Listen` не нашёл listeners.
- Node web process не найден.
- Windows task `AlphaEngine-Home-Server`: `Disabled`, `Next Run Time=N/A`.
- `INGEST_URL` classification: `local`; значение не выводилось, другие env values не запрашивались и не выводились.
- Scheduler был idle, поэтому owner-authorized single dev server был разрешён.

### 7.2. Запуск ровно одного dev server

Команда:

```text
npm run dev -- --host 127.0.0.1 --port 3000
```

Managed evidence:

| Поле | Значение |
|---|---|
| Background manager task | `bash-9g17bw6s` |
| Manager shell PID | 16636 |
| Listener Node PID | **5440** |
| Listener parent cmd PID | 15664 |
| Listener command line | `node ...\vite\bin\vite.js --host 127.0.0.1 --port 3000` |
| Log | `worker/.runs/home-dev-server.log` |
| Vite startup log | `VITE v7.3.0 ready in 629 ms` |
| HTTP после прогрева | **200** |
| Финальный HTTP response time | 0.004494s |
| Web process count | **1** |
| Listener count | **1** |

Первый HTTP wait завершился timeout/000: Vite уже сообщил readiness, но response ещё формировался. Не было ни убийства процесса, ни повторного запуска, ни второго server. Последующий HTTP 200 подтвердил фактическую доступность. ONLOGON tasks и автозагрузка не изменялись. Server оставлен запущенным как managed background process.

### 7.3. Scheduler evidence

Повторная проверка подтвердила одну scheduler chain:

- PID 8080 — npx parent;
- PID 13616 — tsx CLI child;
- PID 13688 — actual Node scheduler child;
- `heartbeatAt=2026-11-03T22:49:27.362Z`;
- `current=null`;
- `queue=[]`;
- next scheduled facts run: `2026-11-04T11:00:00Z`.

Unknown process, второй scheduler или активная dependent task не обнаружены. Ничего не убивалось.

### 7.4. Итог prerequisites

| Prerequisite | Результат |
|---|---|
| HTTP local server | `200` на `http://127.0.0.1:3000/` |
| Exactly one listener / web process | Да, PID 5440 |
| Exactly one operations scheduler | Да, одна process chain |
| Scheduler current / queue | `null` / пусто |
| Effective INGEST_URL | `local` classification |
| Unknown/duplicate process | Не найден |
| **facts-fetch-daily** | **ready_for_future_run** |
| Фактический collector run | **NOT RUN** |

`worker/facts-fetch.mts` дополнительно имеет собственный local-only ingest guard. Это не являлось разрешением на запуск: collector в задании не выполнялся ни вручную, ни через scheduler command.

## 8. Verification перед документационным delivery

| Gate | Результат |
|---|---|
| `npm run check` | Passed |
| `npm test -- --run` | **113 test files / 613 tests passed** |
| `npm run build` | Passed; только chunk-size warnings |
| Test warning | Не-fatal Recharts width/height warning в Analytics test; все tests passed |
| Build output | Vite 2 572 modules, `dist/boot.js`; build не deployment |
| `git diff --check` | Passed для working tree и staged diff; whitespace errors отсутствуют |
| Evidence index | `worker/.runs/home-macro-recovery-evidence-index.json`, 16 artifacts с SHA256 |

Build не останавливал dev server и не запускал второй server. Не выполнялись formatters, source edits или dependency installation.

## 9. Оставшиеся blockers и действия владельца

1. **Daily Operations остаётся `critical`.** Прежние Stocktwits/Facts/Digest failures и Research Series dependency block не скрыты. Их последующее исчезновение возможно только после реальных успешных runs; в этом блоке они не повторялись.
2. **Server должен оставаться доступным для будущего facts run.** Если PID 5440 завершится или port 3000 будет занят другим процессом, prerequisite снова станет blocked. При следующем запуске нужно повторно проверить HTTP, listener count и scheduler state.
3. **Company exposure scheduler registration отсутствует.** Существующий artifact валиден и свежий по 48h gate, но scheduler warning для `macro-scenarios` сохраняется до настоящего registered dependency completion. Не требуется скрытый SEC refresh.
4. **Atlas `partial`.** 18/24 studies insufficient, 6 estimated pilot, 2 OOS. Повторные runs без новых данных не решат coverage gap.
5. **Scenario computability.** Rates/oil `partial`, USD/credit `not_computable`; missing evidence нельзя заменять assumptions или sector inference.
6. **Pre-existing Git changes.** Schwab, Shock Calibration, untracked macro reports, runtime `ALPHA_COMMANDS` и `worker/lib/alpha-live.ts` остаются отдельными unreviewed changes. Их не следует случайно включать в документационный delivery или удалять.
7. **Daily scheduler jobs.** `ui-production-build` warning и pending jobs описывают scheduler state, а не failed macro artifact lineage. Оценивать их нужно по следующим реальным runs.

Рекомендуемые следующие действия: оставить один dev server и один scheduler работать; перед следующим facts slot повторить только prerequisite checks; отдельно review pre-existing source/generated diffs; для Atlas/Scenario сначала улучшать документированное evidence coverage, без factor/model/regime promotion.

## 10. Git delivery scope и подтверждение ограничений

В документационный commit разрешены только:

1. `docs/HOME_MACRO_RECOVERY_2026-11-04.md`;
2. новый раздел в `docs/KIMI_CODE_HANDOFF.md`.

Generated/raw evidence, `.env`, `worker/.runs`, pre-existing diffs, `worker/lib/alpha-live.ts`, Schwab, Shock Calibration и untracked macro JSON/Markdown не включаются. Перед commit выполняются `git diff --check`, staged-files whitelist и credential-marker проверка staged diff. Push разрешён только как ordinary fast-forward; merge/rebase/reset/force при non-fast-forward запрещены заданием.

**Production apply/deploy/sync, migrations, schema changes, db:push, production URLs в командах, credential inspection, duplicate collectors/schedulers/servers и factor/model/regime promotion не выполнялись. `facts-fetch-daily` был НЕ запущен.**
