/**
 * @ttmc/core — the relay engine.
 *
 * Deliberately free of I/O: no database, no network, no model calls. TTMC is a
 * relay, not an inference provider, and keeping that boundary visible in the
 * type system is what stops it drifting into being another AI wrapper.
 */

export * from "./types.js";
export * from "./text.js";
export * from "./ids.js";
export * from "./slop.js";
export * from "./provenance.js";
export * from "./persona.js";
export * from "./escalation.js";
export * from "./duel.js";
export * from "./digest.js";
export * from "./metrics.js";
export * from "./detect.js";
