"use client";

import Lenis from "lenis";
import { useEffect } from "react";

/** Eased wheel and trackpad scrolling on the homepage; #section links glide instead of jumping. */
export function SmoothScroll() {
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lenis = new Lenis({ autoRaf: true, lerp: 0.09 });
    // Lenis's own `anchors` option lets the browser jump first, so the page flashes at the target for a frame.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element).closest?.('a[href^="#"]');
      const hash = a?.getAttribute("href");
      const target = hash === "#top" ? 0 : hash && document.querySelector<HTMLElement>(hash);
      if (target === null || target === undefined || target === "") return;
      e.preventDefault();
      lenis.scrollTo(target, { duration: 1.4 });
      history.replaceState(null, "", hash);
    };
    document.addEventListener("click", onClick);
    return () => { document.removeEventListener("click", onClick); lenis.destroy(); };
  }, []);
  return null;
}
