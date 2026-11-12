import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink, splitLink } from "@trpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import superjson from "superjson";
import type { AppRouter } from "../../api/router";
import type { ReactNode } from "react";

export const trpc = createTRPCReact<AppRouter>();

const queryClient = new QueryClient();

/** 4e (D36): the admin's view-as lens — forwarded as a header; the server
 *  honors it only for role=admin and only for reads. localStorage key shared
 *  with AppLayout's banner and the Admin → Users "View as" button. */
export const VIEW_AS_KEY = "alpha.viewAs";

const standaloneProcedures = new Set([
  "dashboard.stats",
  "dashboard.sectorFlows",
  "dashboard.sectorFlowsDetailed",
  "company.institutional",
  "company.factorIc",
  "company.probability",
]);

export function requiresStandaloneRequest(path: string): boolean {
  return standaloneProcedures.has(path);
}

const linkOptions = {
  url: "/api/trpc",
  transformer: superjson,
  fetch(input: RequestInfo | URL, init?: RequestInit) {
    const headers = new Headers(init?.headers);
    const va = localStorage.getItem(VIEW_AS_KEY);
    if (va) headers.set("x-view-as", va);
    return globalThis.fetch(input, {
      ...(init ?? {}),
      headers,
      credentials: "include",
    });
  },
};

const trpcClient = trpc.createClient({
  links: [
    splitLink({
      condition: (operation) => requiresStandaloneRequest(operation.path),
      true: httpBatchLink({ ...linkOptions, maxItems: 1 }),
      false: httpBatchLink(linkOptions),
    }),
  ],
});

export function TRPCProvider({ children }: { children: ReactNode }) {
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
