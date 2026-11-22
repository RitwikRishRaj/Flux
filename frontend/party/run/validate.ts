// Checks on a run or run-tests request before anything is sent upstream (ported from backend/server.js readRunRequest
// and the /run-tests checks, behaviour unchanged).
import { MAX_TEST_FIELD, MAX_TESTS, type TestCaseInput } from "./limits";
import { resolveCompiler, type CompilerList } from "./compilers";

export const ROOM_RE = /^[^\x00-\x1F\x7F]{1,128}$/; // any room the page can open (it takes the URL segment as is)
export const RUN_ID_RE = /^[A-Za-z0-9-]{1,64}$/;    // crypto.randomUUID() from the browser

type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

// Code and compiler shared by both kinds of request. The compiler comes back resolved (retired ids mapped).
export const checkCode = (body: { compiler?: unknown; code?: unknown }, compilers: CompilerList | null): Checked<{ compiler: string; code: string }> => {
  const compiler = resolveCompiler(body.compiler, compilers);
  if (!compiler) return { ok: false, error: "Unknown compiler" };
  const { code } = body;
  if (typeof code !== "string" || !code.trim()) return { ok: false, error: "Code is required" };
  if (code.length > 100_000) return { ok: false, error: "Code exceeds 100KB" };
  if (/[\x00-\x08\x0E-\x1F]/.test(code)) return { ok: false, error: "Code contains invalid characters" };
  return { ok: true, value: { compiler, code } };
};

export const checkTests = (tests: unknown): Checked<TestCaseInput[]> => {
  if (!Array.isArray(tests) || tests.length < 1) return { ok: false, error: "Add at least one test" };
  if (tests.length > MAX_TESTS) return { ok: false, error: `At most ${MAX_TESTS} tests per run` };
  const fine = tests.every((t: { input?: unknown; expected_output?: unknown } | null) =>
    typeof t?.input === "string" && typeof t?.expected_output === "string"
    && t.input.length <= MAX_TEST_FIELD && t.expected_output.length <= MAX_TEST_FIELD);
  if (!fine) return { ok: false, error: "Each test needs input and expected_output text" };
  return { ok: true, value: tests as TestCaseInput[] };
};
