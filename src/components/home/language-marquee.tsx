"use client";

import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from "framer-motion";
import { useRef } from "react";
import { COMPILERS, type Compiler } from "@/lib/compilers";

// Logo file in public/logos per compiler id (Devicon, plus Simple Icons for D, Ada, Octave and Common Lisp).
// Pascal and FreeBASIC have no logo in either set, so they get a monogram.
const MONOGRAM: Record<string, string> = { "fpc-3.2": "Pas", "fbc-1.10": "FB" };
const LOGO: Record<string, string> = {
  "python-3.14": "python", "nodejs-24": "javascript", "typescript-deno": "typescript", "openjdk-25": "java",
  "g++-15": "cplusplus", "g++-15-cpp20": "cplusplus", "gcc-15": "c", "dotnet-csharp-10": "csharp", "go-1.26": "go",
  "rust-1.93": "rust", "kotlin-2.4": "kotlin", "swift-6.4": "swift", "zig-0.17": "zig", "ldc-1.43": "d", "nim-2.2": "nim",
  "crystal-1.22": "crystal", "gnat-15": "ada", "gfortran-15": "fortran", "nasm-3": "nasm", "clang-objc-21": "objectivec",
  "php-8.5": "php", "ruby-4.0": "ruby", "bash-5.2": "bash", "powershell-7.6": "powershell", "perl-5.44": "perl",
  "lua-5.5": "lua", "dart-3.13": "dart", "groovy-6.0": "groovy", "haskell-9.12": "haskell", "ocaml-5.4": "ocaml",
  "dotnet-fsharp-10": "fsharp", "elixir-1.20": "elixir", "erlang-29": "erlang", "clojure-1.12": "clojure",
  "scala-3.10": "scala", "sbcl-2.6": "commonlisp", "racket-9.3": "racket", "swipl-10": "prolog",
  "python-3.14-pandas2": "pandas", "sqlite-3": "sqlite", "duckdb-1.5": "duckdb", "r-4.6": "r", "julia-1.13": "julia",
  "octave-11": "octave", "dotnet-vbnet-10": "visualbasic", "gnucobol-3.2": "cobol",
};

const half = Math.ceil(COMPILERS.length / 2);
const ROWS = [COMPILERS.slice(0, half), COMPILERS.slice(half)];

const Tile = ({ c }: { c: Compiler }) => (
  <li className="flex shrink-0 items-center gap-3 rounded-2xl bg-[#141311] py-2 pl-2 pr-5 transition-colors duration-300 hover:bg-[#1b1a17]">
    {/* Cream chip, so dark logos (Rust, NASM, Crystal) read as well as bright ones. */}
    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary">
      {LOGO[c.id] ? (
        <img src={`/logos/${LOGO[c.id]}.svg`} alt="" width={26} height={26} loading="lazy" className="h-[26px] w-[26px]" />
      ) : (
        <span className="text-[13px] font-semibold tracking-tight text-ground">{MONOGRAM[c.id] ?? c.label.slice(0, 3)}</span>
      )}
    </span>
    <span className="whitespace-nowrap text-lg font-medium tracking-tight text-primary">{c.label}</span>
    <span className="whitespace-nowrap text-sm text-primary/50">{c.version}</span>
  </li>
);

const Row = ({ list, reverse, shift }: { list: Compiler[]; reverse?: boolean; shift: MotionValue<number> }) => (
  // Outer layer follows the scroll, inner layer loops on its own: the two moves add up.
  <motion.div style={{ x: shift }} className="flex">
    <div className={`flex ${reverse ? "marquee-right" : "marquee-left"}`}>
      {[0, 1].map((copy) => (
        <ul key={copy} aria-hidden={copy === 1 || undefined} className="flex shrink-0 gap-3 pr-3">
          {list.map((c) => <Tile key={c.id} c={c} />)}
        </ul>
      ))}
    </div>
  </motion.div>
);

export function LanguageMarquee() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const left = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [160, -260]);
  const right = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [-260, 160]);

  return (
    <section ref={ref} id="languages" aria-labelledby="languages-title" className="py-16 md:pb-24 md:pt-16">
      <div className="px-4 sm:px-6 md:px-10">
        <h2 id="languages-title" className="max-w-3xl text-[clamp(2rem,4.6vw,4rem)] font-medium leading-[1] tracking-[-0.045em] text-primary">
          {COMPILERS.length} languages, from Python to COBOL. Yes, COBOL.
        </h2>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-primary/80 md:text-lg">
          Pick one from the menu and press Run. The toolchains live on our side, so your laptop stays clean.
        </p>
      </div>
      <div className="group mt-10 grid gap-3 overflow-hidden motion-reduce:overflow-x-auto md:mt-14">
        <Row list={ROWS[0]} shift={left} />
        <Row list={ROWS[1]} shift={right} reverse />
      </div>
    </section>
  );
}
