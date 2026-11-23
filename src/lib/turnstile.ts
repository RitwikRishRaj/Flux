// An invisible Cloudflare Turnstile token for creating a new room (the room checks it; joining needs none).
// Resolves null if there is no site key, the script can't load, the challenge fails, or it takes longer than timeoutMs:
// the caller then connects without a token, which existing rooms ignore anyway.
declare global {
  interface Window {
    turnstile?: {
      render(el: HTMLElement, options: { sitekey: string; callback: (token: string) => void; "error-callback": () => void }): string;
      remove(widgetId: string): void;
    };
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
let script: Promise<void> | null = null;

const loadScript = () => script ??= new Promise<void>((resolve, reject) => {
  const tag = document.createElement("script");
  tag.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  tag.async = true;
  tag.onload = () => resolve();
  tag.onerror = () => { script = null; reject(new Error("turnstile script")); };
  document.head.appendChild(tag);
});

export const getTurnstileToken = (timeoutMs: number): Promise<string | null> => {
  if (!SITE_KEY || typeof window === "undefined") return Promise.resolve(null);
  return new Promise(resolve => {
    let widget: string | null = null, settled = false;
    const host = document.createElement("div"); // the widget is invisible; it just needs somewhere to live
    const done = (token: string | null) => {
      if (settled) return; // the challenge may finish after the timeout
      settled = true;
      clearTimeout(timer);
      if (widget) window.turnstile?.remove(widget);
      host.remove();
      resolve(token);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    loadScript().then(() => {
      if (settled) return; // timed out while the script loaded
      document.body.appendChild(host);
      widget = window.turnstile!.render(host, { sitekey: SITE_KEY, callback: done, "error-callback": () => done(null) });
    }, () => done(null));
  });
};
