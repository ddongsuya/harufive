import { env } from "cloudflare:workers";
import { handleHealthRequest } from "../../../server/http.mjs";

export const dynamic = "force-dynamic";

export async function GET() {
  return handleHealthRequest(env.DB);
}
