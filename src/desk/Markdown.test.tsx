import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./Markdown";

describe("desk Markdown", () => {
  it("renders document blocks and safe links without raw HTML", () => {
    const html = renderToStaticMarkup(<Markdown content={"## Heading\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n- **bold**\n- [source](https://www.sec.gov/)\n\n```ts\nconst x = 1;\n```\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))"} />);
    expect(html).toContain("<h2>Heading</h2>");
    expect(html).toContain("<table");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("href=\"https://www.sec.gov/\"");
    expect(html).toContain("language-ts");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("javascript:alert");
  });
});
