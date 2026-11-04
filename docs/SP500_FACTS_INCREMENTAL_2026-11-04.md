# Incremental S&P 500 companyfacts collection

Документ соответствует operational блоку `SP500_FACTS_INCREMENTAL_2026-11-04`; фактические timestamps — 2026-11-04 UTC.

- Baseline: `d80bc9e233dc0172cf3a789960e476d40e2763f4`.
- Code commit: `f196acf` — `Add incremental S&P companyfacts collection`.
- Collection snapshot: `edgar-universe.json` / `GICS_SNAPSHOT_AS_OF=2026-10-11`.
- Universe SHA256 по sorted unique CIKs: `9db32591ad570e51e4e9902417a5152414c2d27a5d73e2b9f7365b4d75809c9b`.
- Initial scheduler request: `owner-sp500-facts-initial-1793759900468`.
- Initial registered run: `1793759902622-sp500-facts-daily`.
- Production apply/deploy/sync, migrations, `db:push` и research-universe expansion не выполнялись и не разрешены этим отчётом.

## 1. Collection snapshot и dedupe

Provenance — documented Wikipedia `List of S&P 500 companies`, id=constituents table, captured 2026-10-11. Live scrape во время collection не выполнялся. Snapshot описывает текущий collection universe и не является historical point-in-time S&P 500 membership.

| Metric | Result |
|---|---:|
| Rows | **502** |
| Unique CIKs | **499** |
| Duplicate-CIK rows | **3 pairs** |
| Universe SHA256 | `9db32591ad570e51e4e9902417a5152414c2d27a5d73e2b9f7365b4d75809c9b` |
| Raw file SHA256 (audit only) | `04970962aa64c5cdaee77cf31e6686c89f7a48169deccd2f465eda32da47bdab` |

Duplicate CIK pairs:

1. FOX / FOXA — CIK 1754301;
2. GOOG / GOOGL — CIK 1652044;
3. NWS / NWSA — CIK 1564708.

Collection дедуплицируется детерминированно по CIK, первый ticker в исходном порядке сохраняется, CIKs сортируются по числу. Это не расширяет research-universe-51, IC, Atlas или factor/model/regime universes.

## 2. Code-ready implementation

`worker/facts-fetch.mts` теперь использует `worker/lib/facts-incremental.ts`:

- sequential SEC fair-access collection без новых parallel requests или services;
- recent financial/XBRL forms 10-K, 10-Q, 20-F, 40-F, 10-KT, 10-QT и amendments;
- refresh по new relevant accession, missing/corrupt raw, missing/failed previous ingest, previous failure и due full reconciliation;
- skip только при valid raw + successful previous ingest + unchanged accession/filing signature + no due reconciliation;
- Form 4, 13D/G и другие irrelevant forms не вызывают refresh;
- full reconciliation baseline 7 дней + deterministic 0–6 дней CIK stagger;
- payload валидируется и отправляется в local ingest до замены previous raw;
- failed download/ingest сохраняет previous good raw, SHA256 и success timestamps;
- per-CIK atomic manifest в `worker/cache/companyfacts/manifest/<cik>.json`;
- `--cached` остаётся offline recovery path, production ingest отклоняется до collection.

Manifest содержит CIK/ticker, lastCheckedAt, lastSuccessfulCapture, lastSuccessfulIngest, latest relevant accession/filingDate/form/signature, lastFullReconciliation, raw SHA256, refreshed/unchanged/failed status, bounded error и universe hash.

## 3. Operations graph и health

Новый independent job `sp500-facts-daily`:

- команда `npx tsx worker/facts-fetch.mts --universe edgar-universe.json`;
- cron `30 23 * * *` home local time;
- local MySQL и D:-only raw cache;
- нет research-series/research-factors dependencies;
- ошибка не блокирует research-51 dependency chain;
- общий per-CIK cache/manifest с research-51, один scheduler и один execution lane.

Daily Operations дополнительно читает manifests для unique CIK, refreshed/unchanged/failed/missing counts и последнего check time. Operations runbook, MACRO_DATA, RU/EN manuals, `docs/LLM_CONTEXT.md` и bundled manuals обновлены через существующие workflows.

## 4. Code verification и delivery

| Gate | Result |
|---|---|
| Targeted collector/registry/health tests | **26/26** |
| `npm run check` | Passed |
| Full suite | **116 test files / 633 tests passed** |
| `npm run build` | Passed; только chunk-size warnings |
| `git diff --check` | Passed |
| Credential-marker scan staged diff | No matches |
| Code commit / push | `f196acf`, fast-forward `d80bc9e..f196acf` |

Mocked SEC tests покрывают unchanged, new 10-Q, amendment, irrelevant Form 4, missing/corrupt raw, failed ingest retry, previous-good preservation, duplicate CIKs, interruption resume, full reconciliation interval, research-chain independence и production URL rejection.

## 5. Limited real smoke

Smoke universe ограничен тремя CIK: AAPL 320193, NVDA 1045810 и Agilent A 1090872. Полный universe не запускался как smoke.

Первый invocation завершился до SEC с путевой ошибкой `worker/worker/.runs/...`: `loadEdgarUniverse` ищет universe относительно `worker/`. После явной диагностики путь исправлен на `.runs/sp500-facts-smoke-universe.json`; это не был collector/network failure и не стал причиной full backfill или scheduler restart.

| CIK | Initial smoke | Verification smoke | Last relevant form |
|---|---:|---:|---|
| AAPL | refreshed, 25 598 facts | unchanged, 25 598 facts | 10-K, filed 2026-11-03 |
| NVDA | refreshed, 27 281 facts | unchanged, 27 281 facts | 10-Q, filed 2026-08-26 |
| A | refreshed, 34 068 facts; missing raw backfill | unchanged, 34 068 facts | 10-Q, filed 2026-09-01 |

Итог: initial `refreshed=3 / unchanged=0 / failed=0`; verification `refreshed=0 / unchanged=3 / failed=0`. Повторный download не понадобился. Raw SHA256 совпадает с manifest для всех трёх CIK. Logs: `20261104T023300Z-sp500-facts-smoke-initial.log`, `20261104T023405Z-sp500-facts-smoke-unchanged.log`.

## 6. Controlled scheduler reload

Smoke завершился успешно. `current=null`, `queue=[]`, active SEC collectors отсутствовали, HTTP 200, один web listener PID 5440, local INGEST_URL и MySQL доступны.

Старый scheduler chain был остановлен только после idle evidence. `schtasks /End` завершил task, но старая chain осталась активной, поэтому дополнительно завершены только подтверждённые старые PIDs 13116, 13592, 8080, 13616, 13688. Web server и другие процессы не затрагивались. ONLOGON installation не менялась.

Новый scheduler запущен через существующий task:

- `schedulerStartedAt=2026-11-04T02:37:07.601Z`;
- heartbeat `2026-11-04T02:37:22.614Z`;
- registry `67 jobs`, один execution lane;
- новая chain 5216 → 15548 → 16164;
- `current=null`, `queue=[]`.

Затем добавлен ровно один canonical request `owner-sp500-facts-initial-1793759900468` для `sp500-facts-daily`: command lines 3 → 4. Полный collector напрямую не запускался. Initial registered run `1793759902622-sp500-facts-daily`, `trigger=manual`.

## 7. Approximate progress reporting

Фиксированные веса этапов: implementation/tests/code commit 20%, real smoke 10%, controlled scheduler reload 10%, initial backfill 50%, final coverage/health/report/documentation commit 10%. Backfill оценивается по всем terminal CIK: `processed = refreshed + unchanged + failed + other terminal CIK`. Успешное и failed coverage всегда показывается отдельно и никогда не подменяется общим процентом выполнения.

Последний зафиксированный checkpoint без дополнительных polls:

```text
[████░░░░░░] ≈40–45% всего задания — IN_PROGRESS
Завершено: code/tests, real smoke, scheduler reload.
Текущий этап: initial backfill, 25/499 CIK processed (~5% этапа).
Coverage: 22 refreshed / 3 unchanged / 0 failed.
Осталось: backfill → coverage/health → final report/docs commit.
RunId: 1793759902622-sp500-facts-daily. Второй request не добавлялся.
```

Обновления прогресса выполняются только при смене этапа, примерно каждые 50 processed CIK или при terminal/blocked/failed state. Отдельные polls ради progress bar не делаются.

После backfill общий прогресс будет указан как ≈90%, даже если часть CIK failed; эти failures будут перечислены отдельно и останутся для следующего daily incremental run. 100% будет записано только после terminal scheduler state, coverage/health checks, final report и documentation commit/push. 100% выполнения задания не будет означать 100% успешного CIK coverage.

## 8. Initial backfill evidence

Run `1793759902622-sp500-facts-daily` завершился `2026-11-04T04:33:53.502Z` за 1h 55m с exit code 1 из-за шести failed CIK. Второй request и скрытые retries отсутствовали.

```text
[█████████░] ≈90% — backfill complete, final documentation pending
Processed: 499/499 CIK; coverage: 490 refreshed / 3 unchanged / 6 failed.
```

| Metric | Result |
|---|---:|
| Unique CIKs checked | **499** |
| Refreshed | **490** |
| Unchanged | **3** |
| Failed | **6** |
| Missing CIKs without successful ingest | **6** |
| Facts captured in run | **12 629 643** |
| Resumable manifests | **499** |
| MAX(lastCheckedAt) | `2026-11-04T04:33:53.335Z` |

Latest relevant form counts among 490 refreshed: **471 10-Q, 17 10-K, 1 10-K/A, 1 no-relevant-form**. Это counts последних relevant forms, а не утверждение, что все они были впервые опубликованы в этом run. VYLR (CIK 2128626) получил обновление по recovery/reconciliation без relevant accession в текущем recent subset.

### 8.1. Failed CIK для следующего daily incremental run

| CIK | Ticker | Error | lastCheckedAt |
|---|---|---|---|
| 27474 | TGT | SEC submissions HTTP 404 | 2026-11-04T02:45:55.902Z |
| 49280 | HAS | SEC submissions HTTP 404 | 2026-11-04T02:51:04.340Z |
| 704808 | WELL | companyfacts HTTP 404 | 2026-11-04T03:12:16.235Z |
| 773634 | PH | SEC submissions HTTP 404 | 2026-11-04T03:19:17.169Z |
| 1006367 | TROW | SEC submissions HTTP 404 | 2026-11-04T03:41:11.799Z |
| 1077205 | TPR | SEC submissions HTTP 404 | 2026-11-04T03:50:37.532Z |

Все six manifest records имеют `status=failed`, `lastSuccessfulIngest=null`, `rawSha256=null`. Немедленный retry не выполнялся; их следующий daily incremental run остаётся scheduled. Ошибка `sp500-facts-daily` не блокирует research-51 chain.

## 9. Final coverage и Daily Operations

`check-factor-coverage.mts` подтверждает **51/51 research-universe-51 factor companies**. Расширенный S&P collection universe не изменил research universe, IC, Atlas или factor/model/regime universes. Missing CIKs в factor coverage остаются вне research universe.

Fresh Daily Operations at `2026-11-04T04:42:33.716Z`:

- overall `critical`;
- scheduler online, heartbeat `2026-11-04T04:42:23.258Z`, `current=null`, `queue=[]`, 28 enabled jobs;
- checks: **12 OK / 2 warnings / 2 errors / 22 pending**;
- S&P facts coverage warning: **499 unique CIKs · 490 refreshed · 3 unchanged · 6 failed · 6 missing**;
- `sp500-facts-daily` error: exit code 1;
- Schwab daily evidence error: **0/51 captured today** for the new UTC date, while 51/51 latest chains remain readable and Feature Lab lineage is current;
- Atlas `partial` warning remains; macro QA `pass`, derivedCurrent `true`;
- остальные pending entries — будущие schedules/dependencies, не failures.

Scheduler process chain остаётся одна: 5216 → 15548 → 16164. Web listener один, PID 5440, HTTP 200. Нет duplicate collectors/schedulers/servers и нет production actions.

## 10. Evidence index и финальный статус

`worker/.runs/sp500-facts-final-evidence-index.json` содержит 8 artifacts: initial/verification smoke logs, backfill monitor, initial run log, factor coverage, Daily Operations log/json и manifest summary. Проверка: **8/8 SHA256 match, 0 mismatches**.

На момент этого отчёта выполнены terminal scheduler state и coverage/health checks. Progress остаётся ≈90% до documentation commit/push. После commit/push прогресс будет 100% выполнения задания, но **не 100% успешного CIK coverage**: six failed CIK остаются для следующего daily incremental run.


## 11. Post-backfill CIK mapping remediation — 2026-11-04

Первичный run остаётся историческим evidence и не переписывается. После него шесть HTTP 404 были проверены против официальной SEC [`company_tickers_exchange.json`](https://www.sec.gov/files/company_tickers_exchange.json) directory. Результат: все шесть failures вызваны неправильными ticker/CIK mappings в статическом GICS snapshot, а не отсутствием компаний в SEC.

Проверены **все 502 ticker mappings**: mismatches ровно шесть, missing tickers в SEC directory нет.

| Ticker | Неверный CIK в initial backfill | Правильный CIK по SEC |
|---|---:|---:|
| TGT | 27474 | **27419** |
| HAS | 49280 | **46080** |
| WELL | 704808 | **766704** |
| PH | 773634 | **76334** |
| TROW | 1006367 | **1113169** |
| TPR | 1077205 | **1116132** |

Исправлены `api/services/gics-snapshot.ts` и regenerated `worker/edgar-universe.json`. Membership snapshot остаётся `GICS_SNAPSHOT_AS_OF=2026-10-11`; добавлена отдельная дата `GICS_CIK_VERIFIED_ON=2026-11-04`, чтобы не выдавать CIK verification за пересъёмку состава индекса.

Новый sorted-unique-CIK universe SHA256: `cede4a6dfb3b3f20aecf08bd60ed7cad634e6ac146bfa8d6089cd4ba3a6a28ac`.

Regression test фиксирует все шесть правильных mappings, counts 502 rows / 499 unique CIKs, три ожидаемые duplicate-CIK pairs и новый universe hash. Изменение universe hash не вызывает полный backfill: refresh decision использует per-CIK raw/manifest state, а не universeHash как причину скачивания.

Старые manifests неправильных CIK сохранены как исторические failure evidence и не входят в текущий universe. Для правильных CIK отсутствуют raw/manifests, поэтому следующий daily incremental run сделает targeted backfill только этих и других due CIK. Немедленный второй run не выполнялся и не выполняется.
