import { apiResponse } from "@/lib/server/api";
import { getHealth } from "@/lib/server/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return apiResponse(async () => getHealth());
}
