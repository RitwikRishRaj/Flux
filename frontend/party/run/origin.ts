// Which page origins may open a room or read /status cross-origin. ALLOWED_ORIGINS is a comma-separated list of exact
// origins (scheme://host[:port]); unset means none. Only browsers are held to this: any script can send a fake Origin.
export const isAllowedOrigin = (origin: string | null, allowed: string | undefined): boolean =>
  !!origin && (allowed ?? "").split(",").map(o => o.trim()).filter(Boolean).includes(origin);
