# Alpha Engine — локальный аудит кода, research semantics и эксплуатации

## 1. Audit contract

- **auditedCommit:** `1b001ce4d0c86b4b86317971f1e23f3353d1f6d7` (`1b001ce`, `Update combined verification evidence`).
- **Ветка при начале аудита:** после безопасного fast-forward от `f7e5abb` до `1b001ce`, `main...origin/main` без расхождения.
- **Git status при фиксации findings:** `M public/reports/schwab-context.json`; untracked `public/reports/shock-calibration.json` и `public/reports/shock-calibration.md`. Это ранее существовавшие generated artifacts; они не анализировались как source и не включались в audit commit.
- **Время фиксации отчёта:** `2026-11-03T03:41:05Z`.
- **Финальный git status перед delivery:** `M docs/KIMI_CODE_HANDOFF.md`, `M public/reports/schwab-context.json`; untracked `docs/PROJECT_AUDIT_2026-11-03.md`, `public/reports/shock-calibration.json`, `public/reports/shock-calibration.md`. Только audit report и handoff входят в commit.
- **Время завершения аудита:** `2026-11-03T03:53:07Z`.
- **Разрешённые действия выполнялись только локально:** чтение кода/docs/artifacts, pure-function inline diagnostics, `npm run check`, `npm test -- --run`, `npm run lint`, `npm run build`, `npm audit`, `npm ls --depth=0`, anonymous HTTP status checks на `127.0.0.1:3000`.
- **Не выполнялись:** изменение source/tests/config/credentials, collectors, GPU jobs, GDELT, DB writes, миграции, production apply/deployment, cloud collection, повторная генерация reports.
- `api/lib/*`, `api/kimi/*` читались только для анализа границ; изменения в них не предлагаются без отдельного owner decision.

Отчёт предназначен для следующего Kimi-агента. Это не разрешение исправлять всё подряд. Сначала исправлять correctness/availability P0–P1 маленькими изменениями с regression tests; не заменять их новыми моделями, факторами или широкими рефакторингами.

## 2. Покрытие и ограничения

Инвентаризированы 675 tracked files, 530 TypeScript/TSX/MTS files и 6,192 строки Markdown до двух remote commits; после fast-forward добавлены Macro Ops и macro event study, которые также просмотрены. Проверены основные исполняемые пути API/auth/DB/statements/prices/import, React routes/UI, workers/collectors/scheduler, Schwab/SEC normalization, factor/vintage/macro/13F research, operations и все manuals в `docs`, включая `analytics/README.md`.

Построчный ручной разбор концентрировался на correctness-critical путях; огромные generated data (`src/data/*`, `public/reports/*`, `api/services/manuals-content.ts`) проверялись как artifacts, а не как самостоятельно написанный алгоритмический код. Полный suite и build не доказывают отсутствие semantic bugs. Production и его данные не исследовались.

### Сводка

- **Confirmed bugs/risks:** 23 — P0: 1, P1: 12, P2: 8, P3: 2.
- **Подозрения, требующие воспроизведения или решения о семантике:** 4.
- **Намеренное поведение / не является ошибкой:** 8 случаев, перечисленных отдельно.
- **Верификация auditedCommit:** `npm run check` — PASS; `npm test -- --run` — **108 files / 589 tests PASS**; `npm run build` — PASS с chunk-size warnings; `npm run lint` — FAIL, **168 errors / 1 warning**; `npm audit` — **24 dependency advisories: 1 low, 11 moderate, 12 high**.
- `package.json` и `package-lock.json` не менялись между `f7e5abb` и `1b001ce`, поэтому dependency audit относится к auditedCommit.

## 3. Confirmed bugs и подтверждённые риски

### F-01 — P0 — confirmed bug — latest-vintage factor values получают first-filed timestamp

- **Файл и строки:** `api/services/factors.ts:199-205`; `api/services/factor-ic.ts:24-55`; `api/services/probability-engine.ts:151-165`.
- **Механизм:** `computeCompanyFactors()` читает `series_points.vintage='latest'`. `materializeFactorPoints()` затем ставит этим значениям `MIN(filed)` по period. Поздняя ревизия может оказаться в historical factor row с availability раньше самой ревизии.
- **Доказательство:** прямая цепочка вызовов `materializeFactorPoints → computeCompanyFactors → conceptSeries` в указанных строках. `factor-points.test.ts:5-16` проверяет только timestamp mapping и не создаёт original/revised values. Полный suite 589/589 зелёный, поэтому этот случай не покрыт.
- **Expected vs actual:** при original value 100, filed 2025-02-01, и revised value 200, filed 2025-06-01, фактор на 2025-02-01 должен использовать 100; сейчас возможен 200 с availability 2025-02-01.
- **Предлагаемое исправление:** для первого correctness-fix строить research factor points из `first` vintage. Если нужны ревизии, заводить отдельные availability-anchored versions, а не смешивать latest value с first date. Не менять on-demand latest display без необходимости.
- **Regression test:** original/revised facts с разными `sourceFiled`; row на первую дату обязан содержать original, revised value не должен появиться раньше даты ревизии.
- **Риск изменения / модули:** изменятся fundamental factor values и все downstream IC/nested/sector evaluations. После локального reviewed rematerialization старые research-выводы надо переоценить. Это не основание продвигать или удалять модель.

### F-02 — P1 — confirmed bug — availability вычисляется по любому fact периода и имеет непомеченный +45d fallback

- **Файл и строки:** `api/services/factor-ic.ts:1-5,25-55`; `api/services/probability-engine.ts:154-165`; `api/services/fundamental-integrity.ts:154-170`; `api/services/factor-points.test.ts:5-16`.
- **Механизм:** `MIN(filed)` берётся по всем facts с тем же `endDate`, без concepts, необходимых фактору. При отсутствии даты назначается `periodEnd+45d`. Комментарий обещает `max(sourceFiled of period's concepts)` и estimated marker, но write row содержит только `cik/factor/periodEnd/filedAt/value`; integrity audit повторяет тот же периодический MIN и не замечает раннюю дату.
- **Доказательство:** SQL в `factor-ic.ts:52` и `probability-engine.ts:159`; отсутствие `availabilityBasis` в `FactorPointWriteRow` (`factor-ic.ts:16-22`).
- **Expected vs actual:** ранняя форма с unrelated tag не должна делать доступным фактор, требующий более поздний concept. Missing availability не должно превращаться в research-eligible estimated date без явного режима.
- **Предлагаемое исправление:** сохранять lineage required concepts и вычислять max first-filed среди них. Для research fail closed при отсутствии реальной даты; estimated display, если нужен, должен иметь отдельный `availabilityBasis` и исключаться из backtests.
- **Regression test:** unrelated fact filed 2025-02-01, required concept filed 2025-04-15; factor availability должна быть не раньше 2025-04-15. Missing required concept — no research row.
- **Риск изменения / модули:** `factor_points`, integrity audit, probability/IC; часть строк исчезнет из research, что корректнее завышенного покрытия.

### F-03 — P1 — confirmed bug — 13F event availability может предшествовать реальной публикации

- **Файл и строки:** `scripts/13f-refresh.mts:286-306`; `worker/lib/thirteenf.ts:209-224`; `api/services/probability-engine.ts:73-92`.
- **Механизм:** `--rebuild-events` подставляет `curQ` при отсутствии `filingDate`; `buildPositionRow` использует её как `eventTs`. Probability engine отдельно ставит aggregate flow `quarterDate+45d`, игнорируя уже существующие `fund_quarters.filingDate` и более поздние amendments.
- **Доказательство:** `eventDate = ... : curQ` (`13f-refresh.mts:304`) и `filedAt: plusDays(q,45)` (`probability-engine.ts:91`). Quarter-end раньше legal filing window; +45d может быть раньше amendment.
- **Expected vs actual:** сигнал не должен появляться раньше фактической даты filing/amendment. Missing filingDate должен блокировать research event, а не создавать раннюю availability.
- **Предлагаемое исправление:** использовать фактическую max filingDate для merged book; missing date — skip/fail с явным remediation. Aggregate availability считать по всем включённым fund/books, а не по календарному +45d.
- **Regression test:** Q-end 2025-03-31, original filed 2025-05-10, amendment filed 2025-06-01; ни event, ни flow не доступны раньше соответствующей публикации. Missing metadata не создаёт row.
- **Риск изменения / модули:** исторические 13F event timestamps и probability/flow evaluations; потребуется reviewed rebuild, не production apply.

### F-04 — P1 — confirmed bug — macro prior игнорирует realtime vintage windows

- **Файл и строки:** `api/services/probability-engine.ts:174-186`; `api/services/macro.ts:7-8,73-84`; `db/schema.ts:815-831`.
- **Механизм:** schema сохраняет `realtimeStart/realtimeEnd`, но `macroPriorAt` выбирает только `date <= anchor`. Можно взять значение, выпущенное/ставшее доступным после anchor. `latestMacro()` также делает `ORDER BY date DESC LIMIT 1` без выбора действующего vintage.
- **Доказательство:** SQL в `probability-engine.ts:175-181` не содержит realtime predicate, хотя `macro.ts:7-8` объявляет window обязательным.
- **Expected vs actual:** для anchor T допустима только строка с `date <= T`, `realtimeStart <= T` и ещё не завершившимся `realtimeEnd`; revised-after-T значение недопустимо.
- **Предлагаемое исправление:** добавить as-of vintage selection; legacy null windows явно маркировать unknown и не использовать как PIT evidence без отдельного правила. Dashboard должен выбирать current vintage.
- **Regression test:** одна observation date с original/revised rows; на anchor до revised start выбирается original, после — revised.
- **Риск изменения / модули:** macro prior и historical probability results изменятся; требуется новая оценка, не подгонка thresholds.

### F-05 — P1 — confirmed bug — composite exposure metrics имеют неверные availability и period alignment

- **Файл и строки:** `api/services/company-exposure.ts:64-90,101-128,137-149`; `api/services/macro-scenarios.ts:88-108`.
- **Механизм:** TTM берёт `points[0].sourceFiled`, current/noncurrent debt — current date, ratio — numerator date, foreign share — domestic date. Нужен max по всем inputs. Общий `ratio()` проверяет units, но не равенство `periodEnd`.
- **Доказательство:** pure inline `buildCompanyExposure` diagnostic: более поздняя ревизия 2026-02-20 дала `sourceFiled=2026-01-15`; debt Q4 против operating income TTM Q3 вернул число `3.333…`, а не missing.
- **Expected vs actual:** derived value доступно только когда известны все входы и все они совместимы по period. Ожидалось `max(...sourceFiled)` и reject/partial при разных periods; actual — дата одного компонента и числовой результат при mismatch.
- **Предлагаемое исправление:** общий `maxAvailability(inputs)`; fail closed при unknown required availability. TTM — max по четырём points, ratios — max обоих; требовать одинаковый `periodEnd` и unit.
- **Regression test:** late revision одного старого квартала должна сдвинуть TTM availability; Q4/Q3 ratio должен быть missing/partial, не `available`.
- **Риск изменения / модули:** company exposure reports и Scenario Engine debt gate; reviewed report rebuild. Не менять macro model.

### F-06 — P1 — confirmed bug — owner-only reports доступны без authentication

- **Файл и строки:** `api/lib/vite.ts:9-21`; `api/boot.ts:97-104`; `src/App.tsx:73-80`; `src/components/SchwabContext.tsx:35-40`.
- **Механизм:** AdminOnly защищает только React rendering. `serveStatic` публикует всё из `dist/public`, включая `public/reports`; frontend сам загружает JSON по публичному URL.
- **Доказательство:** локальные anonymous requests: `200 /reports/daily-operations.json`, `200 /reports/expectations-report.json`, `200 /reports/schwab-context.json`; контрольный `401 /api/trpc/auth.me`.
- **Expected vs actual:** owner-only report должен возвращать 401/403 без session; сейчас credential-free, но бизнес/research/operations data публичен. API auth сам по себе исправен.
- **Предлагаемое исправление:** перенести private reports из `public` в локальное private storage и отдавать через authenticated admin route. Не полагаться на скрытие route/nav.
- **Regression test:** unauthenticated GET каждого report → 401/403; admin → 200; обычный user без admin → 403.
- **Риск изменения / модули:** report builders/output paths, Market/Expectations/Operations UI, local dist packaging. Generated migration выполнять отдельно и reviewed.

### F-07 — P1 — confirmed bug — generic worker ingest по умолчанию пишет в production

- **Файл и строки:** `worker/lib/ingest.ts:42-63,82-99`; `scripts/daily-digest.mts:73`; `worker/edgar-tone.mts:92`; `scripts/push-local-signals.mts:159`; mitigation `worker/lib/operations-scheduler.ts:270-275`.
- **Механизм:** без `INGEST_URL` и opts все три helper-а используют `PROD_INGEST_URL`. Scheduler подставляет local URL, но прямой documented terminal запуск вне scheduler может записать в production, минуя reviewed push.
- **Доказательство:** fallback `?? PROD_INGEST_URL` во всех helpers; `daily-digest` и `edgar-tone` вызывают helpers без URL. Stocktwits после `f7e5abb` имеет собственный local fallback и не является текущим нарушителем.
- **Expected vs actual:** default collection destination — local only; production только явный reviewed apply.
- **Предлагаемое исправление:** убрать production default из generic helpers: требовать explicit URL либо local default. В `push-local-signals` и других reviewed apply явно передавать production URL.
- **Regression test:** без env production request не выполняется; local collector выбирает loopback; reviewed push работает только с явным production argument.
- **Риск изменения / модули:** digest, tone, GDELT compatibility, reviewed push scripts. Проверить все callers до изменения.

### F-08 — P1 — confirmed bug — price archive resume/import не пагинирует и не дедуплицирует parts

- **Файл и строки:** `api/lib/storage.ts:137-154,424-429` (только как API evidence); `api/services/price-import.ts:152-168,222-227`; `src/components/PriceImportCard.tsx:75-97`.
- **Механизм:** `listFiles` возвращает максимум 100 объектов, pagination token игнорируется. SDK добавляет случайный suffix, поэтому retry после сохранённого part создаёт второй объект с тем же idx. Resume делает Set indices, importer сортирует keys и передаёт все объекты в один ZIP stream, включая duplicates и только первую страницу.
- **Доказательство:** documented `maxKeys=100` и `nextPageToken` в storage contract; отсутствие pageToken/dedupe/contiguous validation в обоих service paths. `sendPiece` повторяет TypeError после возможной server commit.
- **Expected vs actual:** >100 parts и duplicate idx должны обрабатываться детерминированно; сейчас возможны truncated/corrupt archive и missing bars. Adaptive 1 MB parts для ~516 MB архива уже превышает 100.
- **Предлагаемое исправление:** в `price-import.ts` пройти все страницы, сгруппировать по idx, сверить size/etag, fail on conflict/gaps, выбрать ровно один корректный object на idx. Не менять protected storage SDK.
- **Regression test:** mock 101+ objects over two pages, duplicate idx with same content и duplicate with conflict; importer выбирает корректный stream либо явно падает до DB writes.
- **Риск изменения / модули:** chunk resume UI/server и price import; storage API остаётся прежним.

### F-09 — P1 — confirmed bug — scheduler не гарантирует single process и может оставить orphan job

- **Файл и строки:** `worker/operations-scheduler.mts:5-8`; `worker/lib/operations-scheduler.ts:169-190,245-300`; `worker/operations-scheduler-install.ps1:11-12`; `docs/KIMI_CODE_HANDOFF.md:120`.
- **Механизм:** нет process lock/singleton ownership. `stop()` останавливает только timer, но не child. Новый start объявляет persisted current failed, не доказав смерть процесса, и может запустить duplicate. Два scheduler процесса делят JSON state без межпроцессной синхронизации.
- **Доказательство:** code inspection и реальный предыдущий инцидент: `schtasks /End` оставил detached tree, пришлось завершать его отдельно; handoff это фиксирует. Duplicate запуск специально не воспроизводился.
- **Expected vs actual:** один scheduler и не более одного job-process; restart не должен создавать второй collector.
- **Предлагаемое исправление:** OS-backed singleton lock с owner PID, child PID tracking и завершение/усыновление только после доказанного состояния. Не полагаться на heartbeat как lock.
- **Regression test:** второй instance отклоняется; SIGTERM завершает child; restart при живом child не создаёт duplicate; stale lock после мёртвого PID безопасно восстанавливается.
- **Риск изменения / модули:** Windows task/hidden launcher, scheduler state/recovery, все collectors. Требуется осторожный локальный rollout.

### F-10 — P1 — confirmed bug — missing debt превращается в нулевой debt

- **Файл и строки:** `api/services/statements.ts:375-407`.
- **Механизм:** `stDebt` и `ltDebt` получают `?? 0`; при наличии cash и отсутствии debt facts `netDebt = -cash`. Невозможно отличить настоящий нулевой долг от missing data.
- **Доказательство:** pure inline `buildStatements`: cash=100, оба debt components missing → `{v:-100}`.
- **Expected vs actual:** missing required components → null/partial; explicit reported zero может дать -100, missing не может.
- **Предлагаемое исправление:** не заменять missing на 0. Использовать curated total-debt fallback либо требовать обе components/explicit zero и возвращать null.
- **Regression test:** cash=100 + missing debt → null; cash=100 + явные нули → -100; частично известный долг → partial/null по контракту.
- **Риск изменения / модули:** Fundamentals Statements и downstream потребители netDebt; у valuation есть отдельные формулы, их не менять автоматически.

### F-11 — P1 — confirmed bug — TTM принимает четыре непоследовательных квартала

- **Файл и строки:** `api/services/statements.ts:413-432`; сравнить корректную проверку в `api/services/company-exposure.ts:73-90`.
- **Механизм:** `ttm()` суммирует четыре видимые позиции и проверяет только `have===4`; календарная смежность не проверяется. Grid может пропускать квартал, что сам проект уже признаёт в YoY regression.
- **Доказательство:** pure inline diagnostic вернул periods `[2026-03,2025-09,2025-06,2025-03]` и `roeTtm=roaTtm=0.1`; пропущен 2025-12.
- **Expected vs actual:** non-consecutive TTM должен быть null или явно partial; actual — полноценный numeric TTM.
- **Предлагаемое исправление:** проверять quarter indices каждой пары и required duration, а не только count. Повторить cadence discipline из company exposure.
- **Regression test:** четыре значения с пропущенным кварталом → null/partial; четыре смежных → сумма; 53-week fiscal calendar обрабатывается по фактическим period ends.
- **Риск изменения / модули:** ROE/ROA Statements; company exposure уже имеет отдельную правильную проверку.

### F-12 — P1 — confirmed bug — Stocktwits upstream failures завершаются success и health видит OK

- **Файл и строки:** `worker/stocktwits.mts:28-60`; `worker/lib/daily-operations-report.ts:114-123`.
- **Механизм:** каждый ticker failure только warn. При нуле rows выполняется `process.exit(0)`; partial failures тоже не влияют на exit code. Daily Operations считает любой `done` моложе 120 минут успехом, отдельного per-ticker artifact нет.
- **Доказательство:** прямая ветка catch→rows empty→exit(0) и health check по `last.status==='done'`. Сетевая ошибка специально не вызывалась.
- **Expected vs actual:** все upstream failures → nonzero/error; valid empty messages от успешного HTTP — допустимый empty result, не ошибка. Частичное покрытие должно быть явным.
- **Предлагаемое исправление:** считать transport/provider failures отдельно от valid empty streams; fail all-failed, публиковать per-ticker failures для health. Не делать rows.length===0 универсальным failure.
- **Regression test:** все HTTP failed → nonzero + daily error; все valid empty → success; один failed ticker → явное partial состояние.
- **Риск изменения / модули:** Stocktwits scheduler и daily report; LLM probation semantics не менять.

### F-13 — P1 — confirmed security weakness — admin create/reset допускает пароль из одного символа

- **Файл и строки:** `api/routers/admin.ts:167-210`; `api/services/passwords.ts:47-51`; `docs/ALPHA_ENGINE_MANUAL_EN.md:706-731`.
- **Механизм:** public signup применяет password policy, admin create/reset — только `min(1)`. Исторические manuals дополнительно содержат слабые default credentials; их актуальность отдельно в S-01.
- **Доказательство:** zod schemas и явные комментарии `skip public policy` / `no policy`; вызов `passwordPolicyError` отсутствует.
- **Expected vs actual:** privileged passwords должны соответствовать той же или более строгой политике, независимо от того, кто их задаёт.
- **Предлагаемое исправление:** применять общую policy в create/reset и UI; старые слабые пароли проверить/сменить отдельно владельцу.
- **Regression test:** короткий/admin-only numeric password отклоняется, валидный принимается и для user, и для admin.
- **Риск изменения / модули:** Admin Users API/UI; существующие hashes не меняются, миграция не нужна.

### F-14 — P2 — confirmed dependency risk — 24 advisories, включая production-relevant пакеты

- **Файл и строки:** `package.json`; `package-lock.json`; runtime usage `api/lib/vite.ts:3-12`, `api/services/worker.ts:120-146`.
- **Механизм:** установлены версии в advisory ranges. Прямые примеры: `@hono/node-server@1.19.17`, `vite@7.3.0`, `zod@4.3.5`. Это подтверждённые advisories, не доказанная exploitability каждого пути.
- **Доказательство:** `npm audit --audit-level=high` → 24 (1 low, 11 moderate, 12 high); `npm ls --depth=0`. Особо relevant: Hono static double-decode, Zod oversized collections, Vite path traversal/dev server; остальные транзитивные/dev риски не смешивать с production exploits.
- **Expected vs actual:** зависимости обновлены до patched совместимых версий или имеется documented accepted risk; сейчас audit gate красный.
- **Предлагаемое исправление:** сначала non-breaking `npm audit fix` в отдельном change и полные gates; не запускать `--force` вслепую — audit предлагает breaking drizzle-kit/@hono-vite-dev-server changes. Production и dev advisories разделить.
- **Regression test:** `npm audit` в CI + targeted static path/auth/body-limit tests; после update повторить 589+ tests/build и local HTTP checks.
- **Риск изменения / модули:** lockfile, build/dev tooling, static server, validation. Не совмещать dependency update с correctness fixes.

### F-15 — P2 — confirmed bug — Schwab VWAP/opening range включает extended hours и UTC day

- **Файл и строки:** `worker/schwab-context.mts:46-48`; `worker/lib/schwab-context.ts:75-91`; `src/components/SchwabContext.tsx:70-73`.
- **Механизм:** collector запрашивает `needExtendedHoursData=true`; summarizer группирует по UTC date и берёт первые 30 минут, без America/New_York regular session. Premarket становится opening range, VWAP смешивает extended/regular.
- **Доказательство:** pure inline diagnostic с шестью premarket bars high=50/low=40 и regular bars high=100/low=90 вернул `openingRangeHigh=50`, `openingRangeLow=40`, общий VWAP `61.666…`.
- **Expected vs actual:** session opening range — 09:30–10:00 America/New_York, ожидаются 100/90 в fixture. Extended-hours metric допустим только как отдельно названный показатель.
- **Предлагаемое исправление:** фильтровать regular session по exchange timezone/date; extended считать отдельно либо не использовать для session VWAP/opening.
- **Regression test:** premarket + regular + postmarket в одном UTC day и через midnight; проверить DST переходы.
- **Риск изменения / модули:** Schwab Context UI/report only, option chains и daily RV20 не затрагиваются.

### F-16 — P2 — confirmed bug — missing instrument уменьшает context coverage denominator

- **Файл и строки:** `worker/lib/schwab-context.ts:94-113`; `worker/schwab-context.mts:69-87`.
- **Механизм:** expected = `7 + Object.keys(instruments).length`, но missing instruments исключены из этого record и уже присутствуют как failed files. Denominator должен исходить из expected universe, не успешных reads.
- **Доказательство:** pure inline diagnostic с 7 successful network files + 1 failed instrument и `instruments:{}` вернул `{expected:7,complete:7,errors:1}` при восьми files.
- **Expected vs actual:** ожидалось `expected=8, complete=7, errors=1`; actual формально `7/7` с ошибкой.
- **Предлагаемое исправление:** передавать `tickersExpected` из universe в report builder; expected = 7 + tickersExpected. Сохранить errors.
- **Regression test:** ровно fixture из diagnostic; отсутствие всех instruments не должно уменьшать expected.
- **Риск изменения / модули:** Schwab Context report/UI/daily health; небольшой contract-compatible fix.

### F-17 — P2 — confirmed security weakness — годовые sessions не отзываются при password reset

- **Файл и строки:** `api/kimi/session.ts:7-16,18-39`; `api/kimi/auth.ts:56-71`; `api/queries/users.ts:94-96`; `api/auth-router.ts:39-52`.
- **Механизм:** JWT живёт один год и не содержит session id/token version. Reset меняет только passwordHash; старый JWT остаётся валидным. Logout удаляет browser cookie, но не делает украденный token недействительным.
- **Доказательство:** sign/verify path и отсутствие revocation state; `authenticateRequest` продолжает находить user по unionId.
- **Expected vs actual:** password reset должен отзывать прежние sessions; logout/revocation должно иметь серверный механизм.
- **Предлагаемое исправление:** короткий TTL + server-side session/tokenVersion, поворот версии при reset; revocation при logout по session id. Любая schema-миграция только после отдельного owner decision.
- **Regression test:** login → reset → old token rejected, new login accepted; deleted user и revoked session отклоняются.
- **Риск изменения / модули:** вся auth/session цепочка и существующие пользователи; rollout требует отдельного плана.

### F-18 — P2 — confirmed documentation bug — manuals разрешают устаревшие unsafe маршруты

- **Файл и строки:** `docs/ALPHA_ENGINE_MANUAL_EN.md:1061,1414`; `docs/ALPHA_ENGINE_MANUAL.md:1058,1411`; `docs/LLM_CONTEXT.md:71,96-104`; `contracts/operations.ts:29-33`; current policy `AGENTS.md` §3.
- **Механизм:** manuals предписывают digest без INGEST_URL отправлять straight to prod и Stocktwits deterministic STRAIGHT to prod; LLM_CONTEXT содержит старые `/mnt/agents/output` paths и противоречивые auth statements. Это конфликтует с reviewed-only boundary и текущим Stocktwits code.
- **Доказательство:** docs grep по `straight to prod`, `STRAIGHT to prod`, default credential references и old paths; F-07 подтверждает, что generic fallback всё ещё делает угрозу реальной.
- **Expected vs actual:** один актуальный local-first operational contract; исторические решения явно помечены superseded и не выглядят инструкцией к исполнению.
- **Предлагаемое исправление:** точечно обновить RU/EN manuals, LLM_CONTEXT и operations destination; историю перенести в changelog. После docs изменений синхронизировать bundled manuals отдельной генерацией.
- **Regression test:** docs policy check не находит активных direct-prod инструкций/default credentials; bundle соответствует source manuals.
- **Риск изменения / модули:** docs/UI manuals only; не менять collectors по тексту без отдельного code review.

### F-19 — P2 — confirmed UI bug — вложенные `<button>` в Jobs

- **Файл и строки:** `src/pages/Jobs.tsx:322-370`, особенно outer button `:325` и inner cancel button `:347`.
- **Механизм:** строка job — `<button>`, внутри неё второй `<button>` cancel. Вложенные interactive controls нарушают HTML content model и дают непредсказуемое keyboard/event поведение.
- **Доказательство:** статический DOM contract; lint это не ловит, текущие UI tests не проверяют Jobs console.
- **Expected vs actual:** selection и cancel — самостоятельные доступные controls без `button button` в DOM.
- **Предлагаемое исправление:** разделить row/select и cancel либо использовать не-button row с корректной keyboard semantics; сохранить stopPropagation только где нужно.
- **Regression test:** `container.querySelector('button button') === null`; keyboard select/cancel, axe accessibility check.
- **Риск изменения / модули:** Jobs UI только, server cancellation API не затрагивается.

### F-20 — P2 — confirmed data-integrity risk — metric history replacement не транзакционна

- **Файл и строки:** `api/services/metric-history.ts:253-257`.
- **Механизм:** per-company DELETE и до-500-row INSERT chunks выполняются без transaction. Ошибка после delete оставляет пустую/частичную историю, аналогично ранее исправленному facts-wipe классу.
- **Доказательство:** прямая последовательность `db.delete` затем отдельные inserts; отсутствие transaction.
- **Expected vs actual:** старая история сохраняется до успешной полной замены; любая ошибка откатывает всю замену.
- **Предлагаемое исправление:** обернуть delete+all inserts в одну DB transaction, проверку ошибок/cancel выполнять до delete.
- **Regression test:** failure во втором chunk сохраняет прежние rows; успешная замена атомарна.
- **Риск изменения / модули:** metric-history builder и quote charts; DB schema не меняется.

### F-21 — P3 — confirmed observability gap — scheduler preflight игнорирует большинство requirements

- **Файл и строки:** `worker/lib/operations-scheduler.ts:141-153`; registry requirements в `contracts/operations.ts`.
- **Механизм:** preflight проверяет parent status, server и GPU, но не network/mysql/driveD/review. Это не доказательство неверных данных: jobs могут честно упасть позже; проблема — поздняя диагностика и misleading registry contract.
- **Доказательство:** полный preflight состоит только из указанных двух endpoint checks.
- **Expected vs actual:** либо requirements действительно проверяются, либо явно называются documentation/capability labels.
- **Предлагаемое исправление:** реализовать небольшие read-only probes для mysql/D:/network там, где это безопасно; `review` оставить policy metadata, не pretend automated approval.
- **Regression test:** requirement matrix для каждого mode и failed probe → job не spawn-ится с понятной причиной.
- **Риск изменения / модули:** scheduler start latency и failure semantics; не запускать collectors для probes.

### F-22 — P2 — confirmed quality-gate failure — ESLint не проходит

- **Файл и строки:** примеры `api/services/statements.ts:381,467`, `api/auth-router.ts:36`, `src/pages/Jobs.tsx:29-42`, `worker/lib/edgar.ts:325,399-400`; полный список выдаёт `npm run lint`.
- **Механизм:** 168 errors/1 warning: преимущественно explicit any, но также no-self-assign, unused values, React rules и invalid whitespace. Это не 168 отдельных bugs и не отменяет green tests.
- **Доказательство:** `npm run lint` на auditedCommit завершился exit 1: `169 problems (168 errors, 1 warning)`.
- **Expected vs actual:** lint gate либо зелёный, либо осознанно исключён из quality contract с узкими suppressions; текущий script постоянно красный и маскирует новые проблемы.
- **Предлагаемое исправление:** после correctness P0–P1 исправлять категории небольшими PR; self-assign/dead code отдельно от typing. Не отключать правила глобально и не делать одну гигантскую автозамену.
- **Regression test:** `npm run lint` в обязательном CI; новые suppressions с причиной и сроком.
- **Риск изменения / модули:** много файлов, поэтому не смешивать с availability fixes.

### F-23 — P3 — confirmed performance/packaging issue — Expectations chunk 11.1 MB

- **Файл и строки:** `src/data/expectations-report.ts`; lazy import `src/App.tsx:23`; `docs/EXPECTATIONS_COHORTS.md:108-115`.
- **Механизм:** большой generated dataset включается в JS chunk. Даже lazy route скачивает 11,112.68 kB minified / 1,717.57 kB gzip; Babel deoptimises файл. Это performance issue, не correctness bug.
- **Доказательство:** `npm run build` output `Expectations-*.js 11,112.68 kB | gzip 1,717.57 kB`; lint Babel warning >500 KB.
- **Expected vs actual:** страница загружает нужные срезы по запросу, а не весь dataset одним chunk.
- **Предлагаемое исправление:** отдавать summary и per-company/per-period slices через тот же authenticated report route, что решает F-06; не переписывать Expectations UI целиком.
- **Regression test:** bundle-size budget, cold-load Expectations на throttled network, проверка полного evidence access без потери filters.
- **Риск изменения / модули:** Expectations data/UI и report delivery; generated data pipeline меняется отдельно.

## 4. Подозрения — воспроизведение или решение владельца обязательно

### S-01 — P0 при подтверждении — suspicion — опубликованные default credentials могут оставаться активными

- **Файл и строки:** `docs/ALPHA_ENGINE_MANUAL_EN.md:706-731,1528`; `docs/ALPHA_ENGINE_MANUAL.md:702-725,1534`; `docs/LLM_CONTEXT.md:71`.
- **Механизм:** manuals содержат конкретные слабые admin/demo passwords. Активность сейчас не доказана; независимо от этого F-13 разрешает создавать новые слабые пароли.
- **Доказательство:** docs grep. Никаких login attempts или credential reads не выполнялось.
- **Expected vs actual:** все defaults сменены и удалены из оперативной документации; если уже сменены, это только unsafe historical docs, не active compromise.
- **Предлагаемое исправление:** владельцу проверить и сменить credentials вне этого audit; затем удалить literals из manuals. Rotation не выполнять следующему агенту без явного решения владельца.
- **Regression test:** policy test из F-13 + owner-controlled confirmation, что defaults не работают; никакого automated prod probing.
- **Риск / модули:** полный admin account; docs history removal требует отдельного решения, history rewrite запрещён текущими границами.

### S-02 — P1 при PIT-использовании — suspicion — metric history игнорирует `sourceFiled` при month-end selection

- **Файл и строки:** `api/services/metric-history.ts:108-117,163-168,211-235`.
- **Механизм:** `valueAsOf` и `epsTtmAsOf` фильтруют только `periodEnd<=T`, хотя query возвращает `sourceFiled`. Поздняя ревизия может изменить более ранний month-end. Возможно, это намеренный latest-revised display, а не PIT dataset.
- **Доказательство:** code inspection; безопасное end-to-end различие display-vs-research semantics не выполнялось.
- **Expected vs actual:** если rows используются как availability-anchored evidence, нужен `sourceFiled<=T`; если это latest-revised display, это должно быть явно задокументировано и запрещено для backtests.
- **Предлагаемое исправление:** сначала зафиксировать семантику. Для PIT — фильтровать availability и max availability по TTM inputs; для display — явный `vintageMode='latest-revised'` и guard против research reuse.
- **Regression test:** revised EPS/shares после месяца не меняет PIT row, но меняет latest-revised row согласно выбранному контракту; non-consecutive EPS quarters не дают полный TTM.
- **Риск / модули:** metric history charts, возможные research consumers; не менять до решения о назначении.

### S-03 — P2 — suspicion — public auth stores могут быть использованы для memory/CPU exhaustion

- **Файл и строки:** `api/auth-router.ts:59,69-76`; `api/services/captcha.ts:13-32,57-63`; `api/services/login-guard.ts:16-26,43-53`.
- **Механизм:** captcha public endpoint не имеет rate limit и сохраняет entries; каждая выдача обходит весь store. Login attempts принимает произвольные usernames и не имеет глобальной очистки. Это подтверждённое отсутствие bounds, но реальный DoS не воспроизводился.
- **Доказательство:** code inspection; нагрузочный тест не запускался по ограничениям audit.
- **Expected vs actual:** bounded memory и bounded work per public request; сейчас рост зависит от потока запросов.
- **Предлагаемое исправление:** per-IP captcha/login limits, global periodic sweep, max entries и cheap rejection; не ломать одноразовость captcha.
- **Regression test:** fake timers + превышение max entries/attempts; memory остаётся capped, legitimate flow продолжает работать.
- **Риск / модули:** public auth availability и rate-limit semantics; distributed proxy behavior проверить отдельно.

### S-04 — P2 — suspicion — доверие к первому `x-forwarded-for` может обходить throttling

- **Файл и строки:** `api/services/activity.ts:11-14`; `api/auth-router.ts:79,119`.
- **Механизм:** первый XFF hop принимается без trusted-proxy validation. Если platform не перезаписывает header, клиент может менять IP и обходить per-IP guards/писать неверную telemetry. Настройки внешнего proxy в локальном коде не подтверждены.
- **Доказательство:** code inspection только; production headers не проверялись.
- **Expected vs actual:** IP определяется доверенным proxy contract, не произвольным client header.
- **Предлагаемое исправление:** задокументировать proxy behavior и использовать trusted hop/platform header; direct local requests не принимать XFF как доказанный IP.
- **Regression test:** spoofed XFF не меняет rate-limit identity при недоверенном proxy; реальный platform header продолжает работать.
- **Риск / модули:** login/signup throttling и activity telemetry; не менять вслепую без proxy facts.

## 5. Не является ошибкой / намеренное поведение

| Проверка | Почему не оформлено как bug | Оставшееся ограничение |
|---|---|---|
| `worker/schwab-fetch.mts:91-162` завершает universe при partial tickers | Явно сохраняет partial manifest; daily health считает manifest errors. Не требовать fail-all без смены policy. | Dependencies могут строить partial reports; это допустимо только при видимом health gate. |
| `api/services/shock-calibration.ts:82-90,119-145` выбирает latest vintage per observation | Это явная policy для текущей калибровки shock presets, а не first-release event study. | Нельзя переиспользовать эту реализацию как PIT backtest без смены режима. |
| `api/services/macro-event-study.ts:111-153` | first-release rows и baseline ограничены event eligibility; outcomes после publication day и доступные к report asOf. Подтверждённого look-ahead в просмотренном пути не найдено. | Малые event counts остаются coverage limitation, не code bug. |
| `api/services/causal-imputation.ts:127-172` | two-sided smoother явно `usesFutureObservation` и получает следующий `sourceFiled`; не маскируется под causal forecast. | Не подставлять в более ранние signals. |
| `worker/lib/expected-move.ts:4-6` и `schwab-features.test.ts:21-42` | 0DTE expected move корректно null; подозрение не подтвердилось. | Intraday time-to-close отдельно не моделируется. |
| `/admin` без обёртки AdminOnly в `src/App.tsx:72` | server `adminQuery` и явное UI error handling остаются authorization boundary; прямого bypass не найдено. | Единообразие guards можно улучшить косметически. |
| `worker/lib/ingest.ts:60-77` не проверяет `res.ok` | `fetchJson` отклоняет HTTP errors, а успешный route возвращает `ok:true`; конкретного success-with-error пути не найдено. | Defensive `if (!res.ok)` полезен как P3 hardening, не confirmed data loss. |
| Pending/stale generated reports и исторические test counts | Не являются code bugs без независимого механизма; handoff прямо помечает старые counts историческими. | Freshness проверять отдельно от correctness; stale data не использована как доказательство дефекта. |

## 6. Рекомендуемый порядок работ для следующего агента

1. **Сначала research correctness:** F-01, F-02, F-03, F-04, F-05. Маленькие targeted fixes и synthetic vintage regressions. До завершения не делать новых выводов из затронутых factor/13F/macro evaluations.
2. **Затем numeric correctness:** F-10, F-11, F-15, F-16. Каждый fix отдельно, с приведёнными fixtures.
3. **Production/local boundary и доступ:** F-06, F-07, F-13; S-01 передать владельцу отдельно, без самостоятельной credential rotation.
4. **Операционная надёжность:** F-08, F-09, F-12, F-20. Не запускать duplicate scheduler/collectors для доказательства — использовать mocks/temp state.
5. **После correctness:** F-14, F-17, F-18, F-19, F-21, F-22, F-23 и подозрения с доказанной семантикой.
6. После каждого пакета: targeted regression, `npm run check`, `npm test -- --run`, `npm run build`, `git diff --check`. Generated rematerialization и любые production/migration actions — только отдельные reviewed решения владельца.

## 7. Что было проверено успешно и не требует исправления по результатам audit

- TypeScript check и production build проходят; отсутствие type errors не закрывает semantic issues выше.
- Все 108 test files / 589 tests проходят. Новые regression cases должны проверять именно vintage, missing data, duplicate process и failure paths, которых сейчас нет.
- `series.ts` хранит first/latest vintages и as-of rule на уровне базового контракта; проблема F-01 возникает в factor materialization поверх него, а не в самом наличии vintage data.
- Schwab option normalization сохраняет null для отсутствующих numeric fields и переводит IV percent в decimal (`worker/lib/schwab-normalize.ts:57-65`); expectedMove имеет zero-DTE guard.
- Company exposure уже помечает non-consecutive TTM как partial; аналогичную cadence дисциплину нужно перенести только в Statements TTM, не переписывая остальное.
- Macro event study и causal imputation содержат явные availability guards; нет оснований обвинять их в look-ahead на основании одного использования outcomes.

## 8. Delivery scope этого audit

В Git коммитятся только `docs/PROJECT_AUDIT_2026-11-03.md` и обновлённый `docs/KIMI_CODE_HANDOFF.md`. Source code, tests, config, credentials и generated production data не изменялись и не включаются в commit.
