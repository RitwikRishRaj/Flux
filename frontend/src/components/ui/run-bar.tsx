"use client";

import { useState } from "react";
import { Loader2, Play, ChevronDown } from "lucide-react";
import { COMPILERS, type CompilerId, type RunResult } from "@/lib/compilers";

const DEFAULT_CODE: Record<string, string> = {
  "python-3.14": 'print("Hello from Flux")',
  "typescript-deno": 'console.log("Hello from Flux");',
  "g++-15": '#include <iostream>\nint main(){ std::cout << "Hello from Flux\\n"; }',
  "gcc-15": '#include <stdio.h>\nint main(){ printf("Hello from Flux\\n"); }',
  "openjdk-25": 'public class Main { public static void main(String[] a){ System.out.println("Hello from Flux"); } }',
  "go-1.26": 'package main\nimport "fmt"\nfunc main(){ fmt.Println("Hello from Flux") }',
  "rust-1.93": 'fn main(){ println!("Hello from Flux"); }',
  "ruby-4.0": 'puts "Hello from Flux"',
  "php-8.5": '<?php echo "Hello from Flux\\n";',
  "dotnet-csharp-9": 'System.Console.WriteLine("Hello from Flux");',
  "dotnet-fsharp-9": 'printfn "Hello from Flux"',
  "haskell-9.12": 'main = putStrLn "Hello from Flux"',
};

export function RunBar() {
  const [compiler, setCompiler] = useState<CompilerId>("python-3.14");
  const [code, setCode] = useState(DEFAULT_CODE["python-3.14"]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    if (running) return;
    setRunning(true);
    setErr(null);
    setResult(null);
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ compiler, code }),
      });
      const data = (await res.json()) as RunResult & { error?: string };
      if (!res.ok) {
        setErr(data.error ?? `Request failed (${res.status})`);
      } else {
        setResult(data);
      }
    } catch {
      setErr("Network error. Try again.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="w-full max-w-3xl space-y-3">
      <div className="flex items-center gap-2">
        {/* Language select */}
        <div className="relative">
          <select
            value={compiler}
            onChange={(e) => {
              const id = e.target.value as CompilerId;
              setCompiler(id);
              setCode(DEFAULT_CODE[id] ?? "");
            }}
            aria-label="Language"
            className="h-10 appearance-none rounded-full bg-white/5 pl-4 pr-9 text-sm text-primary outline-none ring-1 ring-inset ring-white/15 transition-colors focus:ring-2 focus:ring-white/50"
          >
            {COMPILERS.map((c) => (
              <option key={c.id} value={c.id} className="bg-ground">
                {c.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary/60" />
        </div>

        {/* Run button */}
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="group inline-flex h-10 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-black transition-transform active:scale-[0.97] disabled:opacity-60"
        >
          {running ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4 fill-black" />
          )}
          {running ? "Running" : "Run"}
        </button>

        {result && (
          <span className="text-xs text-primary/50">
            {result.time}s · {result.memory}KB · exit {result.exit_code}
          </span>
        )}
      </div>

      {/* Code box */}
      <textarea
        value={code}
        onChange={(e) => setCode(e.target.value)}
        spellCheck={false}
        rows={6}
        aria-label="Code"
        className="w-full resize-y rounded-2xl bg-white/5 p-4 font-mono text-sm leading-relaxed text-primary outline-none ring-1 ring-inset ring-white/15 focus:ring-2 focus:ring-white/50"
      />

      {/* Output */}
      {(err || result) && (
        <pre
          aria-live="polite"
          className={`max-h-64 overflow-auto rounded-2xl p-4 font-mono text-sm leading-relaxed ring-1 ring-inset ${
            err || (result && result.exit_code !== 0)
              ? "bg-[#3a1f16]/40 text-[#FFC9A8] ring-[#F0A27F]/25"
              : "bg-white/5 text-primary ring-white/15"
          }`}
        >
          {err ?? (result!.output || result!.error || "(no output)")}
          {!err && result?.error && result.output ? `\n${result.error}` : ""}
        </pre>
      )}
    </div>
  );
}
