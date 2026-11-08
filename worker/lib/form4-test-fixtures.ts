export function form4FixtureXml(codes = ["P", "A", "M", "F", "G", "S"], amendment = false): string {
  const transactions = codes.map((code, index) => `
    <nonDerivativeTransaction>
      <transactionDate><value>2026-10-${String(index + 1).padStart(2, "0")}</value></transactionDate>
      <transactionCoding>
        <transactionFormType>Common Stock</transactionFormType>
        <transactionCode>${code}</transactionCode>
        <equitySwapInvolved>0</equitySwapInvolved>
      </transactionCoding>
      <transactionAmounts>
        <transactionShares><value>100</value></transactionShares>
        <transactionPricePerShare><value>25</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>${code === "S" ? "D" : "A"}</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>1100</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
      <ownershipNature>
        <directOrIndirectOwnership><value>${index % 2 ? "I" : "D"}</value></directOrIndirectOwnership>
        <natureOfOwnership><value>By Trust</value></natureOfOwnership>
      </ownershipNature>
      <footnoteId id="F1"/>
    </nonDerivativeTransaction>`).join("\n");
  return `<?xml version="1.0"?>
  <ownershipDocument>
    <documentType>${amendment ? "4/A" : "4"}</documentType>
    <periodOfReport>2026-10-01</periodOfReport>
    ${amendment ? "<isAmendment>1</isAmendment><amendmentInfo><amendmentReferenceNumber>0000000000-26-000001</amendmentReferenceNumber></amendmentInfo>" : ""}
    <issuer><issuerCik>50863</issuerCik><issuerTradingSymbol>INTC</issuerTradingSymbol></issuer>
    <reportingOwner>
      <reportingOwnerId><rptOwnerCik>12345</rptOwnerCik><rptOwnerName>QA Insider</rptOwnerName></reportingOwnerId>
      <reportingOwnerRelationship>
        <isDirector>1</isDirector><isOfficer>1</isOfficer><isTenPercentOwner>0</isTenPercentOwner><officerTitle>Chief Financial Officer</officerTitle>
      </reportingOwnerRelationship>
      ${transactions}
    </reportingOwner>
    <footnotes><footnote id="F1">Open-market execution footnote</footnote></footnotes>
  </ownershipDocument>`;
}
