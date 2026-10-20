import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { handleAuthRequest } from "../../../../server/auth-service.mjs";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ segments: string[] }> };

async function handle(request: Request, context: RouteContext) {
  const [{ segments }, user] = await Promise.all([context.params, getChatGPTUser()]);
  const [first, second] = segments;
  const providerRoute = segments.length === 2 && (second === "start" || second === "callback");
  return handleAuthRequest(request, {
    action: providerRoute ? second : segments.length === 1 ? first : "unknown",
    provider: providerRoute ? first : undefined,
    db: env.DB, env, sitesUserId: user?.userId, sitesEmail: user?.email,
  });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
export const HEAD = handle;
