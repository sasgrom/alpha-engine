export const GICS_SECTORS = [
  "Communication Services",
  "Consumer Discretionary",
  "Consumer Staples",
  "Energy",
  "Financials",
  "Health Care",
  "Industrials",
  "Information Technology",
  "Materials",
  "Real Estate",
  "Utilities",
] as const;

export type GicsSector = (typeof GICS_SECTORS)[number];

export interface SicSectorRule {
  from: number;
  to: number;
  sector: GicsSector;
  note: string;
}

export const SIC_SECTOR_RULES: SicSectorRule[] = [
  {
    from: 100,
    to: 999,
    sector: "Consumer Staples",
    note: "Agriculture, forestry and fishing",
  },
  { from: 1000, to: 1299, sector: "Materials", note: "Metal and coal mining" },
  {
    from: 1300,
    to: 1399,
    sector: "Energy",
    note: "Oil and gas extraction and services",
  },
  { from: 1400, to: 1499, sector: "Materials", note: "Nonmetallic mining" },
  {
    from: 1520,
    to: 1539,
    sector: "Consumer Discretionary",
    note: "Residential building and operative builders",
  },
  {
    from: 1500,
    to: 1799,
    sector: "Industrials",
    note: "Other construction and specialty trades",
  },
  {
    from: 2000,
    to: 2199,
    sector: "Consumer Staples",
    note: "Food, beverages and tobacco",
  },
  {
    from: 2200,
    to: 2399,
    sector: "Consumer Discretionary",
    note: "Textiles and apparel",
  },
  {
    from: 2400,
    to: 2499,
    sector: "Materials",
    note: "Lumber and wood products",
  },
  {
    from: 2500,
    to: 2599,
    sector: "Consumer Discretionary",
    note: "Furniture and household furnishings",
  },
  {
    from: 2600,
    to: 2699,
    sector: "Materials",
    note: "Paper and allied products",
  },
  {
    from: 2700,
    to: 2799,
    sector: "Industrials",
    note: "Printing and publishing services",
  },
  {
    from: 2830,
    to: 2839,
    sector: "Health Care",
    note: "Drugs and biological products",
  },
  {
    from: 2800,
    to: 2899,
    sector: "Materials",
    note: "Other chemicals and allied products",
  },
  {
    from: 2900,
    to: 2999,
    sector: "Energy",
    note: "Petroleum refining and related products",
  },
  {
    from: 3010,
    to: 3019,
    sector: "Consumer Discretionary",
    note: "Tires and inner tubes",
  },
  {
    from: 3000,
    to: 3099,
    sector: "Materials",
    note: "Other rubber and plastics",
  },
  {
    from: 3100,
    to: 3199,
    sector: "Consumer Discretionary",
    note: "Leather and footwear",
  },
  {
    from: 3200,
    to: 3399,
    sector: "Materials",
    note: "Glass, cement and primary or fabricated metals",
  },
  {
    from: 3400,
    to: 3599,
    sector: "Industrials",
    note: "Fabricated products and industrial machinery",
  },
  {
    from: 3600,
    to: 3699,
    sector: "Information Technology",
    note: "Electronic and electrical equipment",
  },
  {
    from: 3710,
    to: 3719,
    sector: "Consumer Discretionary",
    note: "Motor vehicles and passenger-car bodies",
  },
  {
    from: 3700,
    to: 3799,
    sector: "Industrials",
    note: "Aerospace and other transportation equipment",
  },
  {
    from: 3820,
    to: 3849,
    sector: "Health Care",
    note: "Laboratory, measuring and medical instruments",
  },
  {
    from: 3800,
    to: 3899,
    sector: "Industrials",
    note: "Other measuring and controlling instruments",
  },
  {
    from: 3900,
    to: 3999,
    sector: "Consumer Discretionary",
    note: "Miscellaneous manufactured consumer products",
  },
  {
    from: 4000,
    to: 4799,
    sector: "Industrials",
    note: "Transportation and transportation services",
  },
  {
    from: 4800,
    to: 4899,
    sector: "Communication Services",
    note: "Communications",
  },
  {
    from: 4900,
    to: 4999,
    sector: "Utilities",
    note: "Electric, gas, water and sanitary utilities",
  },
  {
    from: 5000,
    to: 5199,
    sector: "Industrials",
    note: "Wholesale distribution",
  },
  { from: 5400, to: 5499, sector: "Consumer Staples", note: "Food stores" },
  {
    from: 5910,
    to: 5919,
    sector: "Consumer Staples",
    note: "Drug and proprietary stores",
  },
  {
    from: 5200,
    to: 5999,
    sector: "Consumer Discretionary",
    note: "Other retail, home improvement, vehicles and restaurants",
  },
  {
    from: 2710,
    to: 2739,
    sector: "Communication Services",
    note: "Newspapers, periodicals and book publishing",
  },
  {
    from: 3570,
    to: 3579,
    sector: "Information Technology",
    note: "Computers and office machines",
  },
  {
    from: 4922,
    to: 4922,
    sector: "Energy",
    note: "Natural-gas transmission pipelines",
  },
  {
    from: 5040,
    to: 5049,
    sector: "Information Technology",
    note: "Computer and software wholesale distribution",
  },
  {
    from: 5060,
    to: 5069,
    sector: "Information Technology",
    note: "Electronic parts and equipment distribution",
  },
  {
    from: 6500,
    to: 6599,
    sector: "Real Estate",
    note: "Real-estate operators, lessors and developers",
  },
  {
    from: 6798,
    to: 6798,
    sector: "Real Estate",
    note: "Real-estate investment trusts",
  },
  {
    from: 7310,
    to: 7319,
    sector: "Communication Services",
    note: "Advertising and related services",
  },
  {
    from: 8731,
    to: 8731,
    sector: "Health Care",
    note: "Commercial physical and biological research",
  },
  {
    from: 6000,
    to: 6799,
    sector: "Financials",
    note: "Finance, insurance and real-estate investment vehicles",
  },
  {
    from: 7000,
    to: 7099,
    sector: "Consumer Discretionary",
    note: "Hotels and lodging",
  },
  {
    from: 7200,
    to: 7299,
    sector: "Consumer Discretionary",
    note: "Personal services",
  },
  {
    from: 7370,
    to: 7379,
    sector: "Information Technology",
    note: "Software, data processing and computer services",
  },
  {
    from: 7300,
    to: 7399,
    sector: "Industrials",
    note: "Other business services",
  },
  {
    from: 7500,
    to: 7799,
    sector: "Consumer Discretionary",
    note: "Auto services, repair and recreation services",
  },
  {
    from: 7800,
    to: 7899,
    sector: "Communication Services",
    note: "Motion pictures and media",
  },
  {
    from: 7900,
    to: 7999,
    sector: "Consumer Discretionary",
    note: "Entertainment and recreation",
  },
  { from: 8000, to: 8099, sector: "Health Care", note: "Health services" },
  { from: 8100, to: 8199, sector: "Industrials", note: "Legal services" },
  {
    from: 8200,
    to: 8699,
    sector: "Consumer Discretionary",
    note: "Education, social and membership services",
  },
  {
    from: 8700,
    to: 8999,
    sector: "Industrials",
    note: "Engineering, accounting, research and professional services",
  },
];

/** Map a numeric SIC using the most specific declared range; unknown codes stay null. */
export function sectorFromSic(
  sic: string | number | null | undefined
): GicsSector | null {
  const value = Number(sic);
  if (!Number.isInteger(value) || value < 0) return null;
  return (
    SIC_SECTOR_RULES.filter(
      rule => value >= rule.from && value <= rule.to
    ).sort((a, b) => a.to - a.from - (b.to - b.from))[0]?.sector ?? null
  );
}

export interface SectorValidationRow {
  cik: number;
  sic: string | null;
  registrySector: string | null;
}

export function validateSectorMap(rows: SectorValidationRow[]) {
  const confusion: Record<string, Record<string, number>> = {};
  let evaluated = 0;
  let agreements = 0;
  let unmapped = 0;
  let missingRegistrySector = 0;
  for (const row of rows) {
    const mapped = sectorFromSic(row.sic);
    if (!mapped) {
      unmapped++;
      continue;
    }
    if (!row.registrySector) {
      missingRegistrySector++;
      continue;
    }
    evaluated++;
    const expected = row.registrySector;
    confusion[expected] ??= {};
    confusion[expected][mapped] = (confusion[expected][mapped] ?? 0) + 1;
    if (mapped === expected) agreements++;
  }
  return {
    population: rows.length,
    evaluated,
    agreements,
    agreementShare: evaluated ? agreements / evaluated : null,
    unmapped,
    missingRegistrySector,
    confusion,
  };
}
