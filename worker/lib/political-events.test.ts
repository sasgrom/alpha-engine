import { describe, expect, it } from "vitest";
import { mergePoliticalEvents, parseOfacRecentActions } from "./political-events";

const html = `<div class="margin-bottom-4 search-result views-row"><div><div><a href="/recent-actions/20261029" hreflang="en">Issuance of Amended Iran-related General License</a></div></div><div><div>October 29, 2026 - <a href="/recent-actions/general-licenses">General Licenses</a></div></div></div>
<div class="margin-bottom-4 search-result views-row"><div><div><a href="/recent-actions/20261028" hreflang="en">Treasury&#039;s Office &amp; Example</a></div></div><div><div>October 28, 2026 - <a href="/recent-actions/enforcement-actions">Enforcement</a></div></div></div>`;

describe("OFAC Recent Actions", () => {
  it("extracts official links and day-precision publication dates", () => {
    const events = parseOfacRecentActions(html, "2026-11-01T12:00:00Z");
    expect(events).toHaveLength(2);
    expect(events[0].eventId).toBe("ofac:20261028");
    expect(events[0].title).toBe("Treasury's Office & Example");
    expect(events[1].sourceUrl).toBe("https://ofac.treasury.gov/recent-actions/20261029");
    expect(events[1].publishedAt).toBe("2026-10-29T00:00:00.000Z");
    expect(events[1].researchEligibleAt).toBe("2026-10-29T23:59:59.999Z");
    expect(events[1].effectiveAt).toBeNull();
  });

  it("accumulates forward history without duplicating events", () => {
    const events = parseOfacRecentActions(html, "2026-11-01T12:00:00Z");
    const merged = mergePoliticalEvents(events.slice(0, 1), events);
    expect(merged).toHaveLength(2);
    expect(merged[0].eventId).toBe("ofac:20261029");
  });
});
