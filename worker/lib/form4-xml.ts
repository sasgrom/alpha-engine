import { boolFromXml, finiteNumber, type Form4Owner, type Form4Transaction } from "./form4-core";

export interface Form4ParseContext {
  accessionNo: string;
  form: string;
  availableAt: string;
  issuerCik: number;
  ticker: string;
  periodOfReport: string;
  sourceUrl: string;
  inputSha256: string;
}

function decodeXml(value: string): string {
  return value.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();
}

function blocks(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "gi"))].map((match) => match[1]);
}

function value(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!match) return null;
  const decoded = decodeXml(match[1]);
  const nested = decoded.match(/^<value(?:\s[^>]*)?>([\s\S]*?)<\/value>$/i);
  const text = nested ? decodeXml(nested[1]) : decoded;
  return text.replace(/<[^>]+>/g, "").trim();
}

function required(value: string | null, field: string): string {
  if (!value) throw new Error(`Form 4 schema mismatch: missing ${field}`);
  return value;
}

function boolFlag(xml: string, tag: string): boolean {
  return boolFromXml(value(xml, tag)) === true;
}

export function parseForm4Xml(xml: string, context: Form4ParseContext): Form4Transaction[] {
  if (!/<ownershipDocument[\s>]/i.test(xml)) throw new Error("Form 4 schema mismatch: ownershipDocument is absent");
  const issuerCik = Number(value(xml, "issuerCik"));
  if (!Number.isInteger(issuerCik) || issuerCik <= 0) throw new Error("Form 4 schema mismatch: issuerCik is invalid");
  if (issuerCik !== context.issuerCik) return [];
  const footnotes = new Map([...xml.matchAll(/<footnote(?:\s[^>]*)?\bid=["']([^"']+)["'][^>]*>([\s\S]*?)<\/footnote>/gi)].map((match) => [match[1], decodeXml(match[2])] as const));
  const globalPeriod = value(xml, "periodOfReport") ?? context.periodOfReport;
  const isAmendment = context.form.endsWith("/A") || boolFromXml(value(xml, "isAmendment")) === true;
  const amendmentOf = value(xml, "amendmentReferenceNumber");
  const owners: Form4Owner[] = blocks(xml, "reportingOwner").map((owner) => ({
    ownerCik: finiteNumber(value(owner, "rptOwnerCik")),
    rptOwnerName: required(value(owner, "rptOwnerName"), "rptOwnerName"),
    isDirector: boolFlag(owner, "isDirector"),
    isOfficer: boolFlag(owner, "isOfficer"),
    isTenPercentOwner: boolFlag(owner, "isTenPercentOwner"),
    isOther: boolFlag(owner, "isOther"),
    officerTitle: value(owner, "officerTitle"),
    otherText: value(owner, "otherText"),
  }));
  const transactionBlocks = ["nonDerivativeTransaction", "derivativeTransaction"].flatMap((tag) => blocks(xml, tag));
  const primaryOwner = owners[0];
  if (!primaryOwner) return [];
  const rows: Form4Transaction[] = [];
  for (const transaction of transactionBlocks) {
    const eventTs = required(value(transaction, "transactionDate"), "transactionDate");
    const transactionCode = required(value(transaction, "transactionCode"), "transactionCode").toUpperCase();
    const transactionFormType = value(transaction, "transactionFormType") ?? "";
    const equitySwapInvolved = boolFromXml(value(transaction, "equitySwapInvolved"));
    const shares = finiteNumber(value(transaction, "transactionShares"));
    const pricePerShare = finiteNumber(value(transaction, "transactionPricePerShare"));
    const valueUsd = shares !== null && pricePerShare !== null ? shares * pricePerShare : null;
    const acquiredDisposedCode = required(value(transaction, "transactionAcquiredDisposedCode"), "transactionAcquiredDisposedCode").toUpperCase();
    const directOrIndirect = value(transaction, "directOrIndirectOwnership") ?? "";
    const natureOfOwnership = value(transaction, "natureOfOwnership") ?? "";
    const sharesOwnedAfter = finiteNumber(value(transaction, "sharesOwnedFollowingTransaction"));
    const percentOwnedAfter = finiteNumber(value(transaction, "percentOwnedFollowingTransaction"));
    const references = [...transaction.matchAll(/<footnoteId[^>]*\bid=["']([^"']+)["'][^>]*\/?\s*>/gi)].map((match) => match[1]);
    const ownerReference = value(transaction, "ownerReference") ?? value(transaction, "rptOwnerReference") ?? value(transaction, "ownerRef") ?? value(transaction, "reportingOwnerReference");
    const owner = ownerReference ? owners.find((candidate) => String(candidate.ownerCik ?? "") === ownerReference || candidate.rptOwnerName === ownerReference) ?? primaryOwner : primaryOwner;
    rows.push({
      issuerCik,
      ticker: value(xml, "issuerTradingSymbol") ?? context.ticker,
      accessionNo: context.accessionNo,
      eventTs,
      availableAt: context.availableAt,
      transactionCode,
      transactionFormType,
      equitySwapInvolved,
      shares,
      pricePerShare,
      valueUsd,
      acquiredDisposedCode,
      directOrIndirect,
      natureOfOwnership,
      sharesOwnedAfter,
      percentOwnedAfter,
      ...owner,
      owners: owners.map((candidate) => ({ ...candidate })),
      multiOwner: owners.length > 1,
      ownerReference,
      footnotes: references.map((id) => footnotes.get(id)).filter((note): note is string => Boolean(note)),
      sourceUrl: context.sourceUrl,
      inputSha256: context.inputSha256,
      periodOfReport: globalPeriod,
      isAmendment,
      amendmentOf,
    });
  }
  return rows;
}
