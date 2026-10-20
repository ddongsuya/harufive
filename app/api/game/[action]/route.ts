import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { handleGameRequest } from "../../../../server/http.mjs";
import { resolveGameIdentity } from "../../../../server/auth-service.mjs";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ action: string }> };

async function handle(request: Request, context: RouteContext) {
  const [{ action }, user] = await Promise.all([context.params, getChatGPTUser()]);
  return handleGameRequest(request, {
    action, db: env.DB,
    resolveUserId: async () => (await resolveGameIdentity(request, {
      db: env.DB, env, sitesUserId: user?.userId, sitesEmail: user?.email,
    }))?.userId,
  });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
export const HEAD = handle;
