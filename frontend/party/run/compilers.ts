// Which compiler ids are valid (ported from backend/server.js, behaviour unchanged). The API's own list
// (GET /api/compilers/, no key needed) decides; until it loads, or when it can't be fetched, the frontend's
// compiler table is the fallback: one table for the editor and the server.
import table from "../../src/lib/compilers.json";

export type CompilerList = { ids: Set<string>; retired: Record<string, string> };

export const localCompilers: CompilerList = {
  ids: new Set(table.compilers.map(c => c.id)),
  retired: table.retired ?? {},
};

// Shape of GET /api/compilers/: { compilers: [{ id, name, ... }], retired: { "dotnet-csharp-9": "dotnet-csharp-10" } }.
// null for anything unusable, so a bad answer never replaces a good list.
export const parseCompilerList = (json: unknown): CompilerList | null => {
  const data = json as { compilers?: unknown; retired?: unknown } | null;
  if (!data || !Array.isArray(data.compilers)) return null;
  const ids = new Set<string>(
    data.compilers.map((c: { id?: unknown } | null) => c?.id).filter((id): id is string => typeof id === "string"),
  );
  if (!ids.size) return null;
  const retired = data.retired && typeof data.retired === "object" ? (data.retired as Record<string, string>) : {};
  return { ids, retired };
};

export const fetchCompilerList = async (fetchImpl: typeof fetch = fetch): Promise<CompilerList | null> => {
  try {
    const res = await fetchImpl("https://api.onlinecompiler.io/api/compilers/", { signal: AbortSignal.timeout(10_000) });
    return res.ok ? parseCompilerList(await res.json()) : null;
  } catch {
    return null;
  }
};

// The id to send upstream for one the browser sent: retired ids become the one they run as now; unknown → null.
export const resolveCompiler = (id: unknown, list: CompilerList | null = null): string | null => {
  if (typeof id !== "string") return null;
  const known = list ?? localCompilers;
  const current = known.retired[id] ?? localCompilers.retired[id] ?? id;
  return known.ids.has(current) ? current : null;
};
