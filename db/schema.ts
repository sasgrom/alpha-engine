import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  mediumtext,
  timestamp,
  int,
  boolean,
  double,
  date,
  datetime,
  bigint,
  uniqueIndex,
  index,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  /** Kimi identity for OAuth-era rows; local accounts use 'local:<username>' */
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  /** 4d (D33): local login identity, unique; NULL for pre-4d rows */
  username: varchar("username", { length: 64 }).unique(),
  /** 4d (D33): scrypt PHC string (services/passwords.ts); never logged */
  passwordHash: varchar("passwordHash", { length: 255 }),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ---------------------------------------------------------------------------
// ALPHA-BAYES-MOE-1.0 — Stage 1 tables
// ---------------------------------------------------------------------------

export const companies = mysqlTable(
  "companies",
  {
    cik: int("cik").primaryKey(),
    ticker: varchar("ticker", { length: 20 }).notNull(),
    name: varchar("name", { length: 255 }),
    sic: varchar("sic", { length: 16 }),
    sicDescription: varchar("sicDescription", { length: 255 }),
    exchange: varchar("exchange", { length: 64 }),
    fiscalYearEnd: varchar("fiscalYearEnd", { length: 8 }),
    /**
     * GICS classification, populated from the S&P 500 constituents table
     * (Wikipedia) by the scope.enrichClassification mutation. NULL for
     * companies outside the S&P 500 — classification coverage is inherently
     * index-scoped; NDX/Dow tables carry ICB/"Sector" labels that do NOT
     * map 1:1 onto GICS and are therefore not imported (mixed taxonomies
     * would poison sector:<name> scope filters).
     */
    sector: varchar("sector", { length: 100 }),
    industry: varchar("industry", { length: 160 }),
    /**
     * DEPRECATED since 4c (D30): universes are per-user now — see the
     * user_universe table. inUniverse/removedAt/removedBy stay in the DB
     * untouched (never-delete rule) but the code no longer reads them.
     */
    inUniverse: boolean("inUniverse").default(true).notNull(),
    /** @deprecated 4b view-level removal (D29) — superseded by D30 */
    removedAt: timestamp("removedAt"),
    /** @deprecated 4b view-level removal (D29) — superseded by D30 */
    removedBy: bigint("removedBy", { mode: "number", unsigned: true }),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (t) => [index("idx_companies_ticker").on(t.ticker), index("idx_companies_sector").on(t.sector)]
);
export type Company = typeof companies.$inferSelect;

export const filings = mysqlTable(
  "filings",
  {
    id: serial("id").primaryKey(),
    cik: int("cik").notNull(),
    accessionNo: varchar("accessionNo", { length: 25 }).notNull(),
    form: varchar("form", { length: 12 }).notNull(),
    filingDate: date("filingDate", { mode: "string" }),
    reportDate: date("reportDate", { mode: "string" }),
    primaryDoc: varchar("primaryDoc", { length: 255 }),
    /** 8-K item list from the SEC submissions API ("2.02,9.01"); NULL until a post-4a refresh fills it */
    items: varchar("items", { length: 200 }),
    isDownloaded: boolean("isDownloaded").default(false).notNull(),
    ingestedAt: timestamp("ingestedAt").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("uq_filings_cik_accn").on(t.cik, t.accessionNo),
    index("idx_filings_cik_form").on(t.cik, t.form),
    index("idx_filings_date").on(t.filingDate),
  ]
);
export type Filing = typeof filings.$inferSelect;

export const facts = mysqlTable(
  "facts",
  {
    id: serial("id").primaryKey(),
    cik: int("cik").notNull(),
    taxonomy: varchar("taxonomy", { length: 20 }).notNull(),
    concept: varchar("concept", { length: 200 }).notNull(),
    unit: varchar("unit", { length: 40 }).notNull(),
    startDate: date("startDate", { mode: "string" }),
    endDate: date("endDate", { mode: "string" }),
    val: double("val"),
    fy: int("fy"),
    fp: varchar("fp", { length: 8 }),
    form: varchar("form", { length: 12 }),
    filed: date("filed", { mode: "string" }),
    accn: varchar("accn", { length: 25 }),
  },
  (t) => [
    index("idx_facts_cik_concept").on(t.cik, t.concept, t.endDate),
    index("idx_facts_concept").on(t.concept),
  ]
);
export type Fact = typeof facts.$inferSelect;

export const jobs = mysqlTable("jobs", {
  id: serial("id").primaryKey(),
  // sections = stage 2.1 (section parser); score = stage 2.2 (LLM scoring)
  // universe-add / universe-remove (4b/4c, D29/D30) = terminal micro-job rows
  // that exist ONLY to carry the action log (who/what/when) into jobs +
  // job_logs — they never enter the runner's drain chain. universe-restore
  // is deprecated (D30 made removal a plain membership-row delete).
  type: mysqlEnum("type", [
    "bootstrap",
    "filings",
    "stream",
    "facts",
    "harvest",
    "series",
    "sections",
    "score",
    "prices",
    "universe-remove",
    "universe-restore",
    "universe-add",
  ]).notNull(),
  /**
   * users.id of whoever launched the job (null = legacy rows from before
   * iteration 3c). Drives per-user visibility in jobs.list: admins see all,
   * role="user" sees only own. Legacy null rows are admin-visible only.
   */
  startedBy: bigint("startedBy", { mode: "number", unsigned: true }),
  status: mysqlEnum("status", ["queued", "running", "done", "error", "cancelled"])
    .default("queued")
    .notNull(),
  params: text("params"),
  processed: int("processed").default(0).notNull(),
  total: int("total").default(0).notNull(),
  message: varchar("message", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  startedAt: timestamp("startedAt"),
  finishedAt: timestamp("finishedAt"),
});
export type Job = typeof jobs.$inferSelect;

export const jobLogs = mysqlTable(
  "job_logs",
  {
    id: serial("id").primaryKey(),
    jobId: bigint("jobId", { mode: "number", unsigned: true }).notNull(),
    ts: timestamp("ts").defaultNow().notNull(),
    level: mysqlEnum("level", ["info", "warn", "error"]).default("info").notNull(),
    message: text("message").notNull(),
  },
  (t) => [index("idx_joblogs_job").on(t.jobId, t.id)]
);
export type JobLog = typeof jobLogs.$inferSelect;

export const settings = mysqlTable("settings", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: text("value"),
});

// ---------------------------------------------------------------------------
// Iteration 2 — Document Registry (Stage 1.5)
// Every document of every filing (primary + exhibits) with storage location,
// integrity hash and LLM-processing lineage. The canonical docKey layout is
// identical in cloud storage and the future local SEC mirror.
// ---------------------------------------------------------------------------

export const documents = mysqlTable(
  "documents",
  {
    id: serial("id").primaryKey(),
    cik: int("cik").notNull(),
    accessionNo: varchar("accessionNo", { length: 25 }).notNull(),
    form: varchar("form", { length: 12 }).notNull(),
    /** original filename inside the submission, e.g. "aapl-20250927.htm" */
    docName: varchar("docName", { length: 255 }).notNull(),
    /** SEC-declared document type from index.json, e.g. "10-K", "EX-99.1" */
    docType: varchar("docType", { length: 40 }),
    /** primary = the main filing document; exhibit = EX-xx attachments */
    role: mysqlEnum("role", ["primary", "exhibit", "other"]).notNull(),
    sizeBytes: int("sizeBytes"),
    /** SHA-256 of the raw bytes as downloaded from SEC — integrity anchor */
    sha256: varchar("sha256", { length: 64 }),
    /** object-storage key of the raw HTML; NULL when not held in cloud */
    storageKey: varchar("storageKey", { length: 512 }),
    /** object-storage key of the derived plaintext (regenerable from raw) */
    textKey: varchar("textKey", { length: 512 }),
    textLength: int("textLength"),
    /** version of the deterministic HTML->text extractor (bump = re-derivable) */
    parserVersion: int("parserVersion"),
    /** where the raw document physically lives */
    location: mysqlEnum("location", ["none", "cloud", "local", "both"])
      .default("none")
      .notNull(),
    fetchStatus: mysqlEnum("fetchStatus", ["pending", "fetched", "failed"])
      .default("pending")
      .notNull(),
    fetchError: varchar("fetchError", { length: 500 }),
    fetchedAt: timestamp("fetchedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("uq_documents_cik_accn_doc").on(t.cik, t.accessionNo, t.docName),
    index("idx_documents_cik_form").on(t.cik, t.form),
    index("idx_documents_status").on(t.fetchStatus),
  ]
);
export type Document = typeof documents.$inferSelect;

// ---------------------------------------------------------------------------
// Iteration 2 — Canonical time series (Stage 1.6)
// Homogenized quarterly series built from raw facts, with vintage modes
// (first / latest) and derivation lineage. See docs/ALPHA_ENGINE_MANUAL.md §4.3.
// ---------------------------------------------------------------------------

export const seriesPoints = mysqlTable(
  "series_points",
  {
    id: serial("id").primaryKey(),
    cik: int("cik").notNull(),
    /** canonical (newest) concept name after alias splicing */
    concept: varchar("concept", { length: 200 }).notNull(),
    /** flow = 3-month duration value; stock = instant at period end */
    kind: mysqlEnum("kind", ["flow", "stock"]).notNull(),
    /** calendar quarter end this point belongs to */
    periodEnd: date("periodEnd", { mode: "string" }).notNull(),
    /** vintage: first = as originally reported; latest = after restatements */
    vintage: mysqlEnum("vintage", ["first", "latest"]).notNull(),
    val: double("val"),
    unit: varchar("unit", { length: 40 }),
    /** reported = directly disclosed; derived_q4 = FY minus 9M YTD */
    derivation: mysqlEnum("derivation", ["reported", "derived_q4", "derived_ytd"]).notNull(),
    /** accession number of the source filing (lineage) */
    sourceAccn: varchar("sourceAccn", { length: 25 }),
    /** filing date of the source filing — basis for as_of(T) reconstruction */
    sourceFiled: date("sourceFiled", { mode: "string" }),
  },
  (t) => [
    uniqueIndex("uq_series_point").on(t.cik, t.concept, t.kind, t.periodEnd, t.vintage),
    index("idx_series_cik_concept").on(t.cik, t.concept, t.periodEnd),
  ]
);
export type SeriesPoint = typeof seriesPoints.$inferSelect;

/** Per (cik, concept) health summary: continuity flags + restatement metrics. */
export const seriesHealth = mysqlTable(
  "series_health",
  {
    id: serial("id").primaryKey(),
    cik: int("cik").notNull(),
    concept: varchar("concept", { length: 200 }).notNull(),
    kind: mysqlEnum("kind", ["flow", "stock"]).notNull(),
    pointsCount: int("pointsCount").default(0).notNull(),
    /** expected quarterly grid coverage, 0..1 (1 = no gaps) */
    gridCoverage: double("gridCoverage"),
    /** JSON array of human-readable flag strings, e.g. ["gap:2019Q2","unit_change:USD->shares"] */
    flags: text("flags"),
    /** share of periods where first != latest (0..1) */
    revisionRate: double("revisionRate"),
    /** mean |latest - first| / |first| over revised periods */
    revisionMagnitude: double("revisionMagnitude"),
    /** mean days between first disclosure and latest revision */
    revisionLagDays: double("revisionLagDays"),
    /** original concept names if this series is alias-spliced (JSON array) */
    aliasedFrom: text("aliasedFrom"),
    builtAt: timestamp("builtAt").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("uq_series_health").on(t.cik, t.concept, t.kind)]
);
export type SeriesHealth = typeof seriesHealth.$inferSelect;

/** Company-level data-integrity rollups (consumed by Stage 4 as features). */
export const companyDataHealth = mysqlTable("company_data_health", {
  cik: int("cik").primaryKey(),
  seriesCount: int("seriesCount").default(0).notNull(),
  avgGridCoverage: double("avgGridCoverage"),
  avgRevisionRate: double("avgRevisionRate"),
  avgRevisionMagnitude: double("avgRevisionMagnitude"),
  avgRevisionLagDays: double("avgRevisionLagDays"),
  /** 10-K/A + 8-K/A amendments count (restatement events proxy) */
  amendmentCount: int("amendmentCount").default(0).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Iteration 3a — Document sections (Stage 2.1)
// Semantic sections inside primary documents (MD&A, Risk Factors, footnote
// blocks, 8-K items, DEF 14A blocks). The text is NOT duplicated: a section
// is an offset range [charStart, charEnd) inside the derived plaintext
// (documents.textKey). Re-parsing = DELETE by (documentId, parserVersion)
// + INSERT — per our versioning philosophy, old parser versions stay in the
// table until explicitly cleaned up.
// ---------------------------------------------------------------------------

export const documentSections = mysqlTable(
  "document_sections",
  {
    id: serial("id").primaryKey(),
    /** reference to documents.id (the filing's primary document) */
    documentId: bigint("documentId", { mode: "number", unsigned: true }).notNull(),
    cik: int("cik").notNull(),
    accessionNo: varchar("accessionNo", { length: 25 }).notNull(),
    form: varchar("form", { length: 12 }).notNull(),
    /**
     * Canonical section key:
     * 10-K: item1a_risk | item7_mda | item8_financials | ... (unique numbers)
     * 10-Q: p1_item2_mda | p2_item1a_risk | ... (Part I/II numbering collides)
     * 8-K:  8k_2_02 | 8k_4_01 | ... (the item number)
     * DEF 14A: def14a_cdna | def14a_exec_comp | def14a_pay_vs_perf | ...
     */
    sectionKey: varchar("sectionKey", { length: 48 }).notNull(),
    /** the heading line as found in the document (for parser audits) */
    title: varchar("title", { length: 255 }),
    /** half-open interval [charStart, charEnd) in the document plaintext */
    charStart: int("charStart").notNull(),
    charEnd: int("charEnd").notNull(),
    /**
     * JSON array of extraction-confidence flags:
     * "toc_fallback" (heading found only in the table of contents),
     * "toc_ambiguous" (several non-TOC occurrences of the same item),
     * "short_section" (suspiciously short text), "part_unknown" (10-Q)
     */
    flags: text("flags"),
    /** section parser version (services/sections.ts SECTION_PARSER_VERSION) */
    parserVersion: int("parserVersion").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    // one section of a given type per document per parser version
    uniqueIndex("uq_doc_section").on(t.documentId, t.sectionKey, t.parserVersion),
    index("idx_sections_cik_form").on(t.cik, t.form),
    index("idx_sections_key").on(t.sectionKey),
  ]
);
export type DocumentSection = typeof documentSections.$inferSelect;

// ---------------------------------------------------------------------------
// Iteration 3a — Sentiment scores (Stage 2.2)
// LLM scores for the 8 aspects + tone_delta. VERSIONED, never overwritten:
// the unique key (documentId, sectionKey, aspect, llmVersion, promptVersion)
// doubles as the idempotency key — a re-run with the same versions does NOT
// call the LLM (billing protection); a run with a new prompt or model
// version writes new rows alongside (prompt/model comparability).
// ---------------------------------------------------------------------------

export const sentimentScores = mysqlTable(
  "sentiment_scores",
  {
    id: serial("id").primaryKey(),
    cik: int("cik").notNull(),
    accessionNo: varchar("accessionNo", { length: 25 }).notNull(),
    form: varchar("form", { length: 12 }).notNull(),
    /** the filing's primary document */
    documentId: bigint("documentId", { mode: "number", unsigned: true }).notNull(),
    /** document_sections.id when scoring a section (NULL = whole document) */
    sectionId: bigint("sectionId", { mode: "number", unsigned: true }),
    sectionKey: varchar("sectionKey", { length: 48 }).notNull(),
    /** one of the 8 ASPECTS or "tone_delta" (pairwise MD&A tone delta) */
    aspect: varchar("aspect", { length: 24 }).notNull(),
    score: double("score").notNull(),
    confidence: double("confidence").notNull(),
    /** verbatim quote from the section text (<= 300 chars per the contract) */
    evidence: text("evidence"),
    /**
     * Whether the quote passed the machine source-substring check.
     * false = suspected hallucination — the row is kept for audit, but
     * Stage 3/4 must filter on evidenceOk = true.
     */
    evidenceOk: boolean("evidenceOk").notNull(),
    /** whether the prior period's text was in context (for tone_delta) */
    pairwise: boolean("pairwise").default(false).notNull(),
    /** "cloud:<modelId>" for now; "local:qwen2.5-14b-instruct-q5:llama.cpp" on the worker */
    llmVersion: varchar("llmVersion", { length: 120 }).notNull(),
    /** PROMPT_VERSION from services/sentiment/rubric.ts */
    promptVersion: varchar("promptVersion", { length: 24 }).notNull(),
    /** usage.totalTokens from the gateway response — spend accounting (billing transparency) */
    usageTokens: int("usageTokens"),
    scoredAt: timestamp("scoredAt").defaultNow().notNull(),
  },
  (t) => [
    // idempotency key: document × section × aspect × model/prompt versions
    uniqueIndex("uq_score_idem").on(t.documentId, t.sectionKey, t.aspect, t.llmVersion, t.promptVersion),
    index("idx_scores_cik_aspect").on(t.cik, t.aspect),
    index("idx_scores_accn").on(t.accessionNo),
  ]
);
export type SentimentScore = typeof sentimentScores.$inferSelect;

// ---------------------------------------------------------------------------
// Iteration 3f — Historical daily price bars (Stage 1.7)
// End-of-day OHLCV from free providers (Stooq primary, Yahoo chart API
// fallback). The `source` column is part of a bar's identity: two free feeds
// legitimately disagree (adjustment policy, halts), so bars from different
// providers coexist under (cik, date, source) instead of overwriting each
// other. cik = 0 is reserved for benchmark pseudo-entities (SPY) that have
// no SEC company row. See docs/ALPHA_ENGINE_MANUAL.md §4.9.
// ---------------------------------------------------------------------------

export const prices = mysqlTable(
  "prices",
  {
    id: serial("id").primaryKey(),
    /** 0 = benchmark pseudo-entity (e.g. SPY), not an SEC cik */
    cik: int("cik").notNull(),
    /** ticker AS FETCHED — kept for audit; tickers change, cik does not */
    ticker: varchar("ticker", { length: 20 }).notNull(),
    date: date("date", { mode: "string" }).notNull(),
    open: double("open"),
    high: double("high"),
    low: double("low"),
    close: double("close"),
    /** split/dividend-adjusted close (stooq: equals close, already adjusted) */
    adjClose: double("adjClose"),
    volume: bigint("volume", { mode: "number" }),
    /** stooq | yahoo | test (test = QA fixtures, never shown in prod UI) */
    source: varchar("source", { length: 16 }).notNull(),
    fetchedAt: timestamp("fetchedAt").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("uq_prices_bar").on(t.cik, t.date, t.source),
    index("idx_prices_cik_date").on(t.cik, t.date),
    index("idx_prices_ticker").on(t.ticker),
  ]
);
export type Price = typeof prices.$inferSelect;

// ---------------------------------------------------------------------------
// Iteration 3l — external payload cache (D27). Slow-moving external payloads
// (SEC 12k-row company directory, Wikipedia index constituents) are fetched
// once and served from the DB with stale-while-revalidate semantics
// (api/services/ext-cache.ts) — a cold process no longer makes users wait
// on external endpoints.
// ---------------------------------------------------------------------------
export const externalCache = mysqlTable("external_cache", {
  key: varchar("key", { length: 64 }).primaryKey(),
  /** JSON-serialized payload */
  payload: mediumtext("payload").notNull(),
  fetchedAt: timestamp("fetchedAt").defaultNow().notNull(),
  /** live | snapshot (fallback origin marker) */
  source: varchar("source", { length: 24 }).notNull(),
});
export type ExternalCacheRow = typeof externalCache.$inferSelect;

// ---------------------------------------------------------------------------
// Iteration 4a — corporate event stream (D28). Materialized from OUR OWN
// filings (8-K Item 2.02 = earnings release); no external calendar needed.
// Point-in-time by construction: filingDate = when the event became public.
// ---------------------------------------------------------------------------
export const events = mysqlTable(
  "events",
  {
    id: serial("id").primaryKey(),
    cik: int("cik").notNull(),
    /** v1: 'earnings' (8-K Item 2.02); future: guidance (Item 7.01?), etc. */
    type: varchar("type", { length: 24 }).notNull(),
    /** reportDate when known, else filingDate */
    eventDate: date("eventDate", { mode: "string" }).notNull(),
    filingDate: date("filingDate", { mode: "string" }),
    accessionNo: varchar("accessionNo", { length: 25 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("uq_events").on(t.cik, t.type, t.accessionNo),
    index("idx_events_cik_date").on(t.cik, t.eventDate),
    index("idx_events_date").on(t.eventDate),
  ]
);
export type Event = typeof events.$inferSelect;

// ---------------------------------------------------------------------------
// Iteration 4c — per-user universes (D30). Each user builds their own world:
// a membership row per (userId, cik). active=false = the hide switch; row
// deletion = the trash can (re-add via search creates a fresh active row).
// ticker/name are denormalized so a membership displays before the
// auto-ingest of a new company finishes. The shared companies table is never
// touched by membership actions — users read shared data, never modify it.
// ---------------------------------------------------------------------------
export const userUniverse = mysqlTable(
  "user_universe",
  {
    id: serial("id").primaryKey(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    cik: int("cik").notNull(),
    /** denormalized: displayable before the company is ingested */
    ticker: varchar("ticker", { length: 20 }).notNull(),
    /** denormalized SEC directory name (null if added as raw free text) */
    name: varchar("name", { length: 255 }),
    /** the per-user hide switch (4c replacement for the global inUniverse) */
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("uq_user_universe_user_cik").on(t.userId, t.cik),
    index("idx_user_universe_user_active").on(t.userId, t.active),
  ]
);
export type UserUniverseRow = typeof userUniverse.$inferSelect;

// ---------------------------------------------------------------------------
// Iteration 4c — admin ↔ user chat (D32), reworked in 4e (D34) into pairwise
// DM between ANY two users: convKey = '<minUserId>_<maxUserId>' identifies
// the conversation; recipientId drives unread counts. threadUserId /
// isAdminMsg stay in the DB deprecated (never-delete rule; 0 rows at rework).
// Admin oversight: an admin may open any conversation (moderation).
// ---------------------------------------------------------------------------
export const messages = mysqlTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    /** @deprecated 4c thread owner — superseded by convKey (D34) */
    threadUserId: bigint("threadUserId", { mode: "number", unsigned: true }).notNull(),
    /** 4e (D34): conversation key '<minId>_<maxId>' of the two participants */
    convKey: varchar("convKey", { length: 32 }),
    authorId: bigint("authorId", { mode: "number", unsigned: true }).notNull(),
    /** 4e (D34): the other participant — drives unread badges */
    recipientId: bigint("recipientId", { mode: "number", unsigned: true }),
    /** @deprecated 4c flag — the author's role is read from users instead */
    isAdminMsg: boolean("isAdminMsg").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    readAt: timestamp("readAt"),
  },
  (t) => [
    index("idx_messages_thread").on(t.threadUserId, t.id),
    index("idx_messages_readAt").on(t.readAt),
    index("idx_messages_conv").on(t.convKey, t.id),
    index("idx_messages_recipient").on(t.recipientId, t.readAt),
  ]
);
export type Message = typeof messages.$inferSelect;

// ---------------------------------------------------------------------------
// Iteration 4e — activity events (D35): the collection behind the admin's
// per-user info summary. login/signup are recorded server-side in auth; page
// views come from the client tracker (AppLayout, 60 s dedupe per path).
// ---------------------------------------------------------------------------
export const activityEvents = mysqlTable(
  "activity_events",
  {
    id: serial("id").primaryKey(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    /** login | signup | page */
    type: varchar("type", { length: 24 }).notNull(),
    /** page path for type='page' */
    path: varchar("path", { length: 255 }),
    ip: varchar("ip", { length: 64 }),
    meta: varchar("meta", { length: 500 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("idx_activity_user").on(t.userId, t.id), index("idx_activity_type_ts").on(t.type, t.createdAt)]
);
export type ActivityEvent = typeof activityEvents.$inferSelect;

// ---------------------------------------------------------------------------
// Iteration 4i (D43) — signals feature store. Schema only; the LOCAL WORKER
// populates it (Variant C). Two timestamps by construction: eventTs (content
// time) + ingestedAt (arrival) — backtests read ingestedAt ≤ T; backfills
// carry src='backfill' and run under an explicit research flag.
// ---------------------------------------------------------------------------
export const signals = mysqlTable(
  "signals",
  {
    id: serial("id").primaryKey(),
    cik: int("cik").notNull(),
    /** gdelt | stocktwits | reddit | youtube | trends | edgar */
    source: varchar("source", { length: 24 }).notNull(),
    /** tone | buzz | label */
    signalType: varchar("signalType", { length: 24 }).notNull(),
    /** when the CONTENT was published */
    eventTs: datetime("eventTs", { mode: "string" }).notNull(),
    /** when it reached US — the no-lookahead anchor */
    ingestedAt: datetime("ingestedAt", { mode: "string" }).notNull(),
    score: double("score"),
    magnitude: double("magnitude"),
    payloadKey: varchar("payloadKey", { length: 255 }),
    /** live | backfill */
    src: varchar("src", { length: 24 }).default("live").notNull(),
    /** 5c: one-line model rationale for LLM-scored rows (the "why"); NULL for collectors */
    note: varchar("note", { length: 512 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    // 5b: payloadKey joins the UQ so the same event can be RE-scored by a new
    // model ("llm:qwen3.5:..." vs "llm:gpt-oss:...") without being eaten by
    // INSERT IGNORE. All producers set payloadKey; NULLs stay non-deduped by
    // MySQL semantics, which is acceptable (and unchanged from before).
    uniqueIndex("uq_signals").on(t.cik, t.source, t.signalType, t.eventTs, t.payloadKey),
    index("idx_signals_cik_ingested").on(t.cik, t.ingestedAt),
    index("idx_signals_eventts").on(t.eventTs),
  ]
);
export type Signal = typeof signals.$inferSelect;

// ---------------------------------------------------------------------------
// Iteration 5e — digests: LLM morning briefs derived from the signals store.
// Upsert by (kind, forDate) — a redigest refreshes, never duplicates.
// ---------------------------------------------------------------------------
export const digests = mysqlTable(
  "digests",
  {
    id: serial("id").primaryKey(),
    kind: varchar("kind", { length: 24 }).notNull().default("morning"),
    forDate: date("forDate", { mode: "string" }).notNull(),
    body: text("body").notNull(),
    model: varchar("model", { length: 64 }),
    meta: text("meta"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("uq_digests").on(t.kind, t.forDate)]
);
export type Digest = typeof digests.$inferSelect;

// ---------------------------------------------------------------------------
// Iteration 4i (D42) — insider trades from Form 4 XML. Schema only; the
// worker/ETL populates it (4j). filingDate is the point-in-time anchor.
// ---------------------------------------------------------------------------
export const insiderTrades = mysqlTable(
  "insider_trades",
  {
    id: serial("id").primaryKey(),
    cik: int("cik").notNull(),
    accessionNo: varchar("accessionNo", { length: 25 }).notNull(),
    insiderName: varchar("insiderName", { length: 255 }),
    insiderRole: varchar("insiderRole", { length: 64 }),
    /** P purchase, S sale, A grant, M exercise, F tax, G gift */
    code: varchar("code", { length: 2 }).notNull(),
    shares: double("shares"),
    price: double("price"),
    sharesAfter: double("sharesAfter"),
    tradeDate: date("tradeDate", { mode: "string" }),
    /** point-in-time anchor */
    filingDate: date("filingDate", { mode: "string" }).notNull(),
    /** Rule 10b5-1 plan checkbox (2023+ XML) */
    is10b5: boolean("is10b5").default(false).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("uq_insider_trades").on(t.cik, t.accessionNo, t.code, t.shares),
    index("idx_insider_cik_date").on(t.cik, t.tradeDate),
  ]
);
export type InsiderTrade = typeof insiderTrades.$inferSelect;

// ---------------------------------------------------------------------------
// Iteration 4k (D45) — worker API keys. The home worker (Variant C) calls
// POST /api/worker/ingest with a Bearer key; we store only the key's SHA-256.
// (Iteration 2 announced this table but never created it — found empty in
// prod on 2026-10-20; created honestly by DDL 015.)
// ---------------------------------------------------------------------------
export const workerKeys = mysqlTable(
  "worker_keys",
  {
    id: serial("id").primaryKey(),
    /** sha256 hex of the key — the key itself is never stored */
    keyHash: varchar("keyHash", { length: 64 }).notNull(),
    /** "mac-studio" etc. — who this key belongs to */
    label: varchar("label", { length: 64 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    lastUsedAt: timestamp("lastUsedAt"),
    revokedAt: timestamp("revokedAt"),
  },
  (t) => [uniqueIndex("uq_worker_keys_hash").on(t.keyHash)]
);
export type WorkerKey = typeof workerKeys.$inferSelect;

// ---------------------------------------------------------------------------
// Iteration 4m (D46) — short interest, settlement-dated. Sources: yahoo_gw
// (Yahoo via the agent gateway — carries the settlement date + prior month)
// now; finra biweekly files when the worker picks them up.
// ---------------------------------------------------------------------------
export const shortInterest = mysqlTable(
  "short_interest",
  {
    id: serial("id").primaryKey(),
    cik: int("cik").notNull(),
    settlementDate: date("settlementDate", { mode: "string" }).notNull(),
    sharesShort: bigint("sharesShort", { mode: "number" }),
    /** days-to-cover */
    shortRatio: double("shortRatio"),
    /** 0.0083 = 0.83% of float */
    shortPercentOfFloat: double("shortPercentOfFloat"),
    /** yahoo_gw | finra */
    source: varchar("source", { length: 24 }).notNull(),
    fetchedAt: timestamp("fetchedAt").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("uq_short_interest").on(t.cik, t.settlementDate, t.source), index("idx_si_cik_date").on(t.cik, t.settlementDate)]
);
export type ShortInterest = typeof shortInterest.$inferSelect;

// ---------------------------------------------------------------------------
// Iteration 4m (D46) — macro points (FRED via the igo plugin). realtimeStart/
// realtimeEnd ride every row — the vintage window (D2 discipline for macro).
// ---------------------------------------------------------------------------
export const macroPoints = mysqlTable(
  "macro_points",
  {
    id: serial("id").primaryKey(),
    /** FRED series id (DGS10, FEDFUNDS, BAMLH0A0HYM2…) */
    seriesId: varchar("seriesId", { length: 32 }).notNull(),
    date: date("date", { mode: "string" }).notNull(),
    /** NULL = FRED's "." missing marker */
    value: double("value"),
    realtimeStart: date("realtimeStart", { mode: "string" }),
    realtimeEnd: date("realtimeEnd", { mode: "string" }),
    fetchedAt: timestamp("fetchedAt").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("uq_macro_points").on(t.seriesId, t.date, t.realtimeStart), index("idx_macro_series_date").on(t.seriesId, t.date)]
);
export type MacroPoint = typeof macroPoints.$inferSelect;

// ---------------------------------------------------------------------------
// Iteration 4n (D47) — metric_history: pre-computed month-end history of the
// quote-grid metrics. Clicking a stat tile on the company Overview charts it
// instantly — "pre-calculate and store as a static table so display is
// immediate" (owner directive). Rebuilt by the post-prices/series hook and by
// t_4n_metrics.mts for the initial fill.
// ---------------------------------------------------------------------------
export const metricHistory = mysqlTable(
  "metric_history",
  {
    id: serial("id").primaryKey(),
    cik: int("cik").notNull(),
    /** volume | avgVolume3m | marketCap | epsTtm | peTtm | beta5y */
    metric: varchar("metric", { length: 24 }).notNull(),
    /** month-end point */
    date: date("date", { mode: "string" }).notNull(),
    /** NULL = honestly uncomputable at T */
    value: double("value"),
    computedAt: timestamp("computedAt").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("uq_metric_history").on(t.cik, t.metric, t.date), index("idx_metric_history").on(t.cik, t.metric, t.date)]
);
export type MetricHistory = typeof metricHistory.$inferSelect;
