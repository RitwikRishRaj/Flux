export interface Compiler {
  id: string;
  label: string;
  monaco: string;
  file: string;
  hello: string;
}

export const COMPILERS: Compiler[] = [
  { id: "python-3.14", label: "Python", monaco: "python", file: "main.py", hello: 'print("Hello from Flux")' },
  { id: "typescript-deno", label: "TypeScript", monaco: "typescript", file: "main.ts", hello: 'console.log("Hello from Flux");' },
  { id: "g++-15", label: "C++", monaco: "cpp", file: "main.cpp", hello: '#include <iostream>\nint main() {\n  std::cout << "Hello from Flux\\n";\n}' },
  { id: "gcc-15", label: "C", monaco: "c", file: "main.c", hello: '#include <stdio.h>\nint main(void) {\n  printf("Hello from Flux\\n");\n}' },
  { id: "openjdk-25", label: "Java", monaco: "java", file: "Main.java", hello: 'public class Main {\n  public static void main(String[] args) {\n    System.out.println("Hello from Flux");\n  }\n}' },
  { id: "go-1.26", label: "Go", monaco: "go", file: "main.go", hello: 'package main\n\nimport "fmt"\n\nfunc main() {\n  fmt.Println("Hello from Flux")\n}' },
  { id: "rust-1.93", label: "Rust", monaco: "rust", file: "main.rs", hello: 'fn main() {\n  println!("Hello from Flux");\n}' },
  { id: "ruby-4.0", label: "Ruby", monaco: "ruby", file: "main.rb", hello: 'puts "Hello from Flux"' },
  { id: "php-8.5", label: "PHP", monaco: "php", file: "main.php", hello: '<?php\necho "Hello from Flux\\n";' },
  { id: "dotnet-csharp-9", label: "C#", monaco: "csharp", file: "Program.cs", hello: 'Console.WriteLine("Hello from Flux");' },
  { id: "dotnet-fsharp-9", label: "F#", monaco: "fsharp", file: "Program.fs", hello: 'printfn "Hello from Flux"' },
  { id: "haskell-9.12", label: "Haskell", monaco: "haskell", file: "main.hs", hello: 'main = putStrLn "Hello from Flux"' },
];

export type CompilerId = Compiler["id"];

export const byId = (id: CompilerId): Compiler => COMPILERS.find((c) => c.id === id)!;

// Safe to replace with another starter: nothing typed, or only an untouched starter snippet.
export const isEmptyOrStarter = (code: string) => !code.trim() || COMPILERS.some((c) => c.hello === code);

export interface RunResult {
  output: string;
  error: string;
  status: string;
  exit_code: number;
  signal: number | null;
  truncated: boolean;   // stdout or stderr went over 64 KB and was cut
  time: string;         // seconds, as text
  total: string;
  memory: string;       // KB, as text; includes the language runtime
  time_limit: number;   // seconds
  memory_limit: number; // MB
}

// What an exit code means, from the docs' exit-code table (onlinecompiler.io/docs/run-code). null for a clean exit.
export const describeExit = (exitCode: number, signal: number | null, timeLimit?: number | null, memoryLimit?: number | null): string | null => {
  switch (exitCode) {
    case 0: return null;
    case 124: return `Stopped at the ${timeLimit ?? 30} s time limit`;
    case 137: return `Out of memory (${memoryLimit ?? 512} MB limit)`;
    case 139: return "Crashed (segmentation fault)";
    case 153: return "Stopped: more than 8 MB of output";
    case 71: return "Stopped: too many processes";
    case -1: return "The run service failed. Try again.";
    default: return signal ? `Killed by signal ${signal}` : `Exited with code ${exitCode}`;
  }
};

// 0 means not measured (a run stopped at the time limit reports "0.0000"), so it shows nothing.
export const formatSeconds = (time: string) => {
  const s = parseFloat(time);
  return Number.isFinite(s) && s > 0 ? `${s < 10 ? s.toFixed(2) : s.toFixed(1)} s` : null;
};

// 0 means not measured (e.g. a run killed for memory reports "0"), so it shows nothing rather than "0 KB".
export const formatMemory = (kb: string) => {
  const n = parseFloat(kb);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n >= 1024 ? `${Math.round(n / 1024)} MB` : `${Math.round(n)} KB`;
};
