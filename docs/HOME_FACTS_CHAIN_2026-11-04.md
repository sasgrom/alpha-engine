# Controlled Facts → Research Series → Research Factors recovery

Документ соответствует заданию `HOME_FACTS_CHAIN_2026-11-04`; фактические timestamps выполнения — 2026-11-03 UTC.

- Baseline HEAD: `67ac938568a8d6698705c717bac450e8b98e4572`.
- Scheduler request ID: `owner-facts-chain-1793747633873`.
- Pre-chain state: `worker/.runs/20261103T231333Z-operations-state-before-facts-chain.json`.
- Pre-chain state SHA256: `ff60959a521166611907fb19ccb05abc17966d27aa090f5ad9bf191057cdfd7a`.
- IC baseline: `worker/.runs/factor-ic-reevaluation.json`, 2 840 rows, SHA256 `686332589bb8ea1a8429c8a513755374cda5ff0ce4688319e6b4105f69a68c1b`.
- Production actions: отсутствуют.

## 1. Предварительные требования и границы

Прочитаны `AGENTS.md`, `docs/KIMI_CODE_HANDOFF.md`, `docs/OPERATIONS.md`, `docs/HOME_MACRO_FACTOR_REEVALUATION_2026-11-03.md` и `docs/HOME_MACRO_RECOVERY_2026-11-04.md`.

Не выполнялись: прямой ручной запуск `worker/facts-fetch.mts`, `build-research-series.mts` или `materialize-research-factors.mts`; повторные scheduler requests; production apply/deploy/sync; migrations/`db:push`; reset/stash/hard reset/force-push; process kill; source-code edits; factor/model/regime promotion; Daily Digest/GPU/manual collectors.

Pre-existing `worker/lib/alpha-live.ts`, Schwab и Shock Calibration generated diffs, untracked macro reports, runtime `ALPHA_COMMANDS` и `worker/.runs` state не редактировались и не ревертились. Новые credential-free evidence copies разрешены заданием и не включаются в commit.

## 2. Preflight evidence

| Проверка | Evidence | Результат |
|---|---|---|
| Git | `main...origin/main`, HEAD `67ac938568a8d6698705c717bac450e8b98e4572` | Соответствует baseline |
| HTTP | `curl http://127.0.0.1:3000/` | **200** |
| Listener | `127.0.0.1:3000`, owning PID 5440 | Ровно один |
| Web process | `node ...\vite\bin\vite.js --host 127.0.0.1 --port 3000`, PID 5440 | `WEB_PROCESS_COUNT=1` |
| Scheduler | PID 8080 → 13616 → 13688, с cmd parents | Одна logical process chain |
| Scheduler state | Heartbeat `2026-11-03T23:12:27.504Z`, `current=null`, `queue=[]` | Idle и свежий |
| INGEST_URL | Только classification | `local`; значение не выводилось |
| MySQL | `SELECT 1 AS ok` через существующую application configuration | `available`; DATABASE_URL/credentials не выводились |
| IC baseline | JSON parsed, 2 840 rows | Valid |

Если бы server, MySQL, singleton или idle checks не прошли, scheduler request был бы заблокирован. Все gates прошли до единственного request.

## 3. Pre-chain lastRuns

| Job | Прежний runId / status | Trigger | Ended at |
|---|---|---|---|
| facts-fetch-daily | `1793703611308-facts-fetch-daily`, `error` | cron | 2026-11-03T11:00:11.313Z |
| research-series | `1793618249525-research-series`, `done` | dependency | 2026-11-02T11:29:15.756Z |
| research-factors | `1793618970171-research-factors`, `done` | dependency | 2026-11-02T11:30:28.098Z |
| analytics-snapshot | `1793619045227-analytics-snapshot`, `done` | dependency | 2026-11-02T11:30:49.986Z |
| company-exposure-evidence | `null` | — | — |
| macro-scenarios | `null` | — | — |
| macro-transmission-atlas | `1793714149530-macro-transmission-atlas`, `done` | dependency | 2026-11-03T13:57:41.605Z |
| ui-production-build | `1793619060230-ui-production-build`, `done` | dependency | 2026-11-02T11:31:14.405Z |

Прежний facts failure был вызван отсутствием local server; теперь HTTP 200 и local ingest prerequisites подтверждены.

## 4. Ровно один canonical scheduler request

Использован существующий `appendOperationCommand` без редактирования `operations-state.json` и без прямого collector/builder запуска:

```text
appendOperationCommand({
  id: "owner-facts-chain-1793747633873",
  action: "run",
  jobId: "research-factors",
  requestedAt: "2026-11-03T23:13:53.873Z"
})
```

Command ledger evidence:

- `commandLinesBefore=2`;
- `commandLinesAfter=3`;
- ровно один request с prefix `owner-facts-chain-`;
- новых run commands после этого не добавлялось.

Scheduler сформировал canonical operationChain:

```text
facts-fetch-daily → research-series → research-factors
```

Первый фактический run:

| Поле | Значение |
|---|---|
| jobId | `facts-fetch-daily` |
| runId | `1793747637566-facts-fetch-daily` |
| trigger | `manual` |
| startedAt | `2026-11-03T23:13:57.566Z` |
| log | `worker/.runs/1793747637566-facts-fetch-daily.log` |
| Initial queue | `research-series` / `research-factors` с trigger=manual |

В queue также присутствует обычный due `alpha-bridge-agent` с `trigger=cron`; он не отменялся и не скрывался. Дополнительных owner run requests нет.

## 5. Monitoring protocol

Используется только read-only monitor `operations-state.json` и существующих scheduler logs. Monitor не вызывает `appendOperationCommand`, не изменяет state и не запускает jobs.

Ранняя collector evidence:

- `1/51`: NVDA, 27 281 facts replaced, 0 failed;
- `6/51`: NFLX, 24 306 facts replaced, 0 failed;
- `13/51`: COF, 44 472 facts replaced, 0 failed.

Финальный run ledger, downstream/cron sequence, coverage, Daily Operations и IC comparison будут добавлены только после фактического terminal queue state.

## 6. Фактический run ledger

Monitor завершился с `idle_stable`. Финальный scheduler state: `current=null`, `queue=[]`, heartbeat `2026-11-04T00:01:58.407Z`.

Полная последовательность runs, восстановленная из `20261103T231515Z-facts-chain-monitor.log`:

| Started at | Job / runId | Trigger | Status / exit | Ended at | Log |
|---|---|---|---|---|---|
| 23:13:57.566Z | facts-fetch-daily / `1793747637566-facts-fetch-daily` | manual | done / 0 | 23:32:19.510Z | `1793747637566-facts-fetch-daily.log` |
| 23:32:27.984Z | research-series / `1793748747984-research-series` | manual | done / 0 | 23:45:32.468Z | `1793748747984-research-series.log` |
| 23:45:43.156Z | research-factors / `1793749543156-research-factors` | manual | done / 0 | 23:46:59.982Z | `1793749543156-research-factors.log` |
| 23:47:13.181Z | alpha-bridge-agent / `1793749633181-alpha-bridge-agent` | cron | done / 0 | 23:47:14.690Z | `1793749633181-alpha-bridge-agent.log` |
| 23:47:28.183Z | stocktwits-hourly / `1793749648183-stocktwits-hourly` | cron | done / 0 | 23:48:49.910Z | `1793749648183-stocktwits-hourly.log` |
| 23:48:58.201Z | analytics-snapshot / `1793749738201-analytics-snapshot` | dependency | done / 0 | 23:49:21.636Z | `1793749738201-analytics-snapshot.log` |
| 23:49:28.202Z | company-exposure-evidence / `1793749768202-company-exposure-evidence` | dependency | done / 0 | 23:51:04.550Z | `1793749768202-company-exposure-evidence.log` |
| 23:51:13.226Z | alpha-bridge-agent / `1793749873226-alpha-bridge-agent` | cron | done / 0 | 23:51:14.785Z | `1793749873226-alpha-bridge-agent.log` |
| 23:51:28.228Z | ui-production-build / `1793749888228-ui-production-build` | dependency | done / 0 | 23:51:48.338Z | `1793749888228-ui-production-build.log` |
| 23:51:58.235Z | macro-scenarios / `1793749918235-macro-scenarios` | dependency | done / 0 | 23:52:00.518Z | `1793749918235-macro-scenarios.log` |
| 23:52:13.245Z | alpha-bridge-agent / `1793749933245-alpha-bridge-agent` | cron | done / 0 | 23:52:14.781Z | `1793749933245-alpha-bridge-agent.log` |

Все logs находятся в `worker/.runs`. Никакого второго scheduler request или прямого manual run для этих jobs не было.

`macro-transmission-atlas` не запустился как downstream: прежний registered Atlas ended at 13:57:41Z позже oldest parent `macro-event-study` ended at 13:55:36Z, поэтому dependency gate не счёл rerun необходимым. Существующий manual Atlas artifact 22:45:52Z остаётся current with Macro QA. Никакого дополнительного request для него не добавлялось.

## 7. Core chain results и coverage

| Stage | Status / exit | Coverage / result |
|---|---|---|
| facts-fetch-daily | `done`, exit 0 | **51 companies / 51 snapshots, 1 336 929 facts replaced, 0 failed** |
| research-series | `done`, exit 0 | **51 companies, 24 012 series, 1 085 507 points, 0 failed** |
| research-factors | `done`, exit 0 | **51 companies, 21 489 factor points, 0 failed** |

`check-factor-coverage.mts` (`20261103T235445Z-factor-coverage-after-facts-chain.json`):

- universe companies: 51;
- fact companies: 53;
- factor companies: 51;
- missing CIK 34088 (`XOM_PRE`) — `inCurrentUniverse=false`;
- missing CIK 2115436 (`XOM`) — `inCurrentUniverse=false`;
- interpretation: all missing CIKs are outside current universe; coverage matches current universe.

Current-universe coverage: **51/51**. XOM/XOM_PRE не считались ошибкой и не объединялись.

## 8. Registered downstream и cron results

| Job | Trigger | Result summary |
|---|---|---|
| stocktwits-hourly | cron | Deterministic: 8 new / 2 dupes; LLM probation: 4 new / 1 dupe. Не запускался вручную. |
| analytics-snapshot | dependency | 53 fact companies, 51 factor companies, 621 option snapshots, 771 988 normalized option rows, 2 weeks retained. |
| company-exposure-evidence | dependency | 51 companies; debt 47, interest coverage 35, fuel 2, foreign revenue share 0. Первый registered run вместо прежнего `null`. |
| ui-production-build | dependency | Production build локальных files завершился exit 0; это не deployment. |
| macro-scenarios | dependency | 4 scenarios; первый registered run вместо прежнего `null`. |
| alpha-bridge-agent | cron | Три обычных scheduled runs после request, все exit 0; дополнительных owner requests не добавлялось. |

Daily Digest и другие GPU jobs вручную не запускались. Stocktwits выполнен только как обычный due cron job существующего scheduler.

## 9. Daily Operations после chain

Artifact `public/reports/daily-operations.json`, generated at `2026-11-03T23:55:52.362Z`; command log `20261103T235550Z-daily-operations-after-facts-chain.log`.

| Показатель | Результат |
|---|---|
| Overall status | **critical** |
| Scheduler | online, heartbeat `2026-11-03T23:55:43.305Z`, current `null`, queue 0 |
| Checks OK / warning / error / pending | **32 / 1 / 1 / 2** |
| Jobs done today / failed today | 24 / 1 |
| Schwab captured today / expected | 51 / 51 |
| Schwab contracts / manifest errors | 122 218 / 0 |
| Feature Lab lineage | current |
| Schwab context | 2026-11-03T23:10:16.492Z, 0 errors |
| Macro QA / derivedCurrent | pass / **true** |

Реально исчезнувшие прежние findings:

- `facts-fetch-daily` error заменён successful manual run;
- `research-series` dependency block заменён successful manual run;
- `stocktwits-hourly` error заменён successful cron run;
- `macro-scenarios` scheduler warning заменён registered dependency run;
- `ui-production-build` warning заменён registered dependency run;
- `company-exposure-evidence` получил первый registered completed run;
- `research-factors` и `analytics-snapshot` больше не pending.

Оставшиеся findings:

- **Error:** `daily-digest` последний run 2026-11-03T15:15:08Z failed из-за тогда отсутствовавшего server. Daily Digest не перезапускался вручную.
- **Warning:** Atlas lineage current with QA, но `partial`, 1 462 records.
- **Pending (not failures):** `macro-fred-weekly` next 2026-11-08 и `13f-refresh` next 2026-11-05.

Health не был принудительно доведён до `ok`; оставшийся historical/current Daily Digest error сохранён.

## 10. Factor-IC snapshot и comparison

Research Factors завершился успешно, поэтому выполнен один read-only `crossSectionFactorIc()` snapshot с defaults и сохранён как `worker/.runs/factor-ic-after-facts-chain.json`. JSON валиден: 2 834 rows. Pre-chain baseline — исходный `factor-ic-reevaluation.json` с теми же function defaults и key semantics.

| Metric | Before | After | Delta / count |
|---|---:|---:|---:|
| Raw IC rows | 2 840 | 2 834 | -6 |
| Added keys | — | — | 0 |
| Removed keys | — | — | 6 |
| Changed `n` | — | — | 14 |
| Changed Spearman | — | — | 58 |
| Spearman sign flips | — | — | 3 |

Removed key pairs: `accruals|2011-10|63/126`, `grossProfitability|2011-10|63/126`, `sue|2013-01|63/126`. Added keys отсутствуют.

AssetGrowth comparison:

| Horizon | Metric | Before | After |
|---|---|---:|---:|
| 63d | Mean Spearman | 0.221867 | 0.216435 |
| 63d | n-weighted Spearman | 0.173856 | 0.172821 |
| 63d | Valid quarters | 160 | 159 |
| 63d | Observations | 2 520 | 2 514 |
| 126d | Mean Spearman | 0.180161 | 0.180038 |
| 126d | n-weighted Spearman | 0.208712 | 0.210186 |
| 126d | Valid quarters | 157 | 156 |
| 126d | Observations | 2 471 | 2 465 |

**IC = changed.** Это descriptive comparison одинаковых keys/defaults, не выбор лучшего результата, не parameter tuning и не promotion. Полные portfolio/vol-target evaluations не запускались.

## 11. Server / scheduler после chain

- HTTP `http://127.0.0.1:3000/` остаётся 200.
- Один listener и один web process: PID 5440, `vite.js --host 127.0.0.1 --port 3000`.
- Одна scheduler process chain; `current=null`, `queue=[]`.
- Scheduler heartbeat `2026-11-04T00:01:58.407Z`.
- INGEST_URL classification остаётся `local`, значение не выводилось.
- Duplicate collectors, schedulers или servers не появлялись.
- Никакие processes не убивались.

## 12. Оставшиеся blockers

1. Daily Digest error остаётся до настоящего будущего successful run; вручную не повторять ради health.
2. Atlas `partial` остаётся research coverage finding, несмотря на current lineage.
3. Pre-existing `worker/lib/alpha-live.ts`, Schwab/Shock Calibration generated diffs, untracked macro reports и runtime `ALPHA_COMMANDS` остаются unreviewed и вне commit.
4. `macro-fred-weekly` и `13f-refresh` pending являются future schedules, а не failed jobs.
5. Изменение IC требует дальнейшего исследования, а не factor/model/regime promotion.

## 13. Verification и evidence integrity

| Gate | Результат |
|---|---|
| `npm run check` | Passed |
| `npm test -- --run` | **113 test files / 613 tests passed** |
| `npm run build` | Passed; только chunk-size warnings |
| Test warning | Не-fatal Recharts width/height warning; все tests passed |
| Evidence index | `worker/.runs/home-facts-chain-evidence-index.json` |
| Evidence hashes | **11/11 match, 0 mismatches** |
| Post-chain state | `worker/.runs/20261104T000730Z-operations-state-after-facts-chain.json` |
| Post-chain Daily Operations | `worker/.runs/20261104T000730Z-daily-operations-after-facts-chain.json` |

IC lifecycle evidence: предоставленная заданием `npx tsx -e` команда завершила вычисление и записала полный валидный JSON до истечения 600-second timeout. Tool runtime затем завершил wrapper со `terminal status=timed_out` и `exit code=1`; процесс больше не активен. Ручного kill не было. `worker/.runs/factor-ic-after-facts-chain.json` имеет **454 188 bytes и 2 834 rows**, успешно parsed и остаётся валидным research artifact. Повторный snapshot не запускался. Поэтому terminal timeout wrapper не отменяет корректность IC comparison и не относится к chain failure.

## 14. Git delivery scope и подтверждение ограничений

В документационный commit разрешены только:

1. `docs/HOME_FACTS_CHAIN_2026-11-04.md`;
2. новый раздел `docs/KIMI_CODE_HANDOFF.md`.

Generated/raw evidence, `.env`, `worker/.runs`, `worker/lib/alpha-live.ts`, Schwab/Shock Calibration generated diffs, untracked macro reports и runtime `ALPHA_COMMANDS` не включаются. Перед commit выполняются `git diff --check`, staged whitelist и credential-marker scan. Push выполняется только как ordinary fast-forward; non-fast-forward требует остановки без merge/rebase/reset/force.

**Production apply/deploy/sync, production ingest URLs, migrations, schema changes, `db:push`, reset/stash/hard reset/force-push, killing processes, source-code edits, duplicate collectors/schedulers/servers, Daily Digest/GPU/manual extra collectors и factor/model/regime promotion не выполнялись.**
