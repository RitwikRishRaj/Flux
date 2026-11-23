import { Features } from "@/components/home/features";
import { HalftoneFooter } from "@/components/home/halftone-footer";
import { LanguageMarquee } from "@/components/home/language-marquee";
import { SmoothScroll } from "@/components/home/smooth-scroll";
import { FluxHero } from "@/components/ui/flux-hero";

export default function Home() {
  return (
    <main className="bg-ground p-2 md:p-3">
      <SmoothScroll />
      <FluxHero />
      <Features />
      <LanguageMarquee />
      <HalftoneFooter />
    </main>
  );
}
