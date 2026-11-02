import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const key = "abcdefghijklmnopqrstuvwxyz123456";
const execFileAsync = promisify(execFile);
const json = (value: unknown) => JSON.stringify(value);

describe("macro FRED CLI", () => {
  it("completes metadata, vintage probes, yearly chunks, merge and manifest", async () => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      response.setHeader("content-type", "application/json");
      if (url.pathname === "/fred/series") {
        response.end(json({ seriess: [{ id: "DGS10", title: "10Y", frequency: "Daily", units: "Percent", seasonal_adjustment: "NSA", last_updated: "2026-11-01" }] }));
        return;
      }
      if (url.pathname === "/fred/series/vintagedates") {
        const first = url.searchParams.get("limit") === "1";
        response.end(json({ vintage_dates: [first ? "2005-06-28" : url.searchParams.get("realtime_start")] }));
        return;
      }
      if (url.pathname === "/fred/series/observations") {
        response.end(json({ observations: [{ realtime_start: url.searchParams.get("realtime_start"), realtime_end: ".", date: "2020-01-01", value: "4.0" }] }));
        return;
      }
      response.statusCode = 404;
      response.end(json({ error: "not found" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const out = process.platform === "win32"
      ? path.join("D:\\research\\alpha-engine-test", `macro-fred-cli-${process.pid}-${Date.now()}`)
      : mkdtempSync(path.join(tmpdir(), "macro-fred-cli-"));
    try {
      let stdout: string;
      try {
        ({ stdout } = await execFileAsync(process.execPath, [
        path.resolve("node_modules/tsx/dist/cli.mjs"),
        "worker/macro-fred-fetch.mts",
        "--series", "DGS10",
        "--from", "2020-01-01",
        "--out", out,
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 30_000,
        env: {
          ...process.env,
          FRED_API_KEY: key,
          FRED_API_BASE_URL: `http://127.0.0.1:${address.port}/fred`,
          FRED_MIN_INTERVAL_MS: "0",
        },
      }));
      } catch (error) {
        const failure = error as { stdout?: string; stderr?: string };
        console.error("FRED CLI stdout", failure.stdout);
        console.error("FRED CLI stderr", failure.stderr);
        throw error;
      }
      expect(stdout).toContain("errors 0");
      const manifest = JSON.parse(readFileSync(path.join(out, "manifest-fred.json"), "utf8"));
      expect(manifest.entries[0].status).toBe("complete");
      expect(manifest.entries[0].rows).toBeGreaterThan(0);
      const normalized = JSON.parse(readFileSync(path.join(out, "normalized", "fred", "DGS10.json"), "utf8"));
      expect(normalized.length).toBe(manifest.entries[0].rows);
      expect(normalized[0].value).toBe(4);
      expect(normalized[0].supersededAt).toBeNull();
    } finally {
      rmSync(out, { recursive: true, force: true });
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }, 35_000);
});
