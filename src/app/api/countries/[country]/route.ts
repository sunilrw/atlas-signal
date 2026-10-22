import { apiResponse, applyEventFilters, parseEventFilters, parseMode } from "@/lib/server/api";
import { getEvents } from "@/lib/server/service";
import { countryByIdentifier, normalized, withEvents } from "../../_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ country: string }> },
): Promise<Response> {
  return apiResponse(async () => {
    const params = new URL(request.url).searchParams;
    const mode = parseMode(params);
    const filters = parseEventFilters(params);
    const country = countryByIdentifier((await context.params).country);
    const response = applyEventFilters(await getEvents(mode), filters);
    const events = response.events.filter((event) =>
      event.countryCode.toUpperCase() === country.code
      || normalized(event.country) === normalized(country.name),
    );
    return { ...withEvents(response, events), country };
  });
}
