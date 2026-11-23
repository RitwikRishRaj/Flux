// Just enough highlighting for the homepage demos: k = tags/keywords/selectors, f = attributes/properties, s = strings/values.
// Groups in order: 1 = k, 2 = f, 3 = s.
const RULES = {
  html: /(<\/?[\w-]+|\/?>)|(\s[\w-]+(?==))|("[^"]*")/g,
  css: /(^[^{}\n:]+(?=\{)|@[\w-]+)|([\w-]+(?=:))|(#[\da-fA-F]{3,8}\b|\d*\.?\d+(?:px|%|s|vh)?)/gm,
  js: /(\b(?:let|const|if|return)\b|=>)|(\b\d+\b)|("[^"]*"|`[^`]*`)/g,
};
const GROUP = ["k", "f", "s"] as const;
export type Lang = keyof typeof RULES;
export type Token = { t: string; c?: (typeof GROUP)[number] };

export function tokens(code: string, lang: Lang): Token[] {
  const out: Token[] = [];
  let last = 0;
  for (const m of code.matchAll(RULES[lang])) {
    const at = m.index!;
    if (at > last) out.push({ t: code.slice(last, at) });
    out.push({ t: m[0], c: GROUP[[m[1], m[2], m[3]].findIndex((g) => g !== undefined)] });
    last = at + m[0].length;
  }
  if (last < code.length) out.push({ t: code.slice(last) });
  return out;
}

const HOLD = 18; // ticks a finished value stays up before it is deleted

/**
 * One person's typing loop over `values`: type the value, hold it, delete it, pause, next value.
 * `typed` is what the editor shows; `done` is the last value fully typed, which is what the preview uses.
 */
export function typing(tick: number, values: readonly string[]): { typed: string; done: string } {
  const spans = values.map((v) => v.length * 2 + HOLD + 4);
  const total = spans.reduce((a, b) => a + b, 0);
  let t = ((tick % total) + total) % total;
  for (let i = 0; i < values.length; i++) {
    const v = values[i], L = v.length;
    if (t >= spans[i]) { t -= spans[i]; continue; }
    if (t < L) return { typed: v.slice(0, t + 1), done: t + 1 === L ? v : values[(i + values.length - 1) % values.length] };
    if (t < L + HOLD) return { typed: v, done: v };
    if (t < 2 * L + HOLD) return { typed: v.slice(0, 2 * L + HOLD - t - 1), done: v };
    return { typed: "", done: v };
  }
  return { typed: values[0], done: values[0] };
}
