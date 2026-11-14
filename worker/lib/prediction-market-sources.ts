import type { PublicHttp } from "./prediction-market-http";
import { excludedMarket, nonUsMacro, type JsonObject } from "./prediction-markets";

export interface PredictionSources {
  series(): Promise<JsonObject[]>;
  markets(series: string): Promise<JsonObject[]>;
  candles(series: string, market: JsonObject): Promise<JsonObject[] | null>;
  polyEvents(topic: string): Promise<JsonObject[]>;
  polyEvent(slug: string): Promise<JsonObject>;
  polyHistory(token: string): Promise<{ t: number; p: number }[]>;
}

const KALSHI = "https://api.elections.kalshi.com/trade-api/v2", GAMMA = "https://gamma-api.polymarket.com", CLOB = "https://clob.polymarket.com";

function requiredArray(value: unknown, key: string): JsonObject[] {
  if (!Array.isArray(value)) throw new Error(`Expected an array in ${key}`);
  return value as JsonObject[];
}

export function httpPredictionSources(http: PublicHttp): PredictionSources {
  return {
    async series() {
      const body = await http.get(`${KALSHI}/series?include_product_metadata=false`);
      return requiredArray(body?.series, "series");
    },
    async markets(series) {
      const rows: JsonObject[] = [], seen = new Set<string>();
      for (const section of ["/historical/markets", "/markets"]) {
        let cursor = "";
        for (;;) {
          const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
          const body = await http.get(`${KALSHI}${section}?series_ticker=${encodeURIComponent(series)}&limit=1000${suffix}`);
          if (!body) break;
          for (const market of requiredArray(body.markets, `${section}/${series}`)) {
            const ticker = String(market.ticker);
            if (seen.has(ticker)) continue;
            seen.add(ticker);
            rows.push({ ...market, _section: section === "/historical/markets" ? "historical" : "live" });
          }
          cursor = body.cursor ?? "";
          if (!cursor) break;
        }
      }
      return rows;
    },
    async candles(series, market) {
      const open = Date.parse(String(market.open_time)) / 1000 - 86_400, close = Date.parse(String(market.close_time ?? market.open_time)) / 1000 + 86_400;
      if (!Number.isFinite(open) || !Number.isFinite(close)) throw new Error(`Invalid market time for ${String(market.ticker)}`);
      const query = `start_ts=${open}&end_ts=${close}&period_interval=1440`;
      const path = market._section === "historical" ? `/historical/markets/${encodeURIComponent(String(market.ticker))}/candlesticks?${query}` : `/series/${encodeURIComponent(series)}/markets/${encodeURIComponent(String(market.ticker))}/candlesticks?${query}`;
      const body = await http.get(`${KALSHI}${path}`);
      return body ? requiredArray(body.candlesticks ?? [], `${String(market.ticker)} candles`) : null;
    },
    async polyEvents(topic) {
      const query = topic === "fed" ? "fed decision" : topic === "cpi" ? "CPI inflation" : topic;
      const events = new Map<string, JsonObject>();
      for (const status of ["active", "resolved"]) {
        const body = await http.get(`${GAMMA}/public-search?q=${encodeURIComponent(query)}&limit_per_type=50&events_status=${status}`);
        for (const event of requiredArray(body?.events, `${topic} search`)) {
          const slug = String(event.slug ?? "");
          if (!slug || excludedMarket(`${slug} ${event.title ?? ""}`) || nonUsMacro(`${slug} ${event.title ?? ""}`)) continue;
          if (topic === "fed" && !/^fed-decision-in-[a-z]+(-\d+)?(-\d{4})?$/.test(slug)) continue;
          if (topic === "cpi" && (!/cpi|inflation|consumer-price/.test(slug) || /delays?/i.test(`${slug} ${event.title ?? ""}`))) continue;
          if (topic === "recession" && !/recession/.test(slug)) continue;
          if (topic === "payrolls" && !/payroll|nonfarm|jobs/.test(slug)) continue;
          if (topic === "unemployment" && !/unemployment/.test(slug)) continue;
          events.set(slug, event);
        }
      }
      return [...events.values()];
    },
    async polyEvent(slug) {
      const body = await http.get(`${GAMMA}/events?slug=${encodeURIComponent(slug)}`);
      if (!Array.isArray(body) || !body[0]) throw new Error(`No event for ${slug}`);
      return body[0];
    },
    async polyHistory(token) {
      const body = await http.get(`${CLOB}/prices-history?market=${encodeURIComponent(token)}&interval=max&fidelity=1440`);
      return requiredArray(body?.history ?? [], `${token} history`).map(row => ({ t: Number(row.t), p: Number(row.p) }));
    },
  };
}
