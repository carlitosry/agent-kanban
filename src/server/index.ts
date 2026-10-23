import { serve } from "@hono/node-server";
import type { BoardService } from "../app/board-service.js";
import { createApp } from "./app.js";
import { EventsHub } from "./events-hub.js";

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

export interface StartOptions {
  service: BoardService;
  port: number;
  webDir?: string;
}

/** Composition root: wires the app to a node HTTP server bound to 127.0.0.1 only. */
export function startServer(options: StartOptions): Promise<RunningServer> {
  const hub = new EventsHub((id) => options.service.eventsPath(id));
  const app = createApp({
    service: options.service,
    hub,
    ...(options.webDir ? { webDir: options.webDir } : {}),
  });
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port: options.port, hostname: "127.0.0.1" }, (info) => {
      resolve({
        port: info.port,
        close: () =>
          new Promise<void>((done) => {
            hub.close();
            (server as { closeAllConnections?: () => void }).closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
    server.once("error", reject);
  });
}
