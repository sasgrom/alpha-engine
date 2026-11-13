import { createElement, Fragment, type ReactNode } from "react";

function inline(text: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const href = link[2];
      if (/^(https?:\/\/|\/|#|mailto:)/i.test(href)) return <a key={index} href={href} target={/^https?:\/\//i.test(href) ? "_blank" : undefined} rel="noreferrer">{link[1]}</a>;
      return <Fragment key={index}>{link[1]}</Fragment>;
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((cell) => cell.trim().replace("\\|", "|"));
}

function isSpecial(lines: string[], index: number): boolean {
  const line = lines[index] ?? "";
  const next = lines[index + 1] ?? "";
  return !line.trim() || /^(```|#{1,6}\s|>\s?|[-*+]\s+|\d+\.\s+|---+\s*$)/.test(line.trim()) || (line.includes("|") && /^\|?[\s:|-]+\|?$/.test(next.trim()) && next.includes("-"));
}

export function Markdown({ content }: { content: string }) {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index++;
      continue;
    }
    if (line.trim().startsWith("```")) {
      const language = line.trim().slice(3).trim();
      const body: string[] = [];
      index++;
      while (index < lines.length && !lines[index].trim().startsWith("```")) body.push(lines[index++]);
      index++;
      blocks.push(<pre key={blocks.length} className="desk-code-block"><code className={language ? `language-${language}` : undefined}>{body.join("\n")}</code></pre>);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push(createElement(`h${heading[1].length}`, { key: blocks.length }, inline(heading[2])));
      index++;
      continue;
    }
    if (line.includes("|") && /^\|?[\s:|-]+\|?$/.test((lines[index + 1] ?? "").trim()) && (lines[index + 1] ?? "").includes("-")) {
      const headers = cells(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) rows.push(cells(lines[index++]));
      blocks.push(
        <div key={blocks.length} className="desk-table-wrap"><table className="desk-table desk-markdown-table"><thead><tr>{headers.map((cell, cellIndex) => <th key={cellIndex}>{inline(cell)}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{headers.map((_, cellIndex) => <td key={cellIndex}>{inline(row[cellIndex] ?? "")}</td>)}</tr>)}</tbody></table></div>,
      );
      continue;
    }
    if (/^---+\s*$/.test(line.trim())) {
      blocks.push(<hr key={blocks.length} />);
      index++;
      continue;
    }
    if (/^>\s?/.test(line.trim())) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) quote.push(lines[index++].trim().replace(/^>\s?/, ""));
      blocks.push(<blockquote key={blocks.length}>{inline(quote.join(" "))}</blockquote>);
      continue;
    }
    if (/^[-*+]\s+/.test(line.trim()) || /^\d+\.\s+/.test(line.trim())) {
      const ordered = /^\d+\.\s+/.test(line.trim());
      const items: string[] = [];
      const pattern = ordered ? /^\d+\.\s+/ : /^[-*+]\s+/;
      while (index < lines.length && pattern.test(lines[index].trim())) items.push(lines[index++].trim().replace(pattern, ""));
      blocks.push(createElement(ordered ? "ol" : "ul", { key: blocks.length }, items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>)));
      continue;
    }
    const paragraph = [line.trim()];
    index++;
    while (index < lines.length && !isSpecial(lines, index)) paragraph.push(lines[index++].trim());
    blocks.push(<p key={blocks.length}>{inline(paragraph.join(" "))}</p>);
  }
  return <article className="desk-markdown">{blocks}</article>;
}
