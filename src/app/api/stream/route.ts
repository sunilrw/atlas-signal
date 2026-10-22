import { createHash } from "node:crypto";
import { apiResponse, applyEventFilters, parseEventFilters, parseMode } from "@/lib/server/api";
import { getEvents } from "@/lib/server/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const mode = parseMode(params);
    const filters = parseEventFilters(params);
    const encoder = new TextEncoder();
    let closeConnection = () => {};

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        let pending = false;
        let lastFingerprint = "";
        const timers: {
          poll?: ReturnType<typeof setInterval>;
          heartbeat?: ReturnType<typeof setInterval>;
          lifetime?: ReturnType<typeof setTimeout>;
        } = {};

        const close = () => {
          if (closed) return;
          closed = true;
          clearInterval(timers.poll);
          clearInterval(timers.heartbeat);
          clearTimeout(timers.lifetime);
          request.signal.removeEventListener("abort", close);
          try {
            controller.close();
          } catch {
            // A cancelled reader has already closed its controller.
          }
        };
        closeConnection = close;

        const send = (message: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(message));
          } catch {
            close();
          }
        };

        const refresh = async () => {
          if (closed || pending) return;
          pending = true;
          try {
            // getEvents shares the 60-second feed cache; stream ticks do not force upstream fetches.
            const response = applyEventFilters(await getEvents(mode), filters);
            const fingerprint = createHash("sha256").update(JSON.stringify({
              mode: response.mode,
              updatedAt: response.updatedAt,
              events: response.events,
              total: response.total,
              sources: response.sources,
              warnings: response.warnings,
            })).digest("hex");
            // A moving reference clock alone is not a data change. Heartbeats keep quiet feeds alive.
            if (fingerprint !== lastFingerprint) {
              lastFingerprint = fingerprint;
              send(`event: events\ndata: ${JSON.stringify(response)}\n\n`);
            }
          } catch {
            send('event: error\ndata: {"error":"The event stream is temporarily unavailable."}\n\n');
            close();
          } finally {
            pending = false;
          }
        };

        request.signal.addEventListener("abort", close, { once: true });
        if (request.signal.aborted) {
          close();
          return;
        }

        send("retry: 3000\n\n");
        void refresh();
        timers.poll = setInterval(() => { void refresh(); }, 15_000);
        timers.heartbeat = setInterval(() => { send(": heartbeat\n\n"); }, 20_000);
        // End before the platform limit. Native EventSource reconnection obtains a fresh snapshot.
        timers.lifetime = setTimeout(close, 55_000);
      },
      cancel() {
        closeConnection();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "private, no-store, no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiResponse(async () => { throw error; });
  }
}
