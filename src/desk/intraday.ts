import { trpc } from "@/providers/trpc";

export function useDeskIntraday(ticker: string, sessions: 1 | 5, enabled = true) {
  return trpc.desk.intraday.useQuery({ ticker, sessions }, {
    enabled: enabled && Boolean(ticker),
    staleTime: 60_000,
    placeholderData: previous => previous,
    refetchInterval: query => document.visibilityState === "visible" && query.state.data?.marketOpen ? 5 * 60_000 : false,
    refetchIntervalInBackground: false,
  });
}

export function useDeskIntradayMarket() {
  return trpc.desk.intradayMarket.useQuery(undefined, {
    staleTime: 60_000,
    refetchInterval: query => document.visibilityState === "visible" && query.state.data?.marketOpen ? 5 * 60_000 : false,
    refetchIntervalInBackground: false,
  });
}
