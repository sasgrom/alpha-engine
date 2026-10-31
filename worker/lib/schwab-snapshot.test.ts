import { describe, expect, it } from "vitest";
import { schwabChainFile, schwabChunkDirectory, schwabChunkDirectoryFromFile, schwabQuoteFile, schwabSnapshotId } from "./schwab-snapshot";

const today = "2026-10-31", capturedAt = "2026-10-31T13:57:29.123Z";
describe("Schwab snapshot layout", () => {
  it("preserves normal daily resume paths", () => {
    expect(schwabChainFile(today, "AAPL", capturedAt, false)).toBe("chains/2026-10-31/AAPL.json");
    expect(schwabQuoteFile(today, "AAPL", capturedAt, false)).toBe("quotes/2026-10-31/AAPL.json");
    expect(schwabChunkDirectory(today, "AAPL", capturedAt, false)).toBe("chains/2026-10-31/chunks/AAPL");
  });

  it("creates unique force-snapshot paths instead of overwriting history", () => {
    expect(schwabSnapshotId(capturedAt)).toBe("2026-10-31T13-57-29-123Z");
    expect(schwabChainFile(today, "AAPL", capturedAt, true)).toBe("chains/2026-10-31/AAPL/2026-10-31T13-57-29-123Z.json");
    expect(schwabQuoteFile(today, "AAPL", capturedAt, true)).toBe("quotes/2026-10-31/AAPL/2026-10-31T13-57-29-123Z.json");
    expect(schwabChunkDirectory(today, "AAPL", capturedAt, true)).toBe("chains/2026-10-31/chunks/AAPL/2026-10-31T13-57-29-123Z");
  });

  it("recovers the correct chunk directory for resume validation", () => {
    expect(schwabChunkDirectoryFromFile(today, "AAPL", "chains/2026-10-31/AAPL/2026-10-31T13-57-29-123Z.json")).toBe("chains/2026-10-31/chunks/AAPL/2026-10-31T13-57-29-123Z");
    expect(schwabChunkDirectoryFromFile(today, "AAPL", "chains/2026-10-31/AAPL.json")).toBe("chains/2026-10-31/chunks/AAPL");
  });
});
