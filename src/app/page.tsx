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
  { title: "Logo credits", links: [{ label: "Devicon", href: "https://devicon.dev" }, { label: "Simple Icons", href: "https://simpleicons.org" }] },
];

export default function Home() {
  return (
    <main className="bg-ground p-2 md:p-3">
      <SmoothScroll />
      <FluxHero />
      <Features />
      <LanguageMarquee />
      {/* Height follows the text; the bottom padding is the room the cropped word takes (about 18.5% of the width). */}
      <HalftoneWordmarkFooter
        wordmark="Ritwik"
        label="Flux is designed and built by Ritwik."
        meta={"Bring a teammate, or at least a rubber duck. © 2026"}
        columns={FOOTER_COLUMNS}
        palette={{ background: "#141311", ink: "#E1E0CC", warm: "#F0A27F" }}
        fontFamily={GeistSans.style.fontFamily}
        monoFamily={GeistSans.style.fontFamily}
        height="auto"
        className="rounded-2xl pb-[calc(18.5vw+40px)] md:rounded-[2rem]"
      />
    </main>
  );
}
