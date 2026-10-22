import {
  ApiInputError, apiResponse, parseEventFilters, parseMode, validateIdentifier,
} from "@/lib/server/api";
import { LIVE_CONFLICT_NOTICE } from "../../_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return apiResponse(async () => {
    const params = new URL(request.url).searchParams;
    parseMode(params);
    parseEventFilters(params);
    validateIdentifier((await context.params).id);
    throw new ApiInputError(LIVE_CONFLICT_NOTICE, 404);
  });
}
