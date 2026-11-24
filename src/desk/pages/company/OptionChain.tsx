import { useEffect, useMemo, useRef, useState } from "react";
import type { DeskOptionQuote } from "@contracts/desk-option-chain";
import { trpc } from "@/providers/trpc";
import { Segmented, Shimmer } from "../../components";
import { DeskDialog } from "../../DeskDialog";
import { fmtCompact, fmtDate, fmtNum, fmtPct, fmtPrice } from "../../format";

type Reach = "near" | "all";
/** "Near the money": strikes within this share of the price at the capture. */
const NEAR = 0.15;

const quoteCells = (quote: DeskOptionQuote | null, side: "call" | "put") => {
  const size = [
    <td key="oi" className="num desk-ink-2">{quote?.openInterest == null ? "—" : fmtCompact(quote.openInterest)}</td>,
    <td key="volume" className="num desk-ink-2">{quote?.volume == null ? "—" : fmtCompact(quote.volume)}</td>,
  ];
  const greeks = [
    <td key="iv" className="num">{quote?.iv == null ? "—" : fmtPct(quote.iv, 1, false)}</td>,
    <td key="delta" className="num desk-ink-2">{quote?.delta == null ? "—" : fmtNum(quote.delta, 2)}</td>,
  ];
  const prices = [
    <td key="bid" className="num">{quote?.bid == null ? "—" : fmtNum(quote.bid, 2)}</td>,
    <td key="ask" className="num">{quote?.ask == null ? "—" : fmtNum(quote.ask, 2)}</td>,
  ];
  // the two bid and ask pairs sit next to the strike; a put's other columns mirror the call's
  return side === "call" ? [...size, ...greeks, ...prices] : [...prices, ...greeks.reverse(), ...size.reverse()];
};

/** The company's latest option chain, one expiration at a time: calls on the left, puts on the right of each strike. */
export function OptionChainDialog({ ticker, onClose }: { ticker: string; onClose: () => void }) {
  const [expiration, setExpiration] = useState<string | undefined>(undefined);
  const [reach, setReach] = useState<Reach>("near");
  const query = trpc.desk.companyOptionChain.useQuery({ ticker, expiration }, { staleTime: 5 * 60_000, refetchOnWindowFocus: false, placeholderData: (previous) => previous });
  const chain = query.data ?? null;
  const price = chain?.underlyingPrice ?? null;
  const strikes = useMemo(() => {
    if (!chain) return [];
    return reach === "all" || price === null ? chain.strikes : chain.strikes.filter((row) => Math.abs(row.strike / price - 1) <= NEAR);
  }, [chain, reach, price]);
  // the strike nearest the price: the row the eye should start from
  const atMoney = useMemo(() => (price === null || !strikes.length ? null : strikes.reduce((best, row) => (Math.abs(row.strike - price) < Math.abs(best.strike - price) ? row : best)).strike), [strikes, price]);
  const shown = chain?.expirations.find((item) => item.date === chain.expiration) ?? null;
  // open on the strike at the share price, not on the lowest strike of the list
  const wrap = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const box = wrap.current, row = box?.querySelector<HTMLElement>("[data-at-money]");
    if (box && row) box.scrollTop = Math.max(0, row.offsetTop - box.clientHeight / 2);
  }, [chain?.expiration, reach, atMoney]);

  return (
    <DeskDialog title={`${ticker} option chain`} onClose={onClose} wide>
      {query.isLoading ? (
        <Shimmer height={320} />
      ) : query.error ? (
        <div className="desk-empty" role="alert">The option chain could not be read: {query.error.message}</div>
      ) : !chain ? (
        <div className="desk-empty">No complete option chain is in the archive for {ticker}.</div>
      ) : (
        <>
          <p className="desk-ink-2" style={{ fontSize: 12.5, margin: "0 0 12px" }}>
            Captured {fmtDate(chain.capturedAt.slice(0, 10), "medium")} at {chain.capturedAt.slice(11, 16)} UTC{price !== null ? `, with the share at ${fmtPrice(price)}` : ""}
            {chain.delayed ? "; the provider marked the quotes as delayed" : ""}. A snapshot, not a live quote.
          </p>
          <div className="desk-controls" style={{ marginBottom: 10 }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              Expiration
              <select className="desk-select" aria-label="Expiration" value={chain.expiration} onChange={(event) => setExpiration(event.target.value)}>
                {chain.expirations.map((item) => <option key={item.date} value={item.date}>{fmtDate(item.date, "medium")} · {item.dte === 0 ? "today" : `${item.dte} days`}</option>)}
              </select>
            </label>
            <Segmented<Reach> label="Strikes shown" options={[{ value: "near", label: "Near the money" }, { value: "all", label: `All ${chain.strikes.length} strikes` }]} value={reach} onChange={setReach} />
            <span className="desk-muted" style={{ marginLeft: "auto", fontSize: 12.5 }}>{shown ? `${shown.contracts} contracts` : ""}{query.isFetching ? " · reading" : ""}</span>
          </div>
          {strikes.length ? (
            <>
            <div className="desk-chain-sides" aria-hidden="true"><span>Calls</span><span>Puts</span></div>
            <div className="desk-table-wrap scroll" style={{ maxHeight: "58vh" }} ref={wrap}>
              <table className="desk-table desk-chain" style={{ fontSize: 12.5 }} data-option-chain aria-label="Calls on the left of each strike, puts on the right">
                <thead>
                  <tr>
                    <th className="num" title="Open interest">OI</th><th className="num">Volume</th><th className="num" title="Implied volatility">IV</th><th className="num">Delta</th><th className="num">Bid</th><th className="num">Ask</th>
                    <th className="num">Strike</th>
                    <th className="num">Bid</th><th className="num">Ask</th><th className="num">Delta</th><th className="num" title="Implied volatility">IV</th><th className="num">Volume</th><th className="num" title="Open interest">OI</th>
                  </tr>
                </thead>
                <tbody>
                  {strikes.map((row) => (
                    <tr key={row.strike} style={{ cursor: "default" }} data-at-money={row.strike === atMoney ? "true" : undefined} className={row.strike === atMoney ? "desk-chain-money" : undefined}>
                      {quoteCells(row.call, "call")}
                      <td className="num" style={{ fontWeight: 620 }} title={row.strike === atMoney ? "The strike nearest the share price at the capture" : undefined}>{fmtNum(row.strike, row.strike % 1 ? 2 : 0)}</td>
                      {quoteCells(row.put, "put")}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          ) : (
            <div className="desk-empty">No strike of this expiration is within {NEAR * 100}% of the share price. Show all strikes to see them.</div>
          )}
          <p className="desk-muted" style={{ fontSize: 12, margin: "10px 0 0" }}>
            Schwab market data, as captured by the daily collector; bid and ask in dollars per share, implied volatility annualized. A figure the provider gives as zero or above 500% volatility is left out.
          </p>
        </>
      )}
    </DeskDialog>
  );
}
