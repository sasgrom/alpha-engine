export interface PaletteDestination {
  label: string;
  path: string;
  group: "Desk" | "Research tools" | "Workspace" | "Owner tools";
  classic?: boolean;
  keywords?: string;
}

/** Classic pages reachable from the desk, by audience (the routes keep their own guards). */
export function classicDestinations(isAdmin: boolean, isPresentation: boolean): PaletteDestination[] {
  const research: PaletteDestination[] = isPresentation
    ? [
        { label: "Scenario Lab", path: "/scenario-lab", group: "Research tools", classic: true, keywords: "macro rates oil dollar credit shock exposure" },
        { label: "Expectations", path: "/expectations", group: "Research tools", classic: true, keywords: "guidance outlook earnings release" },
        { label: "Insider buys", path: "/insider-activity", group: "Research tools", classic: true, keywords: "form 4 insider purchase" },
        { label: "Volatility handbook", path: "/analytics/methodology", group: "Research tools", classic: true, keywords: "implied volatility iv rv methodology" },
        { label: "Risk lab", path: "/analytics/risk-lab", group: "Research tools", classic: true, keywords: "risk expected move options" },
        { label: "Analytics", path: "/analytics", group: "Research tools", classic: true, keywords: "factors network" },
        { label: "Market data", path: "/market-data", group: "Research tools", classic: true, keywords: "schwab options chains quotes coverage" },
        { label: "Project state", path: "/project-state", group: "Research tools", classic: true, keywords: "status roadmap" },
      ]
    : [];
  const workspace: PaletteDestination[] = [
    { label: "Watchlist manager", path: "/universe", group: "Workspace", classic: true, keywords: "universe watchlist add remove" },
    { label: "Messages", path: "/desk/messages", group: "Workspace", keywords: "chat support inbox" },
    { label: "Jobs", path: "/jobs", group: "Workspace", classic: true, keywords: "jobs logs runs" },
    { label: "Factor wiki", path: "/wiki", group: "Workspace", classic: true, keywords: "definitions glossary factors" },
  ];
  const owner: PaletteDestination[] = isAdmin
    ? [
        { label: "Owner tools", path: "/desk/admin", group: "Owner tools", keywords: "admin users reviewers manuals logs monitors" },
        { label: "Operations console", path: "/workers", group: "Owner tools", classic: true, keywords: "workers scheduler collectors" },
        { label: "Database browser", path: "/database", group: "Owner tools", classic: true, keywords: "tables sql" },
        { label: "Sentiment lab", path: "/lab", group: "Owner tools", classic: true, keywords: "sentiment scores" },
      ]
    : [];
  return [...research, ...workspace, ...owner];
}
