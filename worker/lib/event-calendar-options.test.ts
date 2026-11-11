import { describe, expect, it } from "vitest";
import { eventCalendarOptions } from "./event-calendar-options";

describe("event calendar command options", () => {
  it("keeps the research-50 defaults", () => {
    expect(eventCalendarOptions([])).toEqual({ universeFile: "worker/research-universe-50.json", suffix: "50", from: "2000-01-01", check: false });
  });

  it("accepts a separate universe, suffix and start date", () => {
    expect(eventCalendarOptions(["--universe", "D:/research/alpha-engine/engine/events/universe-rest.json", "--suffix", "rest", "--from", "2005-01-01", "--check"])).toEqual({ universeFile: "D:/research/alpha-engine/engine/events/universe-rest.json", suffix: "rest", from: "2005-01-01", check: true });
  });

  it("rejects unsafe suffixes and unknown arguments", () => {
    expect(() => eventCalendarOptions(["--suffix", "../50"])).toThrow(/Invalid output suffix/);
    expect(() => eventCalendarOptions(["--limit", "20"])).toThrow(/Unknown argument/);
  });
});
