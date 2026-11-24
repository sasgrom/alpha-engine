/**
 * company router: the desk company page's short interest, read from the desk's FINRA file (no database read). The classic company page's
 * procedures (overview, factors, value, probability, institutional, insider trades, signals) and the documents,
 * series, pipeline and sections routers that lived here went with the classic view on 2026-11-24.
 */
import { z } from "zod";
import { createRouter, authedQuery } from "../middleware";
import { latestDeskShortInterest } from "../services/desk-short-interest";

export const companyRouter = createRouter({
  /** Short interest state from FINRA's settlement files: current, prior and the change in shares. */
  shortInterest: authedQuery.input(z.object({ cik: z.number() })).query(({ input }) => latestDeskShortInterest(input.cik)),
});
