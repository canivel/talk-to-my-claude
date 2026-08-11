/**
 * Slop scoring — boilerplate density measurement.
 *
 * Read this before you trust the number: this is NOT an AI detector, and it is
 * important that we never market it as one. Statistical detection of machine
 * authorship is unreliable, and false accusations of "you used AI" are a real
 * harm. What this measures is narrower and actually measurable: how much of a
 * message is ceremony rather than content — hedges, triads, bolded bullet
 * scaffolding, uniform sentence rhythm, openers that say nothing.
 *
 * Heavily-edited model output scores low. A human who writes in corporate
 * boilerplate scores high. That is the correct behaviour: the score describes
 * the text, not the author. Provenance is a separate question, and TTMC answers
 * it the only honest way — with a signature (see provenance.ts), not a guess.
 */

import type { SlopBand, SlopReport, SlopSignal, SlopSignalId } from "./types.js";
import {
  clamp,
  countWords,
  lines,
  matches,
  mean,
  round,
  sentences,
  snippet,
  stdev,
  uniq,
  words,
} from "./text.js";

/** Below this many words there is not enough text to say anything useful. */
const MIN_CONFIDENT_WORDS = 25;

/** Max points each signal can contribute. Sums to 100. */
const WEIGHTS: Record<SlopSignalId, number> = {
  llm_lexicon: 18,
  sentence_uniformity: 10,
  hedging: 10,
  not_just_but: 10,
  boilerplate_open: 8,
  boilerplate_close: 8,
  rule_of_three: 8,
  bold_bullets: 8,
  enthusiasm: 6,
  contraction_absence: 6,
  emdash_density: 4,
  specificity_drought: 4,
};

const LABELS: Record<SlopSignalId, string> = {
  llm_lexicon: "House-style vocabulary",
  sentence_uniformity: "Uniform sentence rhythm",
  hedging: "Hedging and throat-clearing",
  not_just_but: "“It’s not just X, it’s Y” construction",
  boilerplate_open: "Ceremonial opener",
  boilerplate_close: "Ceremonial closer",
  rule_of_three: "Compulsive triads",
  bold_bullets: "Bolded bullet scaffolding",
  enthusiasm: "Unprompted enthusiasm",
  contraction_absence: "No contractions",
  emdash_density: "Em-dash density",
  specificity_drought: "No concrete specifics",
};

/**
 * Words that are not bad words. They are simply the words a model reaches for
 * when it has been asked to sound thoughtful and has nothing to add.
 */
const LEXICON = [
  "delve", "leverage", "robust", "tapestry", "testament", "realm", "landscape",
  "underscore", "underscores", "pivotal", "crucial", "seamless", "seamlessly",
  "holistic", "myriad", "navigate", "navigating", "harness", "harnessing",
  "elevate", "unlock", "unlocking", "embark", "foster", "fostering",
  "intricate", "nuanced", "paradigm", "synergy", "synergies", "spearhead",
  "cornerstone", "multifaceted", "streamline", "streamlining", "empower",
  "empowering", "transformative", "actionable", "granular", "bandwidth",
  "ecosystem", "alignment", "cadence", "north-star", "cutting-edge",
  "game-changer", "best-in-class", "deep-dive", "learnings", "ideate",
];

const HEDGES = [
  "it's important to note", "it is important to note", "it's worth noting",
  "it is worth noting", "that said", "that being said", "generally speaking",
  "in many cases", "there are several factors", "while it's true",
  "on the other hand", "at the end of the day", "it depends on",
  "it's essential to", "it is essential to", "one could argue",
  "broadly speaking", "in essence", "ultimately, the",
];

const OPENERS = [
  "i hope this email finds you well", "i hope this message finds you well",
  "i hope you're doing well", "i hope you are doing well",
  "thanks for reaching out", "thank you for reaching out",
  "thank you for your message", "great question", "excellent question",
  "i wanted to reach out", "hope you're having a great",
  "thanks for the thoughtful", "i appreciate you bringing this",
];

const CLOSERS = [
  "let me know if you have any questions", "happy to discuss further",
  "looking forward to hearing", "please don't hesitate", "please do not hesitate",
  "feel free to reach out", "hope this helps", "let me know your thoughts",
  "happy to jump on a call", "let me know how you'd like to proceed",
  "i'm here to help", "does that work for you",
];

const ENTHUSIASM = [
  "absolutely!", "certainly!", "great point", "you're absolutely right",
  "you are absolutely right", "i'd be happy to", "i would be happy to",
  "that's a great", "what a great", "fantastic question", "love this",
  "spot on", "exactly right",
];

const NOT_JUST_BUT = [
  // The full construction, with any subject: "this is not just X, it's Y".
  /\bnot just\b[^.!?]{3,80}?,\s*(?:it(?:'|’)?s|but|they(?:'|’)?re|we(?:'|’)?re|rather)\b/i,
  /\bnot merely\b/i,
  /\bisn(?:'|’)?t just about\b/i,
  /\bmore than just\b/i,
  /\bnot (?:only|simply) .{3,60}? but (?:also )?\b/i,
];

const TRIAD_RE =
  /\b[\w'’-]+(?:\s+[\w'’-]+){0,3},\s+[\w'’-]+(?:\s+[\w'’-]+){0,3},\s+and\s+[\w'’-]+/g;

const BOLD_BULLET_RE = /^\s*(?:[-*•]|\d+\.)\s*\*\*[^*\n]{2,60}\*\*\s*[:：—–-]?/;

const CONTRACTION_RE = /\b[\p{L}]+(?:'|’)(?:t|s|re|ve|ll|d|m)\b/giu;

/** Tokens that count as a concrete, checkable detail. */
const SPECIFIC_RE =
  /(?:\$\s?\d[\d,.]*|\b\d+(?:\.\d+)?\s?%|\b\d{4}-\d{2}-\d{2}\b|\bQ[1-4]\b|\bv?\d+\.\d+(?:\.\d+)?\b|\b\d+(?:,\d{3})+\b|\b\d+\s?(?:ms|s|m|h|d|kb|mb|gb|tb|k|x)\b|`[^`\n]+`|\b[a-z]+[A-Z][A-Za-z]*\b|\b[\w.-]+\.(?:com|io|ai|dev|org|net)\b)/g;

interface Detection {
  intensity: number;
  evidence: string[];
}

/** Case-insensitive phrase counter that also returns which phrases hit. */
function findPhrases(haystack: string, phrases: string[]): string[] {
  const hay = haystack.toLowerCase();
  return phrases.filter((p) => hay.includes(p));
}

function perHundred(count: number, wordCount: number): number {
  if (wordCount === 0) return 0;
  return (count / wordCount) * 100;
}

function detectLexicon(text: string, wc: number): Detection {
  const found = words(text)
    .map((w) => w.toLowerCase())
    .filter((w) => LEXICON.includes(w));
  // Three house-style words per hundred is a saturated signal.
  return {
    intensity: clamp(perHundred(found.length, wc) / 3, 0, 1),
    evidence: uniq(found).slice(0, 8),
  };
}

function detectHedging(text: string, wc: number): Detection {
  const hits = findPhrases(text, HEDGES);
  return {
    intensity: clamp(perHundred(hits.length, wc) / 2.5, 0, 1),
    evidence: hits.slice(0, 5),
  };
}

function detectNotJustBut(text: string): Detection {
  const evidence: string[] = [];
  for (const re of NOT_JUST_BUT) {
    const m = text.match(re);
    if (m) evidence.push(snippet(m[0]));
  }
  // One instance of this construction is already diagnostic, so a single hit
  // carries most of the weight rather than half of it.
  return { intensity: clamp(evidence.length / 1.5, 0, 1), evidence: evidence.slice(0, 4) };
}

/** Openers only count in the first two sentences; closers in the last two. */
function detectOpener(sents: string[]): Detection {
  const head = sents.slice(0, 2).join(" ");
  const hits = findPhrases(head, OPENERS);
  return { intensity: hits.length > 0 ? 1 : 0, evidence: hits.slice(0, 3) };
}

function detectCloser(sents: string[]): Detection {
  const tail = sents.slice(-2).join(" ");
  const hits = findPhrases(tail, CLOSERS);
  return { intensity: hits.length > 0 ? 1 : 0, evidence: hits.slice(0, 3) };
}

function detectEnthusiasm(text: string, wc: number): Detection {
  const hits = findPhrases(text, ENTHUSIASM);
  return {
    intensity: clamp(perHundred(hits.length, wc) / 1.5, 0, 1),
    evidence: hits.slice(0, 4),
  };
}

function detectTriads(text: string): Detection {
  const hits = matches(text, TRIAD_RE);
  return {
    intensity: clamp(hits.length / 2, 0, 1),
    evidence: hits.slice(0, 4).map((h) => snippet(h)),
  };
}

function detectBoldBullets(text: string): Detection {
  const hits = lines(text).filter((l) => BOLD_BULLET_RE.test(l));
  return {
    intensity: clamp(hits.length / 4, 0, 1),
    evidence: hits.slice(0, 4).map((h) => snippet(h, 48)),
  };
}

/**
 * Humans vary sentence length a lot (coefficient of variation ~0.5-0.8).
 * Unedited model prose clusters tightly (~0.25-0.4). Needs enough sentences
 * to mean anything, so short text scores zero rather than guessing.
 */
function detectUniformity(sents: string[]): Detection {
  if (sents.length < 5) return { intensity: 0, evidence: [] };
  const lens = sents.map((s) => countWords(s)).filter((n) => n > 0);
  const m = mean(lens);
  if (m === 0) return { intensity: 0, evidence: [] };
  const cv = stdev(lens) / m;
  const intensity = clamp((0.55 - cv) / 0.35, 0, 1);
  return {
    intensity,
    evidence:
      intensity > 0
        ? [`${sents.length} sentences, ${round(m, 1)} words avg, variation ${round(cv)}`]
        : [],
  };
}

function detectContractionAbsence(text: string, wc: number): Detection {
  if (wc < 60) return { intensity: 0, evidence: [] };
  const found = matches(text, CONTRACTION_RE);
  const rate = perHundred(found.length, wc);
  const intensity = clamp(1 - rate / 1.5, 0, 1);
  return {
    intensity,
    evidence: intensity > 0 ? [`${found.length} contractions in ${wc} words`] : [],
  };
}

function detectEmDashes(text: string, wc: number): Detection {
  const count = matches(text, /—|\s-{1,2}\s/g).length;
  const rate = perHundred(count, wc);
  return {
    intensity: clamp(rate / 1.5, 0, 1),
    evidence: count > 0 ? [`${count} em-dash breaks in ${wc} words`] : [],
  };
}

function detectSpecificityDrought(text: string, wc: number): Detection {
  if (wc < 50) return { intensity: 0, evidence: [] };
  const found = matches(text, SPECIFIC_RE);
  const rate = perHundred(found.length, wc);
  const intensity = clamp(1 - rate / 2, 0, 1);
  return {
    intensity,
    evidence:
      intensity > 0
        ? [`${found.length} concrete details (numbers, dates, names) in ${wc} words`]
        : [],
  };
}

/**
 * Band thresholds.
 *
 * Calibrated against the fact that no real message saturates all twelve
 * signals at once — text that trips every structural tell still leaves the
 * em-dash, contraction, and specificity signals partly unfired. Anchoring the
 * top band at 75 made it unreachable in practice, which quietly collapsed the
 * scale into three usable bands. These thresholds are set where observed text
 * actually lands.
 */
function bandFor(score: number): SlopBand {
  if (score < 20) return "human";
  if (score < 42) return "assisted";
  if (score < 65) return "likely-ai";
  return "pure-slop";
}

function verdictFor(band: SlopBand, score: number, confident: boolean): string {
  if (!confident) {
    return "Too short to judge — boilerplate scoring needs about 25 words.";
  }
  switch (band) {
    case "human":
      return `Reads like a person wrote it (${score}/100 boilerplate). Answer it yourself.`;
    case "assisted":
      return `Some scaffolding, but there is real content here (${score}/100). Worth reading.`;
    case "likely-ai":
      return `Mostly ceremony (${score}/100). The actual ask is probably two sentences.`;
    case "pure-slop":
      return `Almost entirely filler (${score}/100). Let your Claude handle it.`;
  }
}

/**
 * Estimate the fraction of words carrying no information. Blends measured
 * filler (phrases we actually matched) with a share derived from the score,
 * because the structural signals cost words we cannot point at individually.
 */
function estimateCompression(score: number, measuredFillerWords: number, wc: number): number {
  if (wc === 0) return 0;
  const measured = measuredFillerWords / wc;
  return round(clamp(measured + (score / 100) * 0.4, 0, 0.85), 3);
}

/**
 * Score a message for boilerplate density.
 *
 * Deterministic and side-effect free: the same text always yields the same
 * report, which matters because the score is shown to users and stored.
 */
export function scoreSlop(text: string): SlopReport {
  const wc = countWords(text);
  const sents = sentences(text);

  const detections: Record<SlopSignalId, Detection> = {
    llm_lexicon: detectLexicon(text, wc),
    sentence_uniformity: detectUniformity(sents),
    hedging: detectHedging(text, wc),
    not_just_but: detectNotJustBut(text),
    boilerplate_open: detectOpener(sents),
    boilerplate_close: detectCloser(sents),
    rule_of_three: detectTriads(text),
    bold_bullets: detectBoldBullets(text),
    enthusiasm: detectEnthusiasm(text, wc),
    contraction_absence: detectContractionAbsence(text, wc),
    emdash_density: detectEmDashes(text, wc),
    specificity_drought: detectSpecificityDrought(text, wc),
  };

  const signals: SlopSignal[] = [];
  let raw = 0;
  for (const id of Object.keys(WEIGHTS) as SlopSignalId[]) {
    const d = detections[id];
    const points = WEIGHTS[id] * d.intensity;
    raw += points;
    if (d.intensity > 0) {
      signals.push({
        id,
        label: LABELS[id],
        intensity: round(d.intensity),
        points: round(points, 1),
        evidence: d.evidence,
      });
    }
  }

  // Short text cannot support a confident score, so damp it toward zero rather
  // than letting one matched phrase in a 12-word note read as 80/100.
  const confident = wc >= MIN_CONFIDENT_WORDS;
  const damping = confident ? 1 : wc / MIN_CONFIDENT_WORDS;
  const score = Math.round(clamp(raw * damping, 0, 100));

  signals.sort((a, b) => b.points - a.points);

  const fillerWords = [
    ...detections.hedging.evidence,
    ...detections.boilerplate_open.evidence,
    ...detections.boilerplate_close.evidence,
    ...detections.enthusiasm.evidence,
  ].reduce((sum, phrase) => sum + countWords(phrase), 0);

  const band = bandFor(score);
  return {
    score,
    band,
    signals,
    wordCount: wc,
    compressionOpportunity: estimateCompression(score, fillerWords, wc),
    verdict: verdictFor(band, score, confident),
  };
}

/** Convenience for UI: the two or three signals worth showing a human. */
export function topSignals(report: SlopReport, n = 3): SlopSignal[] {
  return report.signals.slice(0, n);
}
