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

export interface RunResult {
  output: string;
  error: string;
  status: string;
  exit_code: number;
  signal: number | null;
  time: string;
  total: string;
  memory: string;
}
