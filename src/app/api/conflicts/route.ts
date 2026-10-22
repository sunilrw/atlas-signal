import { apiResponse, applyEventFilters, parseEventFilters, parseMode } from "@/lib/server/api";
import { getEvents } from "@/lib/server/service";
import { LIVE_CONFLICT_NOTICE, withEvents } from "../_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return apiResponse(async () => {
    const params = new URL(request.url).searchParams;
    const mode = parseMode(params);
    const filters = parseEventFilters(params);
    const response = applyEventFilters(await getEvents(mode), filters);
    // Shared countries or keywords are not evidence that reports belong to
    // the same conflict. No source-backed conflict assessment is configured.
    return {
      ...withEvents(response, []),
      conflicts: [],
      warnings: [...response.warnings, LIVE_CONFLICT_NOTICE],
    };
  });
}
