# agent-kanban technical contract

Single source of truth between layers. If a layer needs to change this contract, **block the task** and notify the
orchestrator; do not change it on your own.

## 1. Types (`src/core/types.ts`)

```ts
export type TaskState = "todo" | "in_progress" | "in_review" | "done" | "blocked";
export type AgentKind = "agent" | "human";
export type AgentRole = "orchestrator" | "reviewer" | "implementer" | "human";

export interface Agent { id: string; name: string; role: AgentRole | string; color: string; kind: AgentKind }

export interface TaskSeed {
  id: string; title: string; description?: string;
  plan: string; section: string; phase: string; wave: number;
  assignee: string;                // Agent.id
  depends_on: string[]; owns_files: string[];
  acceptance: string[]; verify: string[];
  needs_ui_evidence: boolean;
}

export type EventType =
  | "board_created" | "task_created" | "task_updated" | "assign" | "move"
  | "comment" | "preflight" | "review" | "block" | "unblock";

export interface KanbanEvent {
  ts: string;                      // ISO 8601
  board: string; task?: string; by: string; type: EventType;
  from?: TaskState; to?: TaskState;
  note?: string; evidence?: string[]; question?: string;
  payload?: Record<string, unknown>; // preflight/review: { verdict }; task_created/updated: partial TaskSeed
}

export interface BoardMeta { id: string; title: string; description?: string; created_at: string; plans: string[] }

export interface TaskView extends TaskSeed {
  state: TaskState;
  blocked_from?: TaskState;        // previous state if state === "blocked"
  question?: string;               // open question for a human (raised hand)
  preflight?: { verdict: "approve" | "block"; by: string; note?: string; ts: string };
  review?: { verdict: "approve" | "changes" | "human"; by: string; note?: string; ts: string };
  review_rounds: number;           // number of times the reviewer requested changes
  evidence: string[];              // file names in evidence/<task-id>/
  history: KanbanEvent[];
  ready: boolean;                  // state === "todo" and all depends_on in done
}

export interface BoardState {
  board: BoardMeta; agents: Agent[]; tasks: TaskView[];
  counts: Record<TaskState, number>;
}
```

## 2. Domain rules (`src/core/`, pure, no I/O)

- Valid transitions: `todo→in_progress`, `in_progress→in_review`, `in_review→done`, `in_review→in_progress`,
  `*→blocked` (except from `done`), `blocked→blocked_from`. Anything else: `DomainError("invalid_transition")`.
- `todo→in_progress` requires: all `depends_on` in `done` (`dependencies_pending`) and last `preflight` = `approve`
  (`preflight_required`).
- A `review` event with verdict `approve` leads to `done`; `changes` leads to `in_progress` (increments `review_rounds`);
  `human` leads to `blocked` with `question`.
- A `preflight` with `block` leaves the task in `todo` with `preflight.verdict = "block"`; a new `preflight` replaces it.
- `return` (send back): `in_review→in_progress` can be done by the reviewer, the orchestrator or a human.
- Permissions (`canMove(actor, task, agents)`): the assignee moves their own tasks; `role` `orchestrator`/`reviewer` and
  `kind: "human"` can move any task. Otherwise: `DomainError("not_assignee")`. `done` is only set by the reviewer or a human.
- `validateSeed(tasks, agents)` returns a list of problems (duplicate ids, nonexistent assignee, nonexistent dependency,
  cycles, **two tasks in the same wave with the same file in `owns_files`**, empty fields).
- Effective state = seed (`tasks.json`) + `task_created`/`task_updated` events + remaining events in `ts` order.

## 3. Errors (`DomainError`)

| code | HTTP | when |
|------|------|------|
| `validation_error` | 400 | malformed input (Zod) or invalid seed |
| `not_assignee` | 403 | the actor cannot move that task |
| `not_found` | 404 | board, task or agent does not exist |
| `invalid_transition` | 409 | transition not allowed |
| `dependencies_pending` | 409 | dependencies not `done` |
| `preflight_required` | 409 | approved preflight missing |
| `forbidden_origin` | 403 | server only: `Host` is not `127.0.0.1`/`localhost`, or `Origin` (if present) is not a localhost origin (CSRF / DNS rebinding guard) |

Server guards (all routes): requests with body (`POST`/`PATCH`/`PUT`/`DELETE`) must send `Content-Type: application/json`
(else `415 validation_error`). A missing `Origin` is allowed (CLI, curl, SSE and static `GET`s).

JSON shape of the HTTP error: `{ "error": { "code": string, "message": string } }`.

## 4. Use-case layer (`src/app/board-service.ts`)

Used by the **CLI and the server**; neither one reimplements rules.

```ts
class BoardService {
  constructor(dataDir: string)
  listBoards(): Promise<BoardMeta[]>
  createBoard(input: { id: string; title: string; description?: string; plans?: string[] }): Promise<BoardMeta>
  importSeed(boardId: string, seed: { tasks: TaskSeed[]; agents?: Agent[]; plans?: string[] }): Promise<{ problems: string[] }>
  validate(boardId: string): Promise<string[]>
  getState(boardId: string): Promise<BoardState>
  next(boardId: string): Promise<TaskView[]>            // ready === true
  createTask(boardId: string, by: string, task: TaskSeed): Promise<TaskView>
  updateTask(boardId: string, by: string, taskId: string, patch: Partial<TaskSeed>): Promise<TaskView>
  move(boardId: string, by: string, taskId: string, to: TaskState, note?: string): Promise<TaskView>
  block(boardId: string, by: string, taskId: string, note: string, question?: string): Promise<TaskView>
  unblock(boardId: string, by: string, taskId: string, note?: string): Promise<TaskView>
  comment(boardId: string, by: string, taskId: string, note: string): Promise<TaskView>
  preflight(boardId: string, by: string, taskId: string, verdict: "approve" | "block", note?: string): Promise<TaskView>
  review(boardId: string, by: string, taskId: string, verdict: "approve" | "changes" | "human", note?: string, question?: string): Promise<TaskView>
  addAgent(boardId: string, agent: Agent): Promise<Agent>
  updateAgent(boardId: string, agentId: string, patch: Partial<Agent>): Promise<Agent>
  addEvidence(boardId: string, taskId: string, file: string, data: Buffer): Promise<void>
  statusText(boardId: string): Promise<string>
  eventsPath(boardId: string): string                   // for fs.watch
}
```

`preflight` and `review` can only be recorded by an actor with `role: "reviewer"` or `kind: "human"`.
`unblock` with a human answer adds `note` and clears `question`.

## 5. Storage (`src/store/`)

Folder: `<data-dir>/<board-id>/{board.json,tasks.json,agents.json,events.jsonl,evidence/<task-id>/}`.
`EventStore.append(boardId, event)` uses `appendFile` with file locking (`events.jsonl.lock`, exclusive creation with
retry) so that several processes can write at the same time without corrupting the log. One event per line.
`board_id` and `task id` are validated with `^[A-Za-z0-9][A-Za-z0-9._-]*$` (prevents path traversal).

## 6. HTTP API (`src/server/`, Hono, `127.0.0.1:4090`)

JSON bodies, validated with Zod. The actor travels in the body (`by`) or in the `x-actor` header. Success = **201** for
`POST /api/boards`, `POST .../tasks` and `POST .../agents`; **200** for everything else; error = section 3.
Port: `--port` flag of `up` (default 4090, `0` = free port); there is no `KANBAN_PORT` variable.

| Method and route | Body | Response |
|---|---|---|
| `GET /api/boards` | — | `BoardMeta[]` |
| `POST /api/boards` | `{id,title,description?}` | `BoardMeta` |
| `GET /api/boards/:id` | — | `BoardState` |
| `POST /api/boards/:id/tasks` | `{by, task: TaskSeed}` | `TaskView` |
| `PATCH /api/boards/:id/tasks/:taskId` | `{by, patch}` | `TaskView` |
| `POST .../tasks/:taskId/move` | `{by, to, note?}` | `TaskView` |
| `POST .../tasks/:taskId/block` | `{by, note, question?}` | `TaskView` |
| `POST .../tasks/:taskId/unblock` | `{by, note?}` | `TaskView` |
| `POST .../tasks/:taskId/comment` | `{by, note}` | `TaskView` |
| `POST .../tasks/:taskId/review` | `{by, verdict, note?, question?}` | `TaskView` |
| `POST .../tasks/:taskId/preflight` | `{by, verdict, note?}` | `TaskView` |
| `POST /api/boards/:id/agents` | `Agent` | `Agent` |
| `PATCH /api/boards/:id/agents/:agentId` | `Partial<Agent>` | `Agent` |
| `GET /api/boards/:id/events` | — | SSE: each new event `event: kanban` + `data: <KanbanEvent JSON>`; `event: ping` every 25 s |
| `GET /api/boards/:id/evidence/:taskId/:file` | — | file (image or `.md`) |

The server watches `events.jsonl` with `fs.watch` (including changes made by the CLI) and emits them via SSE.
It serves `dist/web` at `/`. It only listens on `127.0.0.1`.

## 7. CLI (`src/cli/`)

Binary: `dist/cli/index.js` (`bin` in `package.json`; run `npm run build` first).

`agent-kanban <command> [<board>] [args] [--data-dir <dir>] [--by <agent>] [--json]`

- **Data dir**: `--data-dir`, else `KANBAN_DATA_DIR` (alias `AGENT_KANBAN_DATA_DIR`), else `./docs/kanban` (from the cwd).
- **Port**: `up --port`, else `KANBAN_PORT`, else `4090` (`0` = free port).
- **Board**: positional first argument (`status <board>`, `move <board> <task> <state>`, `agents <board> add <id>`,
  `import <board> <tasks.json>`). Fallbacks, for older usage: `--board`, else `AGENT_KANBAN_BOARD`, else the only
  board if there is exactly one; otherwise usage error. For task commands the first argument counts as the board only
  when a board with that id exists.
- **Actor**: `--by`, else `AGENT_KANBAN_BY`; required by commands that write a task.
- Commands: `init <board> --title`, `import <board> <tasks.json>`, `validate <board>`, `status <board>`,
  `next <board>`, `move <board> <task> <state>`, `block <board> <task> --note [--question]`,
  `unblock <board> <task>`, `comment <board> <task> <text...>`, `review <board> <task> <verdict>`,
  `preflight <board> <task> <verdict>`, `agents <board> add <id> --name --role [--color --kind]`,
  `up <board> [--port] [--no-open]`, `down`.
  `import` accepts `{tasks, agents?, plans?}` or a bare array of tasks.
- `up` runs in the foreground (Ctrl+C or `down` stops it), serves every board in the data dir, opens the browser at
  `http://127.0.0.1:<port>/#/<board>` (fails with `not_found` if the board does not exist) and saves the PID in
  `<data-dir>/.agent-kanban.pid`.
- Exit codes: 0 ok, 1 domain error (message on stderr with the `code`; with `--json` the error JSON goes to stdout),
  2 incorrect usage.

## 8. Frontend (`src/web/`)

Preact + Tailwind v4 (`dark` variant via class). Talks only to the API in section 6. To develop without a server it may
use a local `mock`, but the real client lives in `src/web/api/client.ts`.
