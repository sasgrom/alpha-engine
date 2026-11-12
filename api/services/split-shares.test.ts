import { describe, expect, it } from "vitest";
import {
  applySplitEvents,
  buildSplitProfile,
  nearestSplitRatio,
  selectShareCount,
  type SeriesFact,
  type SplitFact,
} from "./split-shares";

function fact(
  concept: string,
  endDate: string,
  val: number,
  filed: string,
  accession = `${concept}-${endDate}-${filed}`
): SplitFact {
  return {
    concept,
    endDate,
    val,
    filed,
    accn: accession,
    form: filed.startsWith("202") ? "10-Q" : "10-K",
    startDate: concept.startsWith("WeightedAverageNumber")
      ? new Date(Date.parse(endDate) - 90 * 86400_000)
          .toISOString()
          .slice(0, 10)
      : null,
  };
}
function series(
  concept: string,
  periodEnd: string,
  val: number,
  filed: string,
  vintage = "first"
): SeriesFact {
  return {
    concept,
    periodEnd,
    vintage,
    val,
    sourceAccn: `${concept}-${periodEnd}-${filed}`,
    sourceFiled: filed,
  };
}

describe("split ratio evidence", () => {
  it("uses clean ratios and their inverses with tighter count tolerance", () => {
    expect(nearestSplitRatio(19.982318271119844)).toEqual({
      ratio: 20,
      error: 0.0008840864440077922,
    });
    expect(nearestSplitRatio(20.04, 0.03)?.ratio).toBe(20);
    expect(nearestSplitRatio(1 / 3 + 0.0001)?.ratio).toBe(1 / 3);
    expect(nearestSplitRatio(1.37)).toBeNull();
  });

  it("accepts corroborated NVDA 10:1 and preserves the first new-basis filing", () => {
    const profile = buildSplitProfile([
      fact(
        "WeightedAverageNumberOfDilutedSharesOutstanding",
        "2024-04-28",
        2489000000,
        "2024-05-29"
      ),
      fact(
        "WeightedAverageNumberOfDilutedSharesOutstanding",
        "2024-04-28",
        24869000000,
        "2024-08-28"
      ),
      fact(
        "WeightedAverageNumberOfDilutedSharesOutstanding",
        "2024-04-28",
        24890000000,
        "2025-05-28"
      ),
      fact(
        "WeightedAverageNumberOfSharesOutstandingBasic",
        "2024-04-28",
        2462000000,
        "2024-05-29"
      ),
      fact(
        "WeightedAverageNumberOfSharesOutstandingBasic",
        "2024-04-28",
        24599000000,
        "2024-08-28"
      ),
    ]);
    expect(profile.events).toHaveLength(1);
    expect(profile.events[0].ratio).toBe(10);
    expect(profile.events[0].firstNewBasisFiled).toBe("2024-08-28");
    expect(profile.events[0].evidence).toHaveLength(2);
    expect(
      applySplitEvents(2489000000, "2024-05-29", profile.events).shares
    ).toBe(24890000000);
    expect(
      applySplitEvents(2489000000, "2024-08-28", profile.events).shares
    ).toBe(2489000000);
  });

  it("accepts GOOGL 20:1 from the comparative common-share period and inverted EPS", () => {
    const profile = buildSplitProfile([
      fact(
        "CommonStockSharesOutstanding",
        "2021-12-31",
        662121000,
        "2022-02-02"
      ),
      fact(
        "CommonStockSharesOutstanding",
        "2021-12-31",
        13242000000,
        "2022-07-27"
      ),
      fact("EarningsPerShareDiluted", "2021-06-30", 27.26, "2021-08-01"),
      fact("EarningsPerShareDiluted", "2021-06-30", 1.36, "2022-07-27"),
      fact("EarningsPerShareDiluted", "2022-03-31", 24.62, "2022-04-27"),
      fact("EarningsPerShareDiluted", "2022-03-31", 1.23, "2022-07-27"),
      fact(
        "StockholdersEquityNoteStockSplitConversionRatio1",
        "2022-02-01",
        20,
        "2022-04-27"
      ),
    ]);
    expect(profile.events[0].ratio).toBe(20);
    expect(profile.events[0].firstNewBasisFiled).toBe("2022-07-27");
    expect(profile.events[0].tagValues).toEqual([20]);
    expect(
      applySplitEvents(662121000, "2022-02-02", profile.events).shares
    ).toBe(13242420000);
  });

  it("accepts WMT 3:1 and converts the pre-split cover count", () => {
    const profile = buildSplitProfile([
      fact(
        "WeightedAverageNumberOfDilutedSharesOutstanding",
        "2023-04-30",
        2704000000,
        "2023-06-01"
      ),
      fact(
        "WeightedAverageNumberOfDilutedSharesOutstanding",
        "2023-04-30",
        8112000000,
        "2024-03-15"
      ),
      fact(
        "WeightedAverageNumberOfSharesOutstandingBasic",
        "2023-04-30",
        2703000000,
        "2023-06-01"
      ),
      fact(
        "WeightedAverageNumberOfSharesOutstandingBasic",
        "2023-04-30",
        8108000000,
        "2024-03-15"
      ),
      fact(
        "StockholdersEquityNoteStockSplitConversionRatio1",
        "2024-02-23",
        3,
        "2024-03-15"
      ),
    ]);
    expect(profile.events[0].ratio).toBe(3);
    expect(
      applySplitEvents(2691563850, "2023-09-01", profile.events).shares
    ).toBe(8074691550);
  });

  it("requires corroboration and rejects an unclean conversion", () => {
    const profile = buildSplitProfile([
      fact(
        "WeightedAverageNumberOfDilutedSharesOutstanding",
        "2020-01-01",
        100,
        "2020-02-01"
      ),
      fact(
        "WeightedAverageNumberOfDilutedSharesOutstanding",
        "2020-01-01",
        137,
        "2021-02-01"
      ),
    ]);
    expect(profile.events).toHaveLength(0);
    expect(profile.rejected[0].reason).toBe("unclean_ratio");
    expect(
      selectShareCount(
        {
          ...profile,
          series: [
            series(
              "WeightedAverageNumberOfDilutedSharesOutstanding",
              "2020-01-01",
              100,
              "2020-02-01"
            ),
            series(
              "WeightedAverageNumberOfDilutedSharesOutstanding",
              "2020-01-01",
              137,
              "2021-02-01",
              "latest"
            ),
          ],
        },
        "2021-03-01"
      )
    ).toBeNull();
  });

  it("does not compare quarterly and year-to-date averages as a split", () => {
    const quarter = fact(
      "WeightedAverageNumberOfDilutedSharesOutstanding",
      "2025-09-30",
      510900000,
      "2025-11-03"
    );
    const ytd = fact(
      "WeightedAverageNumberOfDilutedSharesOutstanding",
      "2025-09-30",
      639500000,
      "2026-11-03"
    );
    ytd.startDate = "2025-01-01";
    const profile = buildSplitProfile([quarter, ytd]);
    expect(profile.events).toHaveLength(0);
    expect(profile.rejected).toHaveLength(0);
  });

  it("uses a tag only as confirmation, never as the sole split source", () => {
    const rows = [
      fact(
        "WeightedAverageNumberOfDilutedSharesOutstanding",
        "2020-01-01",
        100,
        "2020-02-01"
      ),
      fact(
        "WeightedAverageNumberOfDilutedSharesOutstanding",
        "2020-01-01",
        300,
        "2021-02-01"
      ),
    ];
    expect(buildSplitProfile(rows).events).toHaveLength(0);
    const confirmed = buildSplitProfile([
      ...rows,
      fact(
        "StockholdersEquityNoteStockSplitConversionRatio1",
        "2020-06-01",
        3,
        "2020-06-15"
      ),
    ]);
    expect(confirmed.events).toHaveLength(1);
    expect(confirmed.events[0].ratio).toBe(3);
  });

  it("applies TSLA's two splits by filing date, not by period-end guesses", () => {
    const profile = buildSplitProfile([
      fact(
        "WeightedAverageNumberOfDilutedSharesOutstanding",
        "2020-06-30",
        207000000,
        "2020-07-28"
      ),
      fact(
        "WeightedAverageNumberOfDilutedSharesOutstanding",
        "2020-06-30",
        1036000000,
        "2021-07-27"
      ),
      fact(
        "WeightedAverageNumberOfSharesOutstandingBasic",
        "2020-06-30",
        207000000,
        "2020-07-28"
      ),
      fact(
        "WeightedAverageNumberOfSharesOutstandingBasic",
        "2020-06-30",
        1035000000,
        "2021-07-27"
      ),
      fact(
        "WeightedAverageNumberOfDilutedSharesOutstanding",
        "2022-06-30",
        1155000000,
        "2022-07-25"
      ),
      fact(
        "WeightedAverageNumberOfDilutedSharesOutstanding",
        "2022-06-30",
        3464000000,
        "2023-07-24"
      ),
      fact(
        "WeightedAverageNumberOfSharesOutstandingBasic",
        "2022-06-30",
        1155000000,
        "2022-07-25"
      ),
      fact(
        "WeightedAverageNumberOfSharesOutstandingBasic",
        "2022-06-30",
        3465000000,
        "2023-07-24"
      ),
    ]);
    expect(profile.events.map(event => event.ratio)).toEqual([5, 3]);
    expect(
      applySplitEvents(207000000, "2020-07-28", profile.events).shares
    ).toBe(3105000000);
    expect(
      applySplitEvents(1035000000, "2021-08-01", profile.events).shares
    ).toBe(3105000000);
  });
});

describe("share-count selection", () => {
  it("does not prefer an old cover count over a newer weighted count", () => {
    const profile = buildSplitProfile(
      [
        fact(
          "EntityCommonStockSharesOutstanding",
          "2015-07-17",
          855351589,
          "2015-07-23"
        ),
        fact(
          "WeightedAverageNumberOfDilutedSharesOutstanding",
          "2026-08-31",
          1484200000,
          "2026-10-02"
        ),
      ],
      [
        series(
          "WeightedAverageNumberOfDilutedSharesOutstanding",
          "2026-08-31",
          1484200000,
          "2026-10-02"
        ),
        series(
          "WeightedAverageNumberOfDilutedSharesOutstanding",
          "2026-08-31",
          1484200000,
          "2026-10-02",
          "latest"
        ),
      ]
    );
    const selected = selectShareCount(profile, "2026-11-11");
    expect(selected?.source).toBe("weighted_diluted");
    expect(selected?.shares).toBe(1484200000);
  });

  it("uses weighted basic when cover and common shares are absent", () => {
    const profile = buildSplitProfile(
      [
        fact(
          "WeightedAverageNumberOfSharesOutstandingBasic",
          "2026-09-30",
          1700000000,
          "2026-10-30"
        ),
      ],
      [
        series(
          "WeightedAverageNumberOfSharesOutstandingBasic",
          "2026-09-30",
          1700000000,
          "2026-10-30"
        ),
      ]
    );
    expect(selectShareCount(profile, "2026-11-11")?.source).toBe(
      "weighted_basic"
    );
  });
});

describe("current-share recency and duration", () => {
  it("rejects a cover count older than two quarters when no fresher source exists", () => {
    const profile = buildSplitProfile([
      fact(
        "EntityCommonStockSharesOutstanding",
        "2010-10-27",
        122530193,
        "2010-11-02"
      ),
    ]);
    expect(selectShareCount(profile, "2026-11-11")).toBeNull();
  });

  it("does not treat an annual weighted average as a current quarterly count", () => {
    const annual = fact(
      "WeightedAverageNumberOfDilutedSharesOutstanding",
      "2026-12-31",
      8108000000,
      "2027-03-15"
    );
    annual.startDate = "2026-01-01";
    const profile = buildSplitProfile(
      [annual],
      [
        series(
          "WeightedAverageNumberOfDilutedSharesOutstanding",
          "2026-12-31",
          8108000000,
          "2027-03-15"
        ),
      ]
    );
    expect(selectShareCount(profile, "2027-04-15")).toBeNull();
  });
});

describe("split events with the same ratio at different dates", () => {
  it("keeps the first new-basis dates separate", () => {
    const profile = buildSplitProfile([
      fact(
        "WeightedAverageNumberOfDilutedSharesOutstanding",
        "2021-01-25",
        100,
        "2021-02-01"
      ),
      fact(
        "WeightedAverageNumberOfDilutedSharesOutstanding",
        "2021-01-25",
        1000,
        "2021-08-20"
      ),
      fact(
        "WeightedAverageNumberOfSharesOutstandingBasic",
        "2021-01-25",
        100,
        "2021-02-01"
      ),
      fact(
        "WeightedAverageNumberOfSharesOutstandingBasic",
        "2021-01-25",
        1000,
        "2021-08-20"
      ),
      fact(
        "WeightedAverageNumberOfDilutedSharesOutstanding",
        "2024-04-28",
        100,
        "2024-05-29"
      ),
      fact(
        "WeightedAverageNumberOfDilutedSharesOutstanding",
        "2024-04-28",
        1000,
        "2024-08-28"
      ),
      fact(
        "WeightedAverageNumberOfSharesOutstandingBasic",
        "2024-04-28",
        100,
        "2024-05-29"
      ),
      fact(
        "WeightedAverageNumberOfSharesOutstandingBasic",
        "2024-04-28",
        1000,
        "2024-08-28"
      ),
    ]);
    expect(profile.events.map(event => event.firstNewBasisFiled)).toEqual([
      "2021-08-20",
      "2024-08-28",
    ]);
    expect(applySplitEvents(100, "2024-05-29", profile.events).ratio).toBe(10);
  });
});

describe("current source ordering and reporting recency", () => {
  it("accepts a count from the latest two reporting quarters", () => {
    const profile = buildSplitProfile([
      fact(
        "EntityCommonStockSharesOutstanding",
        "2026-04-28",
        932338000,
        "2026-04-30"
      ),
    ]);
    expect(selectShareCount(profile, "2026-11-11")?.shares).toBe(932338000);
  });

  it("prefers the basic weighted average over the diluted average for current value", () => {
    const profile = buildSplitProfile(
      [
        fact(
          "WeightedAverageNumberOfSharesOutstandingBasic",
          "2026-09-30",
          2200000000,
          "2026-10-30"
        ),
        fact(
          "WeightedAverageNumberOfDilutedSharesOutstanding",
          "2026-09-30",
          2500000000,
          "2026-10-30"
        ),
      ],
      [
        series(
          "WeightedAverageNumberOfDilutedSharesOutstanding",
          "2026-09-30",
          2500000000,
          "2026-10-30"
        ),
        series(
          "WeightedAverageNumberOfSharesOutstandingBasic",
          "2026-09-30",
          2200000000,
          "2026-10-30"
        ),
      ]
    );
    expect(selectShareCount(profile, "2026-11-11")?.source).toBe(
      "weighted_basic"
    );
  });
});
