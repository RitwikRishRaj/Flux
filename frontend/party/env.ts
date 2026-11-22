// Bindings, variables and secrets the Worker sees (wrangler.jsonc; secrets via .dev.vars locally, `wrangler secret put` in production).
import type { FluxRoom } from "./server";
import type { Limiter } from "./limiter";

export type Env = {
  Main: DurableObjectNamespace<FluxRoom>;     // one Durable Object per room
  LIMITER: DurableObjectNamespace<Limiter>;   // one for the whole app (idFromName("global"))
  ONLINECOMPILER_API_KEY?: string;            // secret
  DAILY_RUN_BUDGET?: string;                  // var; runs per UTC day, default 3000
  ALLOWED_ORIGINS?: string;                   // var; comma-separated page origins allowed to open rooms
  TURNSTILE_SECRET_KEY?: string;              // secret; checks the token when a brand-new room is created
};
