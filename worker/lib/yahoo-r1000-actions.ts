export function yahooActionsUrl(ticker: string, endYear: number) {
  const end = Math.floor(Date.UTC(endYear, 0, 1) / 1000);
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=0&period2=${end}&interval=1d&events=div%2Csplits&includeAdjustedClose=true`;
}

export function validYahooActionsAnswer(body: any) {
  const result = body?.chart?.result?.[0];
  return Boolean(result && !body?.chart?.error && Array.isArray(result.timestamp) && result.timestamp.length > 0);
}

export type YahooFetch = (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export async function fetchYahooActions(ticker: string, endYear: number, fetchImpl: YahooFetch, wait: (ms: number) => Promise<void>) {
  let lastError = "unknown error";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetchImpl(yahooActionsUrl(ticker, endYear), { headers: { "user-agent": "alpha-engine-research/1.0" } });
      const raw = await response.text();
      const body = JSON.parse(raw);
      if (response.ok && validYahooActionsAnswer(body)) return { body, raw, attempts: attempt };
      lastError = `HTTP ${response.status}: ${JSON.stringify(body?.chart?.error ?? "invalid chart")}`.slice(0, 500);
    } catch (error) {
      lastError = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    }
    if (attempt < 3) await wait(1500);
  }
  return { error: lastError, attempts: 3 };
}
