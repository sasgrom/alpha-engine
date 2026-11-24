# K25 — The volatility handbook and the factor wiki as documents in the desk Library

**Owner:** 2026-11-23, "lets do the complete move one by one, you choose the style and if you can improve
functionality and ui". **Author:** Claude. **Coder:** Kimi. **LLM use:** none.
**Plan:** `docs/desk/UI_MIGRATION.md` sections 2 and 7 (Methodology and Wiki: "keep as a document").

## 1. What to build

Two reading pages in the desk, reached from `/desk/research/library`, in the look of the owner's manuals
(`src/desk/admin/Manuals.tsx` with `src/desk/Markdown.tsx`):

1. **Handbooks → the volatility handbook** (`/desk/research/library/volatility-handbook`): the content of the classic
   `src/pages/Methodology.tsx` (notation, expected move, the paired tests and their tables). Formulas are rendered,
   not shown as raw `\(P_t\)`: use the KaTeX the project already has if it has one, otherwise a small renderer for the
   handful of expressions the page uses. Do not add a dependency without asking Claude through the mailbox.
   Audience: the owner and NDA-accepted reviewers, as the classic page (`PresentationOnly`).
2. **Factors → the factor wiki** (`/desk/research/library/factors`): the entries of the classic `src/pages/Wiki.tsx`
   (`api/services/factor-meta.ts`, `FACTOR_META`), searchable, with a link to each entry (`#<factor>`). Audience:
   every signed-in member, as the classic page.
   - Each entry carries one plain sentence under its title: "A description of the reading. No signal is claimed: see
     Signals for what has been measured." with a link to `/desk/research`.

Then:
- `src/desk/destinations.ts` and `src/desk/pages/research/Library.tsx`: the two cards open the desk pages ("Open in
  desk"), no longer the classic ones.
- `src/App.tsx`: `/analytics/methodology` and `/wiki` redirect to the desk pages (keep their guards).
- The classic `Methodology.tsx`, `Methodology.test.tsx` and `Wiki.tsx` are removed once nothing imports them; list
  what you checked.
- `DevNotes` for both pages (`src/desk/devnotes-data.ts`): what is missing, what could be better.

## 2. Boundaries

- **Do not touch** (Claude is working in them): `src/desk/pages/Operations.tsx`, `src/desk/operations/**`,
  `src/desk/pages/research/Ownership.tsx`, `src/desk/evidence.ts`, `worker/lib/**`, `scripts/**`, `contracts/**`,
  `api/**`, `docs/desk/UI_MIGRATION.md`. In `src/App.tsx` change only the two routes named above; in
  `src/desk/DeskApp.tsx` only add the two routes.
- No stage labels, no machine paths, light and dark, phone width; desk tokens only (`src/desk/desk.css`).
- No scheduler or web restart. Commit only your own paths (`git commit -- <paths>`).

## 3. Acceptance

1. Desk tests (jsdom, `src/desk/desk-test-harness.tsx`): each page renders; a formula is rendered and no raw `\(`
   remains in the text; the wiki's search narrows the list; a member opens the wiki and is sent away from the
   handbook; the two classic routes redirect.
2. Gates: `npm run check`, `npm test -- --run --maxWorkers=4`, `npm run build`, `git diff --check`. Send Claude a
   mailbox note before the full test run and the build.
3. One commit with code, tests and a handoff section; fast-forward push when only your commit is ahead.
4. A mailbox message: the commit, what was removed and what was checked before removing it, and both pages described
   in light and dark.
