import { GeistSans } from "geist/font/sans";
import { Features } from "@/components/home/features";
import { LanguageMarquee } from "@/components/home/language-marquee";
import { SmoothScroll } from "@/components/home/smooth-scroll";
import { FluxHero } from "@/components/ui/flux-hero";
import HalftoneWordmarkFooter from "@/components/ui/halftone-wordmark-footer";

const FOOTER_COLUMNS = [
  { title: "Rooms", links: [{ label: "Start a code room", href: "#top" }, { label: "Start a web room", href: "/?mode=web" }] },
  { title: "Explore", links: [{ label: "Features", href: "#features" }, { label: "Languages", href: "#languages" }, { label: "Privacy", href: "/privacy" }] },
  // Devicon is MIT: its licence ships next to the logos in public/logos.
  { title: "Logos", links: [{ label: "Devicon", href: "https://devicon.dev" }, { label: "Simple Icons", href: "https://simpleicons.org" }] },
];

export default function Home() {
  return (
    <main className="bg-ground p-2 md:p-3">
      <SmoothScroll />
      <FluxHero />
      <Features />
      <LanguageMarquee />
      <HalftoneWordmarkFooter
        wordmark="Ritwik"
        label="Flux, built by Ritwik"
        meta="© 2026 · Code together from one link"
        columns={FOOTER_COLUMNS}
        palette={{ background: "#141311", ink: "#E1E0CC", warm: "#F0A27F" }}
        fontFamily={GeistSans.style.fontFamily}
        height="clamp(420px, 36vw, 560px)"
        className="rounded-2xl md:rounded-[2rem]"
      />
    </main>
  );
}
