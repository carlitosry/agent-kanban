# Method: orchestrating agents with a Kanban board

How to split a body of work into tasks, give them to named agents, review them, and keep a human in the loop.
`agent-kanban` supports the method; the method works with any tool that can record the same events.

## 1. Stages and gates

Work in stages. After each stage the orchestrator **stops and shows evidence**; the next stage starts only on an
explicit OK from the human.

| Stage | Output | Gate evidence |
|---|---|---|
| A. Tooling (only once) | The board tool works | typecheck, tests, build, screenshots |
| B. Plan to board | A validated board for the plans | `validate` output, `status`, list of blocking questions |
| C. Execution | Waves executed one by one | `status` and review summaries at the end of every wave |

If anything is ambiguous or contradicts a document: **stop and ask** (raise a hand) instead of assuming.

## 2. Roles

- **Orchestrator.** Creates the board, launches implementers, respects the wave order and a cap on parallel
  implementers (suggested: 4), integrates shared files, makes the commits (one per repo and wave), reports at the end of
  each wave. Never pushes or deploys without permission. Does not implement product features.
- **Implementers.** Touch **only** their `owns_files`; use an isolated worktree when possible; follow TDD; move their own
  task with the CLI. When moving to `in_review` the note lists files touched, commands run with their result, and
  deviations from the plan. Need another file or a contract change: **block**.
- **Reviewer.** Does not implement. Acts twice (section 4). Records verdicts; writes `review.md`.
- **Human.** Owns production work (real reports, deployments, real configuration) and answers raised hands. Can move
  any task and use "Act as..." in the UI.

## 3. States

| State | Column | Who moves a task there |
|---|---|---|
| `todo` | To do | On creation, or when a task is sent back |
| `in_progress` | In progress | The assignee, **only with an approved preflight** and dependencies done |
| `in_review` | In review | The assignee, when finished, with summary and test output |
| `done` | Done | Only the reviewer or a human |
| `blocked` | Blocked / needs a human | Anyone, with a reason; if a person is needed, with a concrete question |

Valid transitions: `todo -> in_progress -> in_review -> done`; `in_review -> in_progress` (changes requested);
`any -> blocked` (except from `done`); `blocked -> previous state`.

## 4. Preflight and review

1. **Preflight** (before `todo -> in_progress`). The reviewer checks: dependencies are `done`; the task matches its plan
   section; no file conflict with another active task; the plan does not contradict the real code. Records
   `preflight approve` or `preflight block` with detail.
2. **Review** (task in `in_review`). The reviewer runs every `verify` command, reviews the diff against the project's
   engineering rules and, if `needs_ui_evidence` is true, tests the feature in the real app and saves numbered
   screenshots in `evidence/<task-id>/`. Writes `review.md`, then records one verdict:
   - `approve` -> `done`
   - `changes` -> back to `in_progress` with the list of changes (counts a review round)
   - `human` -> `blocked` plus a question

### `review.md` template

```markdown
# Review <task-id> - <title>

Verdict: **approve | changes | human**

## Checks
- `<verify command>`: passed | failed (summary)
- Diff only touches `owns_files`: yes | no (list)
- Engineering rules: ok | issues (list)

## UI evidence (if required)
- 01-<what>.png: <what it shows>

## Changes requested / questions
1. ...

## Deviations from the plan
- none | ...
```

## 5. Raising a hand

Whoever cannot verify or decide something moves the task to `blocked` with a `--question`. The orchestrator relays it
to the human in the chat: concrete, with options and a recommendation. Tasks that depend on it wait; the rest keep
going. The human answers in the chat or in the UI (open the card, write the answer, **Unblock**). The task returns to
its previous state with the answer in its history.

## 6. Converting a plan into a board

1. **One task per deliverable**, small enough for one agent in one sitting and verifiable with commands. A plan section
   that bundles several deliverables becomes several tasks; trivial sections merge into their neighbor.
2. **Ids.** Short and stable (`T01`, `PC-03`...). Only letters, digits, `.`, `_`, `-`. Never reuse an id.
3. **Provenance.** `plan` is the plan file, `section` the heading it comes from, `phase` the plan's own phase grouping.
4. **Waves.** `wave` is a number; a task goes in the earliest wave in which all its `depends_on` are in earlier waves.
   Tasks in one wave can run in parallel.
5. **File owners.** `owns_files` lists every file the task may touch. **Two tasks in the same wave must not own the
   same file**: either split the file's work across waves, add a dependency, or make one task the owner and have the
   others ask for changes. Shared files (routes index, config, README) go to one integration task in a later wave.
6. **Acceptance and verify.** `acceptance` are observable criteria (they show as subtasks in the UI). `verify` are
   commands that prove them. Both are mandatory.
7. **Assignee.** Every task has exactly one agent. Production tasks go to a human.
8. **UI evidence.** `needs_ui_evidence: true` for anything a user sees.
9. **Questions up front.** If a plan is ambiguous, create the task already blocked with a question, or ask at the gate.
10. Run `agent-kanban validate`; fix every problem before the gate.

### Minimal `tasks.json` (seed)

```json
{
  "plans": ["docs/plan.md"],
  "agents": [
    { "id": "atlas", "name": "Atlas", "role": "orchestrator", "color": "#4f46e5", "kind": "agent" },
    { "id": "vera",  "name": "Vera",  "role": "reviewer",     "color": "#be185d", "kind": "agent" },
    { "id": "hugo",  "name": "Hugo",  "role": "implementer",  "color": "#0f766e", "kind": "agent" }
  ],
  "tasks": [
    {
      "id": "T01", "title": "Define the data model", "plan": "docs/plan.md", "section": "1",
      "phase": "Foundation", "wave": 0, "assignee": "hugo", "depends_on": [],
      "owns_files": ["src/core/note.ts", "test/core/note.test.ts"],
      "acceptance": ["Note type has id, title, body", "Empty titles are rejected"],
      "verify": ["npm run typecheck", "npm test"], "needs_ui_evidence": false
    },
    {
      "id": "T02", "title": "Notes list screen", "plan": "docs/plan.md", "section": "2",
      "phase": "Frontend", "wave": 1, "assignee": "hugo", "depends_on": ["T01"],
      "owns_files": ["src/web/NotesList.tsx"],
      "acceptance": ["Lists notes", "Usable at 390 px and 1280 px"],
      "verify": ["npm test"], "needs_ui_evidence": true
    }
  ]
}
```

A complete example (12 tasks, 6 agents): [`examples/demo/seed.json`](../examples/demo/seed.json).

## 7. Daily use

| To... | Do... |
|---|---|
| See the board | `agent-kanban up` |
| Get a text status for the chat | `agent-kanban status` |
| Answer a raised hand | Blocked column, open the card, write the answer, **Unblock** (or answer the orchestrator in the chat) |
| Ask for changes on a task in review | Card, **Request changes** with a note: back to In progress |
| Approve it yourself | Card in review, **Approve** |
| See proof of a feature | Card, screenshots gallery and `review.md` |
| Stop the server | Ctrl+C in its terminal, or `agent-kanban down` |

## 8. Permanent rules

- The project's engineering rules win over the orchestration prompt; flag the conflict.
- Nobody deletes tests without a replacement or disables checks to make them pass.
- Nobody touches production, pushes or deploys without explicit permission.
- If a plan is wrong or outdated against the code, the reviewer documents it and the task is blocked with a question.
  Nobody improvises.
- Report facts: when something fails, say what and show the output.
