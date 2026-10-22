import { ApiInputError, apiResponse, parseMode, validateIdentifier } from "@/lib/server/api";
import { getEvents } from "@/lib/server/service";
import { responseContext } from "../../_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return apiResponse(async () => {
    const mode = parseMode(new URL(request.url).searchParams);
    const id = validateIdentifier((await context.params).id);
    if (/^demo[:-]/i.test(id)) {
      throw new ApiInputError("This former demonstration record has been removed. Only live source records are available.", 410);
    }
    // Resolve the event and its feed context from the same snapshot.
    const response = await getEvents(mode);
    const event = response.events.find((item) => item.id === id);
    if (!event) throw new ApiInputError("Source record not found in the current live snapshot.", 404);
    return { event, ...responseContext(response) };
  });
}
