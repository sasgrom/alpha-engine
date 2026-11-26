import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createSharedSecPace } from "./sec-shared-pace";

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sec-shared-pace-"));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("shared SEC pacing", () => {
  it("allocates monotonic slots and honors the machine budget", async () => {
    let now = 1000;
    const waits: number[] = [];
    const pace = createSharedSecPace({
      root: temp(),
      budget: 8,
      now: () => now,
      sleep: async ms => {
        waits.push(ms);
        now += ms;
      },
      telemetry: false,
    });
    await pace.schedule();
    await pace.schedule();
    expect(waits).toEqual([126]);
    pace.close();
  });

  it("takes over a stale lock", async () => {
    const root = temp();
    mkdirSync(path.join(root, "lock"), { recursive: true });
    utimesSync(path.join(root, "lock"), new Date(0), new Date(0));
    const pace = createSharedSecPace({ root, telemetry: false });
    await pace.schedule();
    expect(pace.telemetry().fallbacks).toBe(0);
    pace.close();
  });

  it("falls back to two requests a second and logs once when the lock cannot work", async () => {
    const root = temp();
    writeFileSync(path.join(root, "lock"), "not a directory");
    const waits: number[] = [];
    const logs: string[] = [];
    let now = 1000;
    const pace = createSharedSecPace({
      root,
      now: () => now,
      sleep: async ms => {
        waits.push(ms);
        now += ms;
      },
      lockTimeoutMs: 0,
      retryDelayMs: 1,
      log: line => logs.push(line),
      telemetry: false,
    });
    await pace.schedule();
    await pace.schedule();
    expect(pace.telemetry().fallbacks).toBe(2);
    expect(logs).toHaveLength(1);
    expect(waits.at(-1)).toBe(500);
    pace.close();
  });

  it("shares a rate-limit cool-down with another process", async () => {
    const root = temp();
    let now = 1000;
    const first = createSharedSecPace({
      root,
      now: () => now,
      telemetry: false,
    });
    await first.recordResponse(429, "", 0);
    const second = createSharedSecPace({
      root,
      now: () => now,
      sleep: async () => {},
      telemetry: false,
    });
    await second.schedule();
    expect(second.telemetry().totalWaitMs).toBe(600000);
    first.close();
    second.close();
  });

  it("allocates at most eight slots per one-second window to two and three real child processes", async () => {
    for (const childCount of [2, 3]) {
      const root = temp();
      let hits = 0;
      const server: Server = createServer((_, response) => {
        hits++;
        response.end("ok");
      });
      await new Promise<void>(resolve =>
        server.listen(0, "127.0.0.1", resolve)
      );
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("No test server port");
      const url = `http://127.0.0.1:${address.port}`;
      const moduleUrl = pathToFileURL(
        path.resolve("worker/lib/sec-shared-pace.ts")
      ).href;
      const children = Array.from({ length: childCount }, (_, index) => {
        const script = path.join(root, `child-${index}.mts`);
        const slotsFile = path.join(root, `slots-${index}.jsonl`);
        writeFileSync(
          script,
          `import { appendFileSync } from "node:fs";\nimport { createSharedSecPace } from ${JSON.stringify(moduleUrl)};\nconst pace=createSharedSecPace({root:${JSON.stringify(root)},budget:8,job:"child-${index}",telemetry:false});\nconst end=Date.now()+5000;\nwhile(Date.now()<end){const slot=await pace.schedule();appendFileSync(${JSON.stringify(slotsFile)},slot+"\\n");const r=await fetch(${JSON.stringify(url)});await r.text();await pace.recordResponse(r.status);}\npace.close();\n`
        );
        return spawn(process.execPath, ["--import", "tsx", script], {
          cwd: process.cwd(),
          stdio: "pipe",
        });
      });
      await Promise.all(
        children.map(
          child =>
            new Promise<void>((resolve, reject) => {
              let error = "";
              child.stderr.on("data", chunk => {
                error += String(chunk);
              });
              child.once("error", reject);
              child.once("exit", code =>
                code === 0
                  ? resolve()
                  : reject(new Error(`Child exited ${code}: ${error}`))
              );
            })
        )
      );
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      const windows = new Map<number, number>();
      for (let index = 0; index < childCount; index++) {
        const slots = readFileSync(
          path.join(root, `slots-${index}.jsonl`),
          "utf8"
        ).trim().split("\n").map(Number);
        for (const slot of slots) {
          const second = Math.floor(slot / 1000);
          windows.set(second, (windows.get(second) ?? 0) + 1);
        }
      }
      expect(hits).toBeGreaterThan(childCount * 10);
      expect(Math.max(...windows.values())).toBeLessThanOrEqual(8);
    }
  }, 60_000);
});
