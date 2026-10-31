import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import type { User } from "@db/schema";
import { authenticateRequest } from "./kimi/auth";

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  user?: User;
  /**
   * 4e (D36): the admin's read-only "view as user" lens. Honored ONLY when
   * the caller is an admin and the x-view-as header carries a numeric user
   * id; read endpoints then resolve per-user data for THAT user. Writes
   * check ctx.user directly (or refuse when viewAsUserId is set) — the lens
   * never impersonates a write.
   */
  viewAsUserId: number | null;
};

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  const ctx: TrpcContext = { req: opts.req, resHeaders: opts.resHeaders, viewAsUserId: null };
  try {
    ctx.user = await authenticateRequest(opts.req.headers);
    if (ctx.user?.role === "admin") {
      const raw = opts.req.headers.get("x-view-as");
      const n = raw ? Number(raw) : NaN;
      if (Number.isFinite(n) && n > 0) ctx.viewAsUserId = n;
    }
  } catch {
    // Authentication is optional here
  }
  return ctx;
}
