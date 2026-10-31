import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync("worker/home-server-install.ps1", "utf8");
const hidden = readFileSync("worker/home-server-hidden.vbs", "utf8");

describe("hidden production server installer", () => {
  it("requires a built server and creates one ONLOGON task", () => {
    expect(script).toContain('Test-Path (Join-Path $Root "dist\\boot.js")');
    expect(script).toContain('schtasks /Create /TN "AlphaEngine-Home-Server" /SC ONLOGON');
    expect(script).not.toContain('schtasks /Create /TN "AlphaEngine-Operations-Scheduler"');
  });

  it("starts production hidden with a log and does not add dev mode to startup", () => {
    expect(hidden).toContain("set NODE_ENV=production&& node dist\\boot.js");
    expect(hidden).toContain("home-server.log");
    expect(hidden).toContain(", 0, False");
    expect(hidden).not.toContain("npm run dev");
  });
});
