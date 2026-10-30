export interface ExpectationReferenceExample {
  ticker: string;
  metric: string;
  period: string;
  value: string;
  revision: string;
  basis: string;
  assumption: string | null;
  sourceUrl: string;
}

/** Source-reviewed examples, deliberately separate from extractor accuracy results. */
export const expectationReferenceExamples: ExpectationReferenceExample[] = [
  {
    ticker: "AMZN",
    metric: "Net sales",
    period: "Q4 2026",
    value: "$240–247 billion",
    revision: "Current guidance",
    basis: "Reported",
    assumption: "Approximately 60 bps FX headwind; advertising growth described as high teens",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/1018724/000101872426000038/amzn-20260930xex991.htm",
  },
  {
    ticker: "META",
    metric: "Capital expenditures",
    period: "FY2026",
    value: "$135–145 billion",
    revision: "Narrowed from $130–145 billion",
    basis: "Reported, including finance-lease principal",
    assumption: "Expense outlook separately raised for a legal charge",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/1326801/000162828026066700/meta-09302026xexhibit991.htm",
  },
  {
    ticker: "NVDA",
    metric: "Revenue",
    period: "Q3 FY2027",
    value: "$108.0 billion ± 2%",
    revision: "Current outlook",
    basis: "Reported",
    assumption: "No Data Center compute revenue from China assumed",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000073/q2fy27pr.htm",
  },
  {
    ticker: "UNH",
    metric: "Adjusted EPS",
    period: "FY2026",
    value: "At least $20.50",
    revision: "Raised",
    basis: "Non-GAAP",
    assumption: "GAAP EPS separately guided to at least $19.50",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/731766/000073176626000255/earningsrelease3q26unh.htm",
  },
  {
    ticker: "WMT",
    metric: "Net sales growth",
    period: "FY2027",
    value: "4.0–5.0%",
    revision: "Raised from 3.5–4.5%",
    basis: "Constant currency",
    assumption: "Flipkart event timing and tariff-refund reinvestment disclosed separately",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/104169/000010416926000145/earningsreleasefy27q2.htm",
  },
  {
    ticker: "PFE",
    metric: "Revenue",
    period: "FY2026",
    value: "$60.5–62.5 billion",
    revision: "Raised from $59.5–62.5 billion",
    basis: "Reported",
    assumption: "Non-COVID strength partly offset by lower COVID-product expectations",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/78003/000007800326000094/pfe-6282026xex99.htm",
  },
];
