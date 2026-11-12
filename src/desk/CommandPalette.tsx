/**
 * Ctrl+K / "/" command palette: jump to any company, any desk page or research tool, or run a view action.
 * Companies are ranked by searchCompanies(); with an empty query it offers recently opened companies.
 */
import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { Command } from "cmdk";
import { ArrowRight, Building2, Compass, LayoutGrid, Monitor, Moon, Search, Sun, Undo2 } from "lucide-react";
import type { DeskCompany } from "@contracts/desk-snapshot";
import { Delta } from "./components";
import { searchCompanies } from "./data";
import { fmtPrice } from "./format";
import type { PaletteDestination } from "./destinations";
import { recentTickers, rememberTicker, rememberView, type ThemeChoice } from "./preferences";

export function CommandPalette({
  companies,
  destinations,
  onClose,
  onTheme,
  onSignOut,
}: {
  companies: DeskCompany[];
  destinations: PaletteDestination[];
  onClose: () => void;
  onTheme: (choice: ThemeChoice) => void;
  onSignOut: () => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const companyMatches = useMemo(() => {
    if (q) return searchCompanies(companies, query, 8);
    const byTicker = new Map(companies.map((company) => [company.ticker, company]));
    return recentTickers().map((ticker) => byTicker.get(ticker)).filter((company): company is DeskCompany => !!company);
  }, [companies, query, q]);
  const pageMatches = destinations.filter((destination) => !q || `${destination.label} ${destination.keywords ?? ""}`.toLowerCase().includes(q)).slice(0, q ? 8 : 6);
  const actions: { label: string; icon: ReactNode; run: () => void; keywords: string }[] = [
    { label: "Switch to the classic view", icon: <Undo2 size={16} />, keywords: "classic legacy old terminal", run: () => { rememberView("classic"); navigate("/terminal"); } },
    { label: "Light theme", icon: <Sun size={16} />, keywords: "theme light day", run: () => onTheme("light") },
    { label: "Dark theme", icon: <Moon size={16} />, keywords: "theme dark night", run: () => onTheme("dark") },
    { label: "Theme follows the system", icon: <Monitor size={16} />, keywords: "theme system auto", run: () => onTheme("system") },
    { label: "Sign out", icon: <ArrowRight size={16} />, keywords: "sign out logout exit", run: onSignOut },
  ];
  const actionMatches = q ? actions.filter((action) => `${action.label} ${action.keywords}`.toLowerCase().includes(q)) : [];

  const go = (run: () => void) => {
    onClose();
    run();
  };

  return (
    <div className="desk-palette-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <Command
        className="desk-palette"
        label="Search companies, pages and actions"
        shouldFilter={false}
        loop
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <div style={{ display: "flex", alignItems: "center", paddingLeft: 16, borderBottom: "1px solid var(--d-border)" }}>
          <Search size={17} color="var(--d-muted)" aria-hidden="true" />
          <Command.Input autoFocus value={query} onValueChange={setQuery} placeholder="Search a company, a ticker or a page…" style={{ borderBottom: "none" }} />
        </div>
        <Command.List>
          <Command.Empty>Nothing matches “{query}”.</Command.Empty>
          {companyMatches.length > 0 && (
            <Command.Group heading={q ? "Companies" : "Recently opened"}>
              {companyMatches.map((company) => (
                <Command.Item
                  key={company.cik}
                  value={`company:${company.ticker}`}
                  onSelect={() => go(() => {
                    rememberTicker(company.ticker);
                    navigate(`/desk/company/${encodeURIComponent(company.ticker)}`);
                  })}
                >
                  <Building2 size={16} color="var(--d-muted)" aria-hidden="true" />
                  <span className="desk-ticker" style={{ minWidth: 54 }}>{company.ticker}</span>
                  <span className="name">{company.name}</span>
                  <span className="meta">
                    {fmtPrice(company.close)} <Delta value={company.returns.d1} />
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
          {pageMatches.length > 0 && (
            <Command.Group heading="Go to">
              {pageMatches.map((destination) => (
                <Command.Item key={destination.path} value={`page:${destination.path}`} onSelect={() => go(() => navigate(destination.path))}>
                  {destination.group === "Desk" ? <LayoutGrid size={16} color="var(--d-muted)" aria-hidden="true" /> : <Compass size={16} color="var(--d-muted)" aria-hidden="true" />}
                  <span>{destination.label}</span>
                  <span className="meta">{destination.classic ? "Classic view" : destination.group}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
          {actionMatches.length > 0 && (
            <Command.Group heading="Actions">
              {actionMatches.map((action) => (
                <Command.Item key={action.label} value={`action:${action.label}`} onSelect={() => go(action.run)}>
                  <span style={{ color: "var(--d-muted)", display: "inline-flex" }} aria-hidden="true">{action.icon}</span>
                  <span>{action.label}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
        <div className="desk-palette-foot">
          <span>↑↓ to move</span>
          <span>Enter to open</span>
          <span>Esc to close</span>
        </div>
      </Command>
    </div>
  );
}
