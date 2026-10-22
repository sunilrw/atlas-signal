import { apiResponse, applyEventFilters, parseEventFilters, parseMode } from "@/lib/server/api";
import { getEvents } from "@/lib/server/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return apiResponse(async () => {
    const params = new URL(request.url).searchParams;
    const mode = parseMode(params);
    const filters = parseEventFilters(params);
    const response = applyEventFilters(await getEvents(mode), filters);
    const updates = response.events.flatMap((event) =>
      event.timeline.map((update) => ({
        ...update,
        eventId: event.id,
        eventTitle: event.title,
        isDemo: event.isDemo,
      })),
    ).sort((a, b) =>
      Date.parse(a.timestamp) - Date.parse(b.timestamp)
      || a.eventId.localeCompare(b.eventId)
      || a.id.localeCompare(b.id),
    );
    return { ...response, updates };
  });
}
