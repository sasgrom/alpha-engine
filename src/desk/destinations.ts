export interface PaletteDestination {
  label: string;
  path: string;
  group: "Desk" | "Research tools" | "Workspace" | "Owner tools";
  keywords?: string;
}

/** The reference pages and tools listed in the Library and the command palette, by audience (each page keeps its own guard). */
export function libraryDestinations(isAdmin: boolean, isPresentation: boolean): PaletteDestination[] {
  const research: PaletteDestination[] = isPresentation
    ? [
        { label: "Volatility handbook", path: "/desk/research/library/volatility-handbook", group: "Research tools", keywords: "implied volatility iv rv methodology" },
      ]
    : [];
  const workspace: PaletteDestination[] = [
    { label: "Messages", path: "/desk/messages", group: "Workspace", keywords: "chat support inbox" },
    { label: "Factor wiki", path: "/desk/research/library/factors", group: "Workspace", keywords: "definitions glossary factors" },
  ];
  const owner: PaletteDestination[] = isAdmin
    ? [
        { label: "Owner tools", path: "/desk/admin", group: "Owner tools", keywords: "admin users reviewers manuals logs monitors" },
        { label: "Operations console", path: "/desk/operations?tab=jobs", group: "Owner tools", keywords: "workers scheduler collectors jobs runs logs cron" },
      ]
    : [];
  return [...research, ...workspace, ...owner];
}
