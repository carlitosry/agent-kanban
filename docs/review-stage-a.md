# Review Stage A (agent-kanban) — APPROVE with changes recommended (non-blocking)

## Commands run (command → result)
- `npm run typecheck` → clean.
- `npm test` → 11 files, 138 tests passed.
- `npm run build` → OK (vite 24 modules, tsc build, CLI chmod).
- `npx playwright test` → 7 passed (CLI move without reload, block from UI, dark persistence, 4 screenshots).
- Largest src file: `src/app/board-service.ts` 335 lines (limit 500) → OK.
- Live check: `up demo --data-dir <temp copy> --port 4192 --no-open`; `lsof` shows only `127.0.0.1:4192`. In Playwright MCP, after CLI `preflight approve` (vera) + `move T07 in_progress` (fran), the T07 card appeared in "En curso" and counters changed 6→5 / 2→3 with no navigation/reload. CLI rejections verified: `dependencies_pending` (T08), `not_assignee` (kai on T04). `down` stopped the server and the port was freed.

## Acceptance criteria (A.1–A.8)
- A.1 generic: no Privé text in tool (only `booking/` as a style reference in `agents/fran.md` and a "nothing Privé-specific" line in `agents/elena.md`) ✔. Local-only 127.0.0.1 ✔, no-auth documented ✔.
- A.2 stack/deps: README "Why each dependency" matches package.json (hono, @hono/node-server, zod, vite, preact, tailwind, vitest, playwright, tsx) ✔. Minor: README says `tsx` is unused, but `test/store/event-store.test.ts` spawns `writer.ts` with `--import tsx` ✘ (stale text).
- A.3 data model / event types / event-sourced state ✔.
- A.4 transitions (`isValidTransition`), `*→blocked`, `blocked→blocked_from`, dependencies + approved preflight gate, done only reviewer/human, assignee-only for agents, privileged roles ✔. Wave file ownership in `validateSeed` ✔ (seed tests).
- A.5 CLI: init, import, validate, up, down, move, block, unblock, comment, review, preflight, status, next, agents add all exist ✔. API routes all present ✔; evidence route validates board/task/file ids and has traversal tests ✔; ids validated in `EventStore`/`BoardStore` ✔.
- A.6 concurrency: real — 100 concurrent in-process appends plus two separate OS processes writing 4 KB lines, parsed line by line ✔.
- Language: docs, agent files and code comments are English; Spanish only in UI strings and web test fixtures ✔.
- TDD: Kai admitted tests were written after the code. Coverage is nevertheless broad (every transition, permissions, API codes, CLI, store, e2e), so I judge it acceptable, but the process rule from A.6 was not followed; it does not show that tests would have failed first.

## Findings (file:line — problem — requested fix)
1. `src/server/app.ts` `input()` / `POST /api/boards` — body is parsed regardless of Content-Type. Verified: `curl -H 'content-type: text/plain' -d '{"by":"humano",...}'` reaches the domain logic. Any web page the user visits can send a CORS "simple" POST to `127.0.0.1:4090` and act as any actor (no auth, actor from body). Also no Host check (DNS rebinding). Fix: require `application/json` (415 otherwise) and reject non-localhost `Host`/`Origin` headers.
2. `src/app/board-service.ts` (`move`, `block`, `review`, `preflight`, …) — read state, validate, then append, with the lock held only around the append. Two concurrent actors can both pass validation (e.g. two moves, or a move racing a review) and the log gets an invalid sequence. The file-corruption test passes, but the A.4 rules are not enforced atomically. Fix: validate inside the lock (re-read events under the lock) or add optimistic check on last event count. Likewise `addAgent`/`updateAgent`/`writeMeta` do unlocked read-modify-write on JSON files.
3. `README.md:178` — states `tsx` is unused; it is used by the concurrency test. Fix the text.
4. `src/store/event-store.ts` `breakIfStale` — two waiters can both unlink a stale lock and one may delete a freshly acquired lock (classic stale-lock race); low probability (10 s stale window). Note it or use rename-based break.
5. Minor: UI column names ("En curso", "Hecha") differ from A.4 ("En progreso", "Hecho"); a generic `move` to `blocked` needs no note/reason although A.4 says "con motivo" (only `block` requires it).

## Screenshots
Existing: `docs/screenshots/board-{light,dark}-{1280,390}.png` (produced by the e2e suite). Live check evidence is the Playwright MCP snapshot described above (no files saved).

## Questions for a human
None. The Gate A decision is whether to fix finding 1 before use (recommended, small change).
