// Helper process for the concurrency test: appends N large events to a board log.
import { EventStore } from "../../src/store/event-store.js";

const [dataDir, board, id, count] = process.argv.slice(2) as [string, string, string, string];
const store = new EventStore(dataDir);
for (let i = 0; i < Number(count); i++) {
  await store.append(board, {
    ts: new Date().toISOString(),
    board,
    by: id,
    type: "comment",
    task: "T",
    note: `note ${i} ` + "x".repeat(4000),
  });
}
