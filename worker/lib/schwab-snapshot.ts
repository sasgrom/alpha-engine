export function schwabSnapshotId(capturedAt: string): string {
  if (!Number.isFinite(Date.parse(capturedAt))) throw new Error("Invalid Schwab snapshot timestamp");
  return capturedAt.replaceAll(":", "-").replaceAll(".", "-");
}

export function schwabChainFile(today: string, ticker: string, capturedAt: string, force: boolean): string {
  return force ? `chains/${today}/${ticker}/${schwabSnapshotId(capturedAt)}.json` : `chains/${today}/${ticker}.json`;
}

export function schwabQuoteFile(today: string, ticker: string, capturedAt: string, force: boolean): string {
  return force ? `quotes/${today}/${ticker}/${schwabSnapshotId(capturedAt)}.json` : `quotes/${today}/${ticker}.json`;
}

export function schwabChunkDirectory(today: string, ticker: string, capturedAt: string, force: boolean): string {
  return force ? `chains/${today}/chunks/${ticker}/${schwabSnapshotId(capturedAt)}` : `chains/${today}/chunks/${ticker}`;
}

export function schwabChunkDirectoryFromFile(today: string, ticker: string, file: string): string {
  const name = file.split("/").pop() ?? "";
  const snapshotId = name.endsWith(".json") ? name.slice(0, -5) : "";
  return snapshotId && snapshotId !== ticker ? `chains/${today}/chunks/${ticker}/${snapshotId}` : `chains/${today}/chunks/${ticker}`;
}
