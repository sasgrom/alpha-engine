/**
 * The signal ledger: every family of readings the platform holds, the question it would answer for an investor,
 * and what has actually been measured about it. The findings are copied from the research record (the lab's
 * engine README and findings documents, the overnight research notes of 2026-11-16, the volatility handbook) and
 * carry their numbers and samples; nothing here is a forecast. A family moves up only when a test fixed in advance
 * says so. LEDGER_REVIEWED is the day the entries were last set against that record.
 */
export type EvidenceStatus = "candidate" | "risk" | "none" | "invalid" | "untested" | "reference";

export const LEDGER_REVIEWED = "2026-11-23";

export const EVIDENCE_LABEL: Record<EvidenceStatus, string> = {
  candidate: "Candidate, not yet confirmed",
  risk: "Measured: risk, not direction",
  none: "Measured: nothing beyond noise",
  invalid: "First test invalid",
  untested: "Not tested yet",
  reference: "A yardstick, not a signal",
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
    id: "foresight",
    title: "What next quarter's figures would be worth",
    question: "If we knew the next quarter's reported figures today, how much would that pay?",
    status: "reference",
    finding:
      "The ceiling every input is measured against: with the real next quarter fed in, the twenty best-ranked companies made 27.6% a year against 15.6% for the index fund from late 2019 to 2026, and the rank correlation with the following quarter's return against the sector is +0.12 (+0.15 for the surprise against what guidance and our own estimate expected). Our estimates of those figures from public data earn nothing: the price already holds what they hold.",
    testedOn: "451 companies, decisions from 2014 to 2026; portfolios from late 2019 with former index members included",
    next: "An input the market lacks on the decision day. The untested one is analysts' consensus, to measure the surprise against it.",
    tool: { label: "Engine", path: "/desk/engine" },
  },
  {
    id: "short-sale-share",
    title: "Low share of short sales in daily volume",
    question: "Do stocks with a smaller share of short sales in their trading do better next month?",
    status: "candidate",
    finding:
      "The only public reading that held inside sectors, and weakly: the less-shorted half of each sector, at index weights, made 1.25% a year more than its sector (t 1.7; rank correlation inside sectors +2.1 per 100, t 2.8). An index tilted that way turned $1M into $2.89M against $2.68M untilted, ahead in each full year 2020 to 2025 and behind in 2026. Short interest itself, the stock of shorts, does not confirm it.",
    testedOn: "S&P 500 members as they were, late 2019 to 2026; FINRA daily short-sale volume",
    next: "A paper portfolio followed forward; no decision to trade it.",
  },
  {
    id: "reaction",
    title: "First reaction to an earnings release",
    question: "Does the first-session move after a release keep going?",
    status: "none",
    finding:
      "No. On the 50 research companies it had (+5.9 per 1,000 decisions in log score over 10 sessions, 2013–2022), but the test fixed in advance on 440 other S&P 500 companies did not repeat it: −1.2 per 1,000 (90% interval −2.5 to +0.2) for the 353 outside Financials and Energy, −1.7 (−3.1 to −0.3) for all 440. The reaction's rank correlation with the next 10 sessions against the sector there is −0.01, +0.02 and +0.01 in 2005–2012, 2013–2022 and 2023 to mid-2026.",
    testedOn: "490 companies, 28,794 release decisions, 2005 to mid-2026",
    next: "Settled. The 50 alone are no longer used to design a rule.",
    tool: { label: "Earnings", path: "/desk/research/earnings" },
  },
  {
    id: "guidance",
    title: "Company guidance, raised or lowered",
    question: "Does a change in what management guides to show up in the following weeks?",
    status: "none",
    finding:
      "It is priced on the day: raised guidance +0.9% and lowered −1.5% in the release session, and no reliable drift after it (raised minus lowered +0.4% over 21 sessions, t 1.0). Guidance does sharpen our estimate of the next quarter's figures, but the price moves on the miss against it, and the part of the miss we can forecast (rank correlation 0.41 for revenue) has no link with the return after the release (−0.05 to +0.03).",
    testedOn: "Guidance standard g1.2: 48,351 releases, 176,459 statements; 150 companies with guided quarters, 2015 to 2026",
    next: "Settled for guidance alone. It stays an input to the estimate of the next quarter.",
    tool: { label: "Earnings", path: "/desk/research/earnings" },
  },
  {
    id: "fundamentals",
    title: "Reported figures",
    question: "Do the filed numbers themselves predict the following weeks?",
    status: "none",
    finding:
      "A small pattern, not a tradable one. After a quarterly report is public, rising costs lean against the next weeks (research and development −0.05, inventory −0.04, selling costs −0.04 as rank correlations; 27 of 64 readings outside the range of chance, about 3 expected). Traded as an account it lost 0.2 to 0.7% a year to simply holding. Value, quality and the pooled engine on reported figures earned nothing inside sectors.",
    testedOn: "430 to 481 companies, 64 reported figures as known on each day; the account 2014 to 2026",
    next: "Nothing open. Reported figures serve as inputs, not as a signal.",
  },
  {
    id: "overheat",
    title: "Overheating guard",
    question: "Does a price far above its own trend warn of a sharp fall?",
    status: "risk",
    finding:
      "On the 50 research companies a price in the outermost 2% above its own one-year average was followed by a sharp fall about twice as often as usual (8.3% against 4.4%), and passing over such entries lowered the account's deepest fall from 14.3% to 10.9%. On the full list, exits and warnings of this kind cut falls but cost return: every stop, trend and panic exit lost 0.4 to 3.9% per holding period against holding.",
    testedOn: "50 research companies, 2013 to mid-2026; exits on 495 companies, 2005 to 2026",
    next: "A risk control only, at the cost of return. Not repeated on the full list as an entry guard.",
  },
  {
    id: "iv-rv",
    title: "Implied against realized volatility",
    question: "Do option prices tell us how much a stock will move?",
    status: "risk",
    finding:
      "Yes for size, not for direction: at-the-money implied volatility forecasts the next period's movement better than the last 20 days of realized volatility (rank IC 0.796 against 0.667; within sectors 0.639 against 0.471; the expected move covered the outcome 62.3% against 59.5% of the time). Sizing positions by it gave 9.4% lower volatility and no proven change in return (−4.46 basis points a month, 95% interval −15.96 to +9.97).",
    testedOn: "Option history 2019–2026, paired monthly panel",
    next: "Settled as a measure of size. Direction: see the option readings below.",
    tool: { label: "Volatility", path: "/desk/research/volatility" },
  },
  {
    id: "options-at-release",
    title: "Option readings and direction",
    question: "Do the priced-in move, the skew or a change in implied volatility predict where the stock goes?",
    status: "none",
    finding:
      "No. Four readings around a release showed nothing beyond noise on the 50, and on the full list weekly option readings did not pass a test for many readings at once; the put-call skew even leaned the wrong way. Against the miss versus guidance the skew leans the expected way for earnings per share (−0.14 to −0.18), but not against returns.",
    testedOn: "918 release decisions of the 50 since 2019; option standard o1, all companies, 2019 to 2026",
    next: "Nothing open.",
    tool: { label: "Volatility", path: "/desk/research/volatility" },
  },
  {
    id: "tone",
    title: "Tone and wording of filings and releases",
    question: "Does the language of a report carry information beyond its numbers?",
    status: "none",
    finding:
      "Nothing at the release, and a small unproven lift from the tone of the 10-Q/10-K on the 50. How much a filing's text changed from the year before has no link with the next month (rank correlation +0.4 per 100, t 0.5); the companies that changed their text did better, not worse, the opposite of the published effect.",
    testedOn: "50 research companies; 31,013 pairs of filings of index members",
    next: "Nothing open.",
  },
  {
    id: "macro",
    title: "Macro readings",
    question: "Do rates, credit, oil or the dollar time the market, the sectors or single companies?",
    status: "none",
    finding:
      "No. 15 FRED readings as known on each day found nothing beyond chance for the market over 20 years, nor for the 11 sector funds. The per-company route, debt that reprices within two years times the move in the ten-year rate, has no link either (rank correlation −0.014 to +0.011 over 25,635 decisions). Fed decisions and inflation releases showed exposure and risk, and no edge in timing.",
    testedOn: "Market and sector funds, 20 years; 25,635 company decisions; prediction markets for Fed and CPI",
    next: "Exposure is shown as a description. The oil and dollar parts cannot be built for all companies from the stored filings.",
    tool: { label: "Macro", path: "/desk/research/macro" },
  },
  {
    id: "insiders",
    title: "Insider buying and selling",
    question: "Do open-market trades by insiders precede better or worse returns?",
    status: "none",
    finding:
      "Not reliably. Index members with at least one insider buyer in 90 days made 0.13 to 0.22% a month more than the others (t 0.7 to 1.3) in each of three periods; heavy insider selling leaned the other way (−4.7% a year at index weights, t −1.3). Neither passes. The earlier dry run on the 50 (545 purchase windows) had no interval and no controls.",
    testedOn: "Form 4 filings of S&P 500 members, officers and directors, three periods to 2026",
    next: "Nothing open. Shown as a description of who traded.",
    tool: { label: "Ownership", path: "/desk/research/ownership" },
  },
  {
    id: "institutions",
    title: "Institutional accumulation (13F)",
    question: "Does buying by large funds say anything about the next quarters?",
    status: "none",
    finding:
      "No. The change in the number of holders, net buying and the change in holders' share, each as known on the filing date, have no link with the following quarter (every t below 1.2). The funds were chosen by their size today, which flatters them if anything.",
    testedOn: "13F standard, 24 quarters from late 2019",
    next: "A clean test needs every filer of each quarter, not today's largest. Not planned.",
    tool: { label: "Ownership", path: "/desk/research/ownership" },
  },
  {
    id: "momentum",
    title: "Momentum, reversal and price patterns",
    question: "Do recent winners keep winning, or recent losers bounce?",
    status: "none",
    finding:
      "Momentum earned nothing inside sectors (−0.9% a year). Short-term reversal is real but small: the last one to five days lean against the next days (rank correlation about −0.013), and five-session losers beat the list by 6.9% a year with a 56% deepest fall and no gain over the index fund. A monthly model built on price patterns made 8% a year after costs, all of it from 2020 on and from companies that joined the index later: hindsight in the list, not skill.",
    testedOn: "495 companies, 39 price and volume readings, 2005 to 2026; members as they were from late 2019",
    next: "Nothing open. Any test on today's members must use the list as it was on each day.",
    tool: { label: "Screener", path: "/desk/screener" },
  },
  {
    id: "short-interest",
    title: "Short interest",
    question: "Do crowded shorts or a jump in short interest matter?",
    status: "none",
    finding:
      "No. Short interest against the value of the shares has no link with the next month (rank correlation −0.3 per 100); days to cover leans weakly the right way (+1.0 inside sectors, t 1.6); the change between two reports shows nothing. Only the daily share of short sales in volume carries something (see above).",
    testedOn: "FINRA short interest, 213 reports from late 2017 to 2026, S&P 500 members as they were",
    next: "Nothing open.",
    tool: { label: "Ownership", path: "/desk/research/ownership" },
  },
  {
    id: "engine",
    title: "The prediction engines",
    question: "What do the readings give when combined into one decision per company?",
    status: "none",
    finding:
      "Nothing over holding, so far. Version 1 has no edge on the S&P 500 (its release effect did not repeat outside the 50, and its account on the 50, 21.4% a year against 24.6% for holding them, was no evidence either). The per-company engine never stepped out of a stock, and forced step-outs lost money. The pooled engine pays only when fed the real next quarter: $1.528M against $1.453M for holding on $1M over about two and a half years; fed reported figures or our own estimates it never switched.",
    testedOn: "50, then 451 to 464 companies, 2014 to 2026; controls with scrambled readings and a planted factor in every round",
    next: "No predictions are shown in the desk. The open work is the input: what the market does not know on the decision day.",
    tool: { label: "Engine", path: "/desk/engine" },
  },
];
