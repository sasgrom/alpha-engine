/**
 * The signal ledger: every family of readings the platform holds, the question it would answer for an investor,
 * and what has actually been measured about it. The findings are copied from the research record
 * (docs/engine/DESIGN.md §6, the volatility handbook) and carry their numbers and samples; nothing here is a
 * forecast. A family moves up only when a test fixed in advance says so.
 */
export type EvidenceStatus = "candidate" | "risk" | "none" | "invalid" | "untested";

export const EVIDENCE_LABEL: Record<EvidenceStatus, string> = {
  candidate: "Candidate, not yet confirmed",
  risk: "Measured: risk, not direction",
  none: "Measured: nothing beyond noise",
  invalid: "First test invalid",
  untested: "Not tested yet",
};

export interface SignalFamily {
  id: string;
  title: string;
  question: string;
  status: EvidenceStatus;
  finding: string;
  testedOn: string;
  next: string;
  tool?: { label: string; path: string };
}

export const SIGNAL_FAMILIES: SignalFamily[] = [
  {
    id: "reaction",
    title: "First reaction to an earnings release",
    question: "Does the first-session move after a release keep going?",
    status: "candidate",
    finding:
      "On the 50 research companies it did: a company's first-session reaction against its sector continued over the next 10 sessions, worth +5.9 per 1,000 decisions in log score over the base rate in 2013–2022 (90% interval +2.2 to +9.5) and +3.2 (−4.0 to +10.7) in 2023 to mid-2026; the decisions leaned on went that way about 60.5% of the time. It did not repeat on 20 other companies, 17 of them banks and insurers (−8.2; 46%).",
    testedOn: "50 research companies, 2013 to mid-2026; first look at 20 others",
    next: "The test fixed in advance on the other 446 companies, with Financials, Energy and the rest judged separately. Until then the rule is not applied to banks and insurers.",
    tool: { label: "Earnings", path: "/desk/research/earnings" },
  },
  {
    id: "guidance",
    title: "Company guidance, raised or lowered",
    question: "Does a change in what management guides to show up in the following weeks?",
    status: "candidate",
    finding:
      "Raw readings say yes, weakly: revisions of revenue guidance go with the next 10 sessions at a rank correlation of +0.19 with the first-session reaction held out (+0.13 at 20 sessions, +0.14 at 45); earnings-guidance revisions +0.14 at 20. Through the engine the family adds nothing yet (−0.3 per 1,000 at 5 sessions, interval −1.7 to +1.1): on 50 companies too few decisions carry a reading.",
    testedOn: "4,368 releases of the 50, 17,396 verified statements",
    next: "The guidance pass over the releases of the other 446 companies (running on the local GPU), then the same test.",
    tool: { label: "Earnings", path: "/desk/research/earnings" },
  },
  {
    id: "fall-then-growth",
    title: "Faster growth after a fall into the release",
    question: "When a stock fell before its release, does the quarter's revenue trend decide what follows?",
    status: "candidate",
    finding:
      "First raw look: after a fall into the release, a quarter with faster revenue growth kept drifting up and a slower one kept sliding, beyond what the first-session reaction predicts — better minus worse +0.6%, +0.7% and +1.2% over 5, 10 and 20 sessions (1,033 decisions). After a run-up into the release nothing followed.",
    testedOn: "50 research companies, 1,033 release decisions",
    next: "Registered as one candidate reading for the 446-company test; needs the release-figure reader run on those companies' releases.",
  },
  {
    id: "overheat",
    title: "Overheating guard",
    question: "Does a price far above its own trend warn of a sharp fall?",
    status: "risk",
    finding:
      "A price in the outermost 2% above its own one-year average was followed by a sharp fall about twice as often as usual (8.3% against 4.4%). Passing over signals with the price or the sector in the top tenth of that reading lowered the account's deepest fall from 14.3% to 10.9%. Acceleration and a price above 100 times earnings gave no warning.",
    testedOn: "50 research companies, 2013 to mid-2026",
    next: "Repeat on the 446 companies; show the reading per company (the snapshot needs each company's long price history for it).",
  },
  {
    id: "iv-rv",
    title: "Implied against realized volatility",
    question: "Do option prices tell us how much a stock will move?",
    status: "risk",
    finding:
      "Yes for size, not for direction: at-the-money implied volatility forecasts the next period's movement better than the last 20 days of realized volatility (rank IC 0.796 against 0.667; within sectors 0.639 against 0.471; the expected move covered the outcome 62.3% against 59.5% of the time). Sizing positions by it gave 9.4% lower volatility and no proven change in return (−4.46 basis points a month, 95% interval −15.96 to +9.97).",
    testedOn: "Option history 2019–2026, paired monthly panel",
    next: "No test yet of whether rich or cheap options say anything about direction.",
    tool: { label: "Volatility", path: "/desk/research/volatility" },
  },
  {
    id: "options-at-release",
    title: "Option readings around a release",
    question: "Do the priced-in move, the skew or the volatility crush predict the reaction?",
    status: "none",
    finding:
      "Four readings from the option chains around a release — the move the options had priced, the surprise against it, the put-call skew and the fall in implied volatility — showed nothing measurable beyond noise.",
    testedOn: "918 release decisions of the 50 since 2019",
    next: "Run again on the full list once option features exist for it.",
    tool: { label: "Volatility", path: "/desk/research/volatility" },
  },
  {
    id: "fundamentals",
    title: "Reported figures as year-ago changes",
    question: "Do the filed numbers themselves predict the following weeks?",
    status: "none",
    finding:
      "Nothing measurable beyond noise so far, neither for the 10-Q/10-K figures nor for the figures printed in the release (which equal the later filing in 1,484 of 1,491 comparable cases, so the release can be read on the day).",
    testedOn: "50 research companies; 3,609 releases graded against the filing",
    next: "Value readings need a market value that is right on each past day (task K08).",
  },
  {
    id: "tone",
    title: "Tone of filings and releases",
    question: "Does the language of a report carry information beyond its numbers?",
    status: "none",
    finding: "Nothing at the release. A small unproven lift from the tone of the 10-Q/10-K at 20 to 45 sessions.",
    testedOn: "50 research companies",
    next: "Kept as a variant in the 446-company test.",
  },
  {
    id: "macro",
    title: "Macro readings",
    question: "Do rates, credit, oil or the dollar time the market or the sectors?",
    status: "none",
    finding:
      "No: 15 FRED readings, as known on each day, offered as the market's starting probability found nothing beyond chance on one market over 20 years, and nothing on the 11 sector funds either.",
    testedOn: "Market and sector funds, 20 years of daily data",
    next: "The per-company route: exposure taken from the filings times the macro move, once exposure history exists (task K10).",
    tool: { label: "Macro", path: "/desk/research/macro" },
  },
  {
    id: "insiders",
    title: "Insider cluster buying",
    question: "Do open-market purchases by insiders precede better returns?",
    status: "candidate",
    finding:
      "A dry run only. After two void attempts, the corrected benchmark (entry within 45 days of the filing becoming available) gives a median excess of −0.09%, +0.38% and +0.29% at 1, 5 and 20 sessions, with hit rates of 47.5%, 55.6% and 51.3%, over 545 purchase windows — most of them a single insider; 25 have three or more. No interval and no controls yet.",
    testedOn: "Form 4 filings of the 50 research companies, 2013 to 2026",
    next: "Put it through the engine's controls (scrambled readings, resampling by company and quarter) and split by cluster size and by who bought.",
    tool: { label: "Ownership", path: "/desk/research/ownership" },
  },
  {
    id: "institutions",
    title: "Institutional accumulation (13F)",
    question: "Does buying by large funds say anything about the next quarters?",
    status: "untested",
    finding: "Holdings of 311 funds are stored with their filing dates and the quarter-on-quarter flows are shown; what follows a flow has not been tested.",
    testedOn: "—",
    next: "A flow reading per company as known on each filing date, then the same engine test.",
    tool: { label: "Ownership", path: "/desk/research/ownership" },
  },
  {
    id: "momentum",
    title: "Momentum and 52-week highs",
    question: "Do recent winners keep winning on this list?",
    status: "untested",
    finding: "The classic price readings (12-month return skipping the last month, distance from the 52-week high) are shown in the screener; they have not been tested on this data.",
    testedOn: "—",
    next: "Cheap to test: closes for the whole index are stored since 2005.",
    tool: { label: "Screener", path: "/desk/screener" },
  },
  {
    id: "short-interest",
    title: "Short interest",
    question: "Do crowded shorts or a jump in short interest matter?",
    status: "untested",
    finding: "The latest readings are stored for the research companies only; no history long enough for a test.",
    testedOn: "—",
    next: "Collect the twice-monthly FINRA history for the whole index.",
    tool: { label: "Ownership", path: "/desk/research/ownership" },
  },
  {
    id: "engine",
    title: "Prediction engine, version 1",
    question: "What do the readings give when combined into one probability per decision?",
    status: "candidate",
    finding:
      "Account illustration 2016–2025 under the owner's set-up (long only, entry at a probability of at least 55%, orders at the next open, exit on trend reversal, ten equal parts): 21.4% a year with 60% of the money in use, against 24.6% for holding the 50 throughout — a list of today's large companies. Per position the picks made about one point more than the index in 2016–2022 and no more in 2023–2025.",
    testedOn: "50 research companies; controls with scrambled readings and a planted factor in every round",
    next: "The 446-company test decides what enters version 2. Its predictions are not shown in the desk before that.",
  },
];
