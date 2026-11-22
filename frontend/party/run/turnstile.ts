// Checks a Cloudflare Turnstile token (https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).
// Used only when a brand-new room is created. Tokens last 300 s and work once.
export const verifyTurnstile = async (
  secret: string, token: string | null, remoteIp: string | null, fetchImpl: typeof fetch = fetch,
): Promise<boolean> => {
  if (!token || token.length > 2048) return false;
  try {
    const res = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response: token, ...(remoteIp ? { remoteip: remoteIp } : {}) }),
      signal: AbortSignal.timeout(5_000),
    });
    return ((await res.json()) as { success?: unknown }).success === true;
  } catch {
    return false; // siteverify unreachable: refuse the new room (existing rooms never get here)
  }
};
