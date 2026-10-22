import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getEvents } from "../src/lib/server/service";
import { closeStore } from "../src/lib/server/store";

// Next.js loads these for web routes; the standalone worker must load them itself.
// loadEnvFile preserves values already provided by the host process.
for (const filename of [".env.local", ".env"]) {
  const path = resolve(process.cwd(), filename);
  if (existsSync(path)) process.loadEnvFile(path);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolveDelay) => {
    if (signal.aborted) return resolveDelay();
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolveDelay();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("Atlas Signal live-source ingestion worker\n\nnpm run ingest -- --once\nnpm run ingest\n\nINGEST_INTERVAL_SECONDS: 60–86400 (default 300)\nDATABASE_URL: optional shared PostgreSQL snapshots; otherwise bounded in-memory storage.\nOnly configured providers are fetched. No records are substituted during an outage.");
    return;
  }
  if (args.some((argument) => argument !== "--once")) throw new Error("Unsupported argument. Use --once or --help.");
  const interval = Number(process.env.INGEST_INTERVAL_SECONDS ?? "300");
  if (!Number.isFinite(interval) || interval < 60 || interval > 86_400) {
    throw new Error("INGEST_INTERVAL_SECONDS must be a number between 60 and 86400.");
  }
  const once = args.includes("--once");
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    do {
      const response = await getEvents("live", { force: true });
      const enabled = response.sources.filter((source) => source.status !== "disabled");
      console.log(JSON.stringify({
        checkedAt: response.referenceTime,
        lastSuccessfulFetchAt: response.updatedAt,
        mode: response.mode,
        eventCount: response.total,
        providers: response.sources.map((source) => ({
          id: source.id,
          status: source.status,
          eventCount: source.eventCount,
          lastFetchedAt: source.lastFetchedAt,
        })),
        warnings: response.warnings,
      }));
      if (once) {
        if (!enabled.length || enabled.every((source) => source.status === "error")) process.exitCode = 1;
        break;
      }
      if (!controller.signal.aborted) await delay(interval * 1_000, controller.signal);
    } while (!controller.signal.aborted);
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await closeStore();
  }
}

main().catch((error: unknown) => {
  // Our argument messages are safe; low-level failures are deliberately redacted.
  const safeMessage = error instanceof Error && (
    error.message.startsWith("Unsupported argument.") ||
    error.message.startsWith("INGEST_INTERVAL_SECONDS ")
  ) ? error.message : "Ingestion failed. Check provider configuration and database connectivity.";
  console.error(safeMessage);
  process.exitCode = 1;
});
