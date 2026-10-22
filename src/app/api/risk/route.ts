import { apiResponse, applyEventFilters, parseEventFilters, parseMode } from "@/lib/server/api";
import { getEvents } from "@/lib/server/service";
import type { AtlasEvent } from "@/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return apiResponse(async () => {
    const params = new URL(request.url).searchParams;
    const mode = parseMode(params);
    const filters = parseEventFilters(params);
    const response = applyEventFilters(await getEvents(mode), filters);
    const groups = new Map<string, AtlasEvent[]>();
    for (const event of response.events) {
      // Unassigned locations remain unassigned; no centroid or country is inferred.
      const key = event.countryCode || "unassigned";
      const group = groups.get(key) ?? [];
      group.push(event);
      groups.set(key, group);
    }
    const regions = [...groups.entries()].map(([countryCode, events]) => ({
      countryCode: countryCode === "unassigned" ? "" : countryCode,
      country: events[0].country || "Unassigned",
      eventCount: events.length,
      eventIds: events.map((event) => event.id),
    })).sort((a, b) => a.country.localeCompare(b.country) || a.countryCode.localeCompare(b.countryCode));
    return {
      ...response,
      regions,
      methodology: {
        label: "Observed source-record counts",
        countDefinition: "The number of normalized source records in the selected snapshot and filters, grouped by their attributed country.",
        limitations: [
          "This legacy endpoint does not calculate a risk score, severity score, confidence level or forecast.",
          "Records can include incident reports, news and analysis. Record counts are not independently verified incident counts.",
          "Coverage depends on enabled providers, publisher selection, reporting availability and the selected filters. No records does not mean no risk.",
          "Reports can refer to the same underlying incident. Publication volume and repeated claims are not independent corroboration.",
          "These counts are not comprehensive country rankings or evidence of underlying country safety or future conflict.",
        ],
      },
    };
  });
}
