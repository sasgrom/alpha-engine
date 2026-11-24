// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { mountDesk, waitUntil, type MountedDesk } from "../desk-test-harness";
import { cronPreview, chainOf, followersOf } from "../operations/console-data";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let desk: MountedDesk | null = null;
afterEach(() => {
  desk?.unmount();
  desk = null;
});

const text = () => desk!.host.textContent ?? "";
const button = (label: string, within: ParentNode = document.body) => [...within.querySelectorAll("button")].find((item) => item.textContent?.trim() === label) as HTMLButtonElement | undefined;
const click = async (element: Element | undefined | null) => {
  expect(element).toBeTruthy();
  await act(async () => { (element as HTMLElement).click(); });
};
// the row whose own first cell names the job (other rows mention it as the job they follow)
const rowOf = (name: string) => [...desk!.host.querySelectorAll("tbody tr")].find((row) => (row.querySelector("td .desk-ops-toggle span, td > span")?.textContent ?? "") === name) as HTMLTableRowElement;
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

describe("the schedule and chain rules of the console", () => {
  it("previews the next runs of a schedule, of several schedules, and names what is wrong with a bad one", () => {
    const from = new Date("2026-11-12T12:00:00");
    expect(cronPreview("45 16 * * 1-5", from).runs.map((date) => `${date.getDate()} ${date.getHours()}:${date.getMinutes()}`)).toEqual(["12 16:45", "13 16:45", "16 16:45"]);
    // the earliest of either expression, in order
    expect(cronPreview("45 16 * * 1-5; 0 4 * * *", from).runs.map((date) => `${date.getDate()} ${date.getHours()}:${date.getMinutes()}`)).toEqual(["12 16:45", "13 4:0", "13 16:45"]);
    expect(cronPreview("every day at four", from)).toMatchObject({ runs: [] });
    expect(cronPreview("every day at four", from).error).toBeTruthy();
    expect(cronPreview("  ", from).error).toContain("Enter a schedule");
  });

  it("lists what a run starts first and what follows it, from the registry", () => {
    expect(chainOf("schwab-snapshot").map((job) => job.id)).toEqual(["schwab-fetch-daily", "schwab-snapshot"]);
    expect(followersOf("schwab-fetch-daily").map((job) => job.id)).toContain("schwab-snapshot");
    expect(chainOf("no-such-job")).toEqual([]);
  });
});

describe("the operations console, for the owner", () => {
  it("keeps the health view as its first tab and offers the others", async () => {
    desk = await mountDesk("admin", "/desk/operations", "Data health");
    expect([...desk.host.querySelectorAll(".desk-tabs [role=tab]")].map((tab) => tab.textContent?.trim())).toEqual(["Health", "Jobs", "Runs", "Coverage", "Reference"]);
    expect(text()).toContain("Checks");
    expect(desk.host.querySelector('a[href="/workers"]')).toBeNull();
  });

  it("lists the scheduled jobs with the failed one first, and shows what a job is for on demand", async () => {
    desk = await mountDesk("admin", "/desk/operations?tab=jobs", "Needs a look");
    const failed = rowOf("Companyfacts local snapshot");
    expect(failed.textContent).toContain("error");
    expect(failed.textContent).toContain("The local web server on port 3000 did not answer");
    // a job switched off in the scheduler's own file is not among the scheduled ones
    expect(text()).not.toContain("Stocktwits hourly pulse");
    // a job that follows another says so; a root shows its schedule
    expect(rowOf("Schwab normalized UI snapshot").textContent).toContain("After Schwab REST daily snapshot");
    expect(rowOf("Schwab REST daily snapshot").textContent).toContain("45 16 * * 1-5; 0 4 * * *");
    await click(button("Schwab REST daily snapshot", desk.host) ?? rowOf("Schwab REST daily snapshot").querySelector("button"));
    await waitUntil(() => text().includes("What it is for"));
    expect(text()).toContain("Then follow");
    expect(text()).toContain("npx tsx worker/schwab-fetch.mts");
  });

  it("asks before a run, says what runs first and what follows, and reports the scheduler's answer", async () => {
    desk = await mountDesk("admin", "/desk/operations?tab=jobs", "Needs a look");
    await click(button("Run", rowOf("Schwab normalized UI snapshot")));
    const dialog = document.querySelector("[role=dialog]")!;
    expect(dialog.textContent).toContain("It runs, in this order: Schwab REST daily snapshot → Schwab normalized UI snapshot.");
    expect(dialog.textContent).toContain("never sends anything to production");
    expect(desk.calls).not.toContain("workersLocal.runOperation");
    await click(button("Run it", dialog));
    await waitUntil(() => text().includes("Queued: schwab-fetch-daily → schwab-snapshot"));
    expect(desk.calls).toContain("workersLocal.runOperation");
  });

  it("asks before stopping the running job, and saves a switch at once", async () => {
    desk = await mountDesk("admin", "/desk/operations?tab=jobs", "Needs a look");
    const running = rowOf("EDGAR filing cache refresh");
    expect(running.textContent).toContain("running");
    await click(button("Stop", running));
    expect(document.querySelector("[role=dialog]")!.textContent).toContain("The scheduler ends the running process");
    await click(button("Stop it", document.querySelector("[role=dialog]")!));
    await waitUntil(() => desk!.calls.includes("workersLocal.killOperation"));
    await click(rowOf("Schwab REST daily snapshot").querySelector("input[type=checkbox]"));
    await waitUntil(() => desk!.calls.includes("workersLocal.setOperation"));
    await waitUntil(() => text().includes("Saved. The scheduler reads it at its next tick."));
  });

  it("shows the next runs of an edited schedule before it can be saved, and refuses a bad one", async () => {
    desk = await mountDesk("admin", "/desk/operations?tab=jobs", "Needs a look");
    await click(rowOf("Schwab REST daily snapshot").querySelector("button"));
    await waitUntil(() => !!desk!.host.querySelector("#cron-schwab-fetch-daily"));
    const input = desk.host.querySelector("#cron-schwab-fetch-daily") as HTMLInputElement;
    expect(button("Save schedule", desk.host)!.disabled).toBe(true);
    await type(input, "0 5 * * 1-5");
    expect(text()).toContain("Next runs:");
    expect(button("Save schedule", desk.host)!.disabled).toBe(false);
    await type(input, "five o'clock");
    expect(text()).toContain("Not a valid schedule");
    expect(button("Save schedule", desk.host)!.disabled).toBe(true);
  });

  it("shows what runs now, what waits, and follows a job's log", async () => {
    desk = await mountDesk("admin", "/desk/operations?tab=runs", "Last run of each job");
    expect(text()).toContain("EDGAR filing cache refresh");
    expect(text()).toContain("Waiting, in this order: Complete EX-99 expectations cache");
    await click(button("Follow the log", desk.host));
    await waitUntil(() => text().includes("[edgar] 412 of 503 companies"));
    expect(text()).toContain("Following the running job");
    await click(button("Failed", desk.host));
    expect(rowOf("Companyfacts local snapshot").textContent).toContain("exit 1");
    expect(text()).not.toContain("Schwab normalized UI snapshot");
  });

  it("shows the coverage report with the gaps first and says when it is old", async () => {
    desk = await mountDesk("admin", "/desk/operations?tab=coverage", "The app's tables");
    expect([...desk.host.querySelectorAll("tbody tr")].map((row) => row.querySelector("td")?.textContent)).toEqual(["option_chains", "signals", "companies"]);
    expect(text()).toContain("Tables found2 / 3");
    expect(text()).toContain("days old");
  });

  it("draws what follows what from the registry", async () => {
    desk = await mountDesk("admin", "/desk/operations?tab=reference", "What follows what");
    expect(text()).toContain("One job at a time.");
    const branch = [...desk.host.querySelectorAll(".desk-ops-flow li")].find((item) => item.querySelector(".desk-ops-flow-row")?.textContent?.startsWith("Schwab REST daily snapshot"))!;
    expect(branch.textContent).toContain("Schwab normalized UI snapshot");
    expect(text()).toContain("GDELT collector and backfill");
  });
});

describe("the classic operations page", () => {
  it("sends the owner to the console's jobs", async () => {
    desk = await mountDesk("admin", "/workers", "Needs a look", true);
    expect(desk.host.querySelector(".desk-tabs [aria-selected=true]")?.textContent?.trim()).toBe("Jobs");
  });
});
