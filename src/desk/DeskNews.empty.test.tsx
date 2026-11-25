// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";
import { DESK_DATA, mountDesk, type MountedDesk } from "./desk-test-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("desk news before anything is built", () => {
  let desk: MountedDesk | null = null;
  afterEach(() => {
    desk?.unmount();
    desk = null;
    DESK_DATA.empty = false;
  });

  it("says so instead of showing an empty list", async () => {
    DESK_DATA.empty = true;
    desk = await mountDesk("admin", "/desk/news", "No news is built yet");
  });
});
