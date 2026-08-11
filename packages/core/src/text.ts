/** Small shared text helpers. Deliberately dependency-free and deterministic. */

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu;

export function words(text: string): string[] {
  return text.match(WORD_RE) ?? [];
}

export function countWords(text: string): number {
  return words(text).length;
}

/**
 * Split into sentences. Naive on purpose: abbreviations will occasionally
 * cause a false break, which is acceptable for statistical signals and keeps
 * this free of a tokenizer dependency.
 */
export function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z"'(\[])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function lines(text: string): string[] {
  return text.split(/\r?\n/);
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function round(n: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** Mean of a numeric list, or 0 for an empty list. */
export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Population standard deviation. */
export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

/**
 * Normalized word shingles, used for novelty / convergence detection.
 * Stopwords are kept: their rhythm carries real signal about restatement.
 */
export function shingles(text: string, size = 3): Set<string> {
  const ws = words(text).map((w) => w.toLowerCase());
  const out = new Set<string>();
  if (ws.length < size) {
    if (ws.length > 0) out.add(ws.join(" "));
    return out;
  }
  for (let i = 0; i <= ws.length - size; i++) {
    out.add(ws.slice(i, i + size).join(" "));
  }
  return out;
}

/** Fraction of `candidate` shingles not present in `seen`. 1 means all new. */
export function novelty(candidate: Set<string>, seen: Set<string>): number {
  if (candidate.size === 0) return 0;
  let fresh = 0;
  for (const s of candidate) if (!seen.has(s)) fresh++;
  return fresh / candidate.size;
}

/** Count non-overlapping regex matches, returning the matched text. */
export function matches(text: string, re: RegExp): string[] {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  return Array.from(text.matchAll(new RegExp(re.source, flags)), (m) => m[0]);
}

/** Trim a snippet for display in evidence lists. */
export function snippet(s: string, max = 72): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/** Stable dedupe preserving first-seen order, case-insensitive. */
export function uniq(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const k = x.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}
