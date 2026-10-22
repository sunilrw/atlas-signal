import { apiResponse, parseMode } from "@/lib/server/api";
import { getEvents } from "@/lib/server/service";
import { responseContext } from "../_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return apiResponse(async () => {
    const mode = parseMode(new URL(request.url).searchParams);
    return responseContext(await getEvents(mode));
  });
}
