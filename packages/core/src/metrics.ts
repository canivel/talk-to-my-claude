/**
 * Metrics.
 *
 * These exist to answer one uncomfortable question the product has to keep
 * asking itself: is it compressing communication, or adding to it? Every other
 * number here is secondary to `turnTrend`, which is the early warning that TTMC
 * has started generating the volume it was built to absorb.
 *
 * Thresholds come from docs/market.md and are encoded rather than described, so
 * the claim and the measurement cannot drift apart.
 */

import type { Duel } from "./types.js";
import { round } from "./text.js";

export type Health = "good" | "watch" | "bad" | "unknown";

export interface Criterion {
  id: string;
  label: string;
  /** Null when there is not enough data to say. */
  value: number | null;
  display: string;
  target: string;
  health: Health;
  /** Why this number is the one being watched. */
  note: string;
}

export interface Metrics {
  totalExchanges: number;
  completed: number;
  criteria: Criterion[];
  /** Mean boilerplate of pasted inbound text vs. what our own agents write. */
  inboundMeanSlop: number | null;
  agentMeanSlop: number | null;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Minimum sample below which every criterion reports `unknown` rather than noise. */
const MIN_SAMPLE = 5;

export function computeMetrics(duels: Duel[]): Metrics {
  const total = duels.length;
  const withDigest = duels.filter((d) => d.digest !== null);
  const completed = duels.filter((d) => d.status !== "live").length;

  const compressions = withDigest
    .map((d) => d.digest!.stats.compressionRatio)
    .filter((r) => r > 0);

  const escalated = duels.filter((d) => d.escalations.length > 0).length;
  const bothSeats = duels.filter(
    (d) => d.seats.A.userId !== null && d.seats.B.userId !== null,
  ).length;

  const cleanDigests = withDigest.filter((d) => d.digest!.needsHuman.length === 0).length;
  const turnCounts = duels.map((d) => d.turns.length);

  const enough = total >= MIN_SAMPLE;
  const pct = (n: number) => (total === 0 ? 0 : (n / total) * 100);

  const medianCompression = median(compressions);
  const escalationRate = pct(escalated);
  const secondSeatRate = pct(bothSeats);
  const cleanRate = withDigest.length === 0 ? null : (cleanDigests / withDigest.length) * 100;
  const trend = turnTrend(duels);

  const criteria: Criterion[] = [
    {
      id: "compression",
      label: "Median compression",
      value: medianCompression,
      display: medianCompression === null ? "—" : `${round(medianCompression, 1)}×`,
      target: "> 5×",
      health:
        medianCompression === null || compressions.length < 3
          ? "unknown"
          : medianCompression >= 5
            ? "good"
            : medianCompression >= 2.5
              ? "watch"
              : "bad",
      note: "The core claim. If exchanges do not shrink, the product has failed.",
    },
    {
      id: "clean",
      label: "Exchanges needing nothing from you",
      value: cleanRate,
      display: cleanRate === null ? "—" : `${Math.round(cleanRate)}%`,
      target: "> 30%",
      health:
        cleanRate === null || withDigest.length < 3
          ? "unknown"
          : cleanRate >= 30
            ? "good"
            : cleanRate >= 15
              ? "watch"
              : "bad",
      note: "Digests that closed with an empty needsHuman list. Genuine time saved.",
    },
    {
      id: "escalation",
      label: "Escalation rate",
      value: escalationRate,
      display: `${Math.round(escalationRate)}%`,
      target: "5–20%",
      // Deliberately two-sided. Too low means the gate is asleep; too high
      // means it is noise, and users learn to click through noise.
      health: !enough
        ? "unknown"
        : escalationRate >= 5 && escalationRate <= 20
          ? "good"
          : escalationRate < 5
            ? "watch"
            : "bad",
      note: "Below 5% the gate is asleep. Above 20% it is noise, which is worse.",
    },
    {
      id: "second-seat",
      label: "Second seat claimed",
      value: secondSeatRate,
      display: `${Math.round(secondSeatRate)}%`,
      target: "> 15%",
      health: !enough
        ? "unknown"
        : secondSeatRate >= 15
          ? "good"
          : secondSeatRate >= 5
            ? "watch"
            : "bad",
      note: "Both sides connected. The only real network effect in the product.",
    },
    {
      id: "turn-trend",
      label: "Turns per exchange, trend",
      value: trend,
      display:
        trend === null ? "—" : `${trend > 0 ? "+" : ""}${round(trend, 1)} vs. earlier`,
      target: "flat or falling",
      health: trend === null ? "unknown" : trend <= 0.5 ? "good" : trend <= 1.5 ? "watch" : "bad",
      note: "Rising means we are becoming the problem we set out to solve.",
    },
  ];

  const slopOf = (pred: (author: string) => boolean) =>
    mean(
      duels
        .flatMap((d) => d.turns)
        .filter((t) => pred(t.author) && t.slop !== null)
        .map((t) => t.slop!.score),
    );

  return {
    totalExchanges: total,
    completed,
    criteria,
    inboundMeanSlop: slopOf((a) => a === "unattributed"),
    agentMeanSlop: slopOf((a) => a === "agent"),
  };
}

/**
 * Change in mean turns between the older and newer half of exchanges.
 *
 * Split by creation order rather than a fixed window so it works at any scale.
 * Returns null until there are enough exchanges for the halves to mean anything.
 */
export function turnTrend(duels: Duel[]): number | null {
  if (duels.length < 6) return null;
  const ordered = [...duels].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const half = Math.floor(ordered.length / 2);
  const older = mean(ordered.slice(0, half).map((d) => d.turns.length));
  const newer = mean(ordered.slice(half).map((d) => d.turns.length));
  if (older === null || newer === null) return null;
  return newer - older;
}
