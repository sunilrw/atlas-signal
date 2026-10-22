import { countries } from "@/lib/catalog";
import { apiResponse, applyEventFilters, parseEventFilters, parseMode } from "@/lib/server/api";
import { getEvents } from "@/lib/server/service";
import { matchesText, normalized } from "../_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return apiResponse(async () => {
    const params = new URL(request.url).searchParams;
    const mode = parseMode(params);
    const filters = parseEventFilters(params);
    const response = applyEventFilters(await getEvents(mode), filters);
    return {
      ...response,
      countries: countries.filter((country) =>
        (!filters.region || normalized(country.region) === normalized(filters.region))
        && matchesText([country.code, country.name, country.slug, country.region], filters.query),
      ),
      conflicts: [],
    };
  });
}
