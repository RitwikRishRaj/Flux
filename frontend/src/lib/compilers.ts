import table from "./compilers.json";

export interface Compiler {
  id: string;
  label: string;
  monaco: string;
  file: string;
  hello: string;
}

// The one compiler table: id (the API's), label, Monaco language, file name and starter code. backend/server.js reads
// the same JSON as its fallback list of ids when the API's own list (GET /api/compilers/) can't be fetched.
export const COMPILERS: Compiler[] = table.compilers;

// Old ids still saved in rooms (e.g. "dotnet-csharp-9") and the id they run as now; mirrors the API's `retired` map.
export const RETIRED: Record<string, string> = table.retired;

export type CompilerId = Compiler["id"];

// Unknown ids fall back to the first language, so an odd value in a room's saved state can't crash the page.
export const byId = (id: CompilerId): Compiler =>
  COMPILERS.find((c) => c.id === (RETIRED[id] ?? id)) ?? COMPILERS[0];

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
