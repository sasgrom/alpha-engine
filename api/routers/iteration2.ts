/**
 * company router: what the desk company page still asks the app database for. The classic company page's
 * procedures (overview, factors, value, probability, institutional, insider trades, signals) and the documents,
 * series, pipeline and sections routers that lived here went with the classic view on 2026-11-24.
 */
import { z } from "zod";
import { createRouter, authedQuery } from "../middleware";
import { latestShortInterest } from "../services/short-interest";

export const companyRouter = createRouter({
  /** Short interest state: current, prior and the change in shares. */
  shortInterest: authedQuery.input(z.object({ cik: z.number() })).query(({ input }) => latestShortInterest(input.cik)),
});
