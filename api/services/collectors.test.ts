// Unit tests for the 4j collector parsers (fixture-based — the network paths
// are worker-run; the parsing/storing logic is what's pinned here).
import { describe, it, expect } from "vitest";
import { parseForm4 } from "./insiders";
import { parseSeenDate, toneToScore } from "./signals";

const FORM4_FIXTURE = `
<ownershipDocument>
  <reportingOwner>
    <reportingOwnerId><rptOwnerName>COOK TIMOTHY D</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship>
      <isDirector>0</isDirector>
      <officerTitle>Chief Executive Officer</officerTitle>
      <aff10b5One>1</aff10b5One>
    </reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <transactionDate><value>2026-10-15</value></transactionDate>
      <transactionCoding><transactionCode>S</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>51,205</value></transactionShares>
        <transactionPricePerShare><value>331.26</value></transactionPricePerShare>
      </transactionAmounts>
      <postTransactionAmounts>
        <sharesOwnedFollowingTransaction><value>3,280,052</value></sharesOwnedFollowingTransaction>
      </postTransactionAmounts>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
</ownershipDocument>`;

describe("parseForm4 (fixture)", () => {
  it("extracts owner, role, 10b5-1 flag and transactions", () => {
    const p = parseForm4(FORM4_FIXTURE);
    expect(p.insider).toBe("COOK TIMOTHY D");
    expect(p.role).toBe("Chief Executive Officer");
    expect(p.is10b5).toBe(true);
    expect(p.txs.length).toBe(1);
    expect(p.txs[0]).toEqual({ code: "S", shares: 51205, price: 331.26, after: 3280052, date: "2026-10-15" });
  });
  it("tolerates empty documents", () => {
    const p = parseForm4("<ownershipDocument></ownershipDocument>");
    expect(p.txs).toEqual([]);
    expect(p.is10b5).toBe(false);
  });
});

describe("signals helpers", () => {
  it("parseSeenDate converts GDELT seendate", () => {
    expect(parseSeenDate("20261019T123000Z")).toBe("2026-10-19 12:30:00");
    expect(parseSeenDate("garbage")).toBeNull();
    expect(parseSeenDate(undefined)).toBeNull();
  });
  it("toneToScore clamps Goldstein to [-1,1]", () => {
    expect(toneToScore(-25)).toBe(-1);
    expect(toneToScore(3.4)).toBeCloseTo(0.34);
    expect(toneToScore(undefined)).toBeNull();
  });
});
