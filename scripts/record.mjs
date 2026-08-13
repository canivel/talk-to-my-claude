#!/usr/bin/env node
/**
 * Record `demo.mjs` as a self-contained animated SVG.
 *
 * Why an SVG rather than a GIF: it embeds in a GitHub README, stays text (so
 * it diffs and compresses), weighs a few tens of KB instead of megabytes, and
 * needs no recorder installed — which matters because the usual tools
 * (asciinema, termtosvg) are Unix-only and this repo is developed on Windows.
 *
 * Animation is pure CSS keyframes. GitHub renders SVG through <img>, which
 * runs CSS but blocks scripts, so this is the one animation technique that
 * actually survives.
 *
 *   pnpm demo:record        # requires `pnpm dev` in another terminal
 */

import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../docs/demo-run.svg");

// Terminal geometry. COLS is enforced by wrapping, so a long line can never
// blow out the viewBox and shrink the whole recording in the README.
const COLS = 104;
const FONT = 14;
const CHAR_W = FONT * 0.6;
const LINE_H = FONT * 1.45;
const PAD = 18;
const CHROME = 34;

/** One-dark-ish palette, tuned to match the app's own colours. */
const PALETTE = {
  fg: "#e8eaed",
  bg: "#0e1014",
  frame: "#07080a",
  30: "#5b6371", 31: "#ff5f56", 32: "#35d07f", 33: "#f5a623",
  34: "#6a9fff", 35: "#c678dd", 36: "#35d0d8", 37: "#e8eaed",
  90: "#8b93a1", 91: "#ff8b85", 92: "#6ee9a8", 93: "#ffd479",
  94: "#9dc0ff", 95: "#dda6e8", 96: "#7fe6eb", 97: "#ffffff",
};

/** Split an ANSI-coloured string into styled runs. */
function parseAnsi(line) {
  const runs = [];
  let color = null;
  let bold = false;
  let buf = "";

  const flush = () => {
    if (buf) runs.push({ text: buf, color, bold });
    buf = "";
  };

  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  let m;
  while ((m = re.exec(line)) !== null) {
    buf += line.slice(last, m.index);
    flush();
    last = re.lastIndex;
    for (const codeStr of m[1].split(";")) {
      const code = Number(codeStr || "0");
      if (code === 0) {
        color = null;
        bold = false;
      } else if (code === 1) bold = true;
      else if (code === 22) bold = false;
      else if (PALETTE[code]) color = PALETTE[code];
    }
  }
  buf += line.slice(last);
  flush();
  return runs;
}

/** Visible width, ignoring escape codes. */
const visibleLength = (s) => s.replace(/\x1b\[[0-9;]*m/g, "").length;

/**
 * Wrap to COLS while preserving the active colour across the break, so a
 * wrapped line does not lose its styling halfway through.
 */
function wrap(line) {
  if (visibleLength(line) <= COLS) return [line];

  const out = [];
  let current = "";
  let width = 0;
  let active = "";

  const tokens = line.split(/(\x1b\[[0-9;]*m|\s+)/).filter((t) => t !== "");
  for (const tok of tokens) {
    if (/^\x1b\[/.test(tok)) {
      current += tok;
      active = /\[0m$/.test(tok) ? "" : tok;
      continue;
    }
    const w = tok.length;
    if (width + w > COLS && width > 0) {
      out.push(current);
      current = active + "   ";
      width = 3;
      if (/^\s+$/.test(tok)) continue;
    }
    current += tok;
    width += w;
  }
  if (current.trim()) out.push(current);
  return out;
}

const escapeXml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function buildSvg(frames) {
  const rows = frames.length;
  const width = Math.round(COLS * CHAR_W + PAD * 2);
  const height = Math.round(rows * LINE_H + PAD * 2 + CHROME);

  // Total runtime, plus a hold so the finished screen is readable before loop.
  const HOLD = 4;
  const total = (frames.at(-1)?.t ?? 1) + HOLD;

  const css = [];
  const body = [];

  frames.forEach((frame, i) => {
    const pct = (frame.t / total) * 100;
    // The two offsets must be DISTINCT. Writing `0%,P%{opacity:0}P%,...{opacity:1}`
    // looks like a step but is not: when two keyframes declare the same offset,
    // the later one wins, so the P% opacity:0 entry is discarded and the list
    // collapses to 0%→0, P%→1 — which `linear` then interpolates into a long
    // fade. Every line ends up ghosting in simultaneously from t=0. A hair of
    // separation makes the transition genuinely instantaneous.
    const off = pct.toFixed(3);
    const on = Math.min(100, pct + 0.01).toFixed(3);
    css.push(
      `@keyframes r${i}{0%,${off}%{opacity:0}${on}%,100%{opacity:1}}` +
        `.r${i}{opacity:0;animation:r${i} ${total}s linear infinite}`,
    );

    const y = (PAD + CHROME + (i + 1) * LINE_H).toFixed(1);
    const spans = parseAnsi(frame.text)
      .map((run) => {
        const attrs = [];
        if (run.color) attrs.push(`fill="${run.color}"`);
        if (run.bold) attrs.push(`font-weight="700"`);
        // xml:space keeps the leading indentation that carries the layout.
        return `<tspan xml:space="preserve" ${attrs.join(" ")}>${escapeXml(run.text)}</tspan>`;
      })
      .join("");

    body.push(`<text class="r${i}" x="${PAD}" y="${y}">${spans}</text>`);
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-monospace,'SF Mono','Cascadia Mono','Roboto Mono',Menlo,Consolas,monospace" font-size="${FONT}">
<style>
${css.join("\n")}
text{fill:${PALETTE.fg};white-space:pre}
</style>
<rect width="${width}" height="${height}" rx="10" fill="${PALETTE.frame}"/>
<rect x="1" y="${CHROME}" width="${width - 2}" height="${height - CHROME - 1}" fill="${PALETTE.bg}"/>
<circle cx="20" cy="17" r="5.5" fill="#ff5f56"/>
<circle cx="39" cy="17" r="5.5" fill="#ffbd2e"/>
<circle cx="58" cy="17" r="5.5" fill="#27c93f"/>
<text x="${width / 2}" y="22" text-anchor="middle" font-size="12" fill="#5b6371">pnpm demo</text>
${body.join("\n")}
</svg>
`;
}

async function main() {
  const frames = [];
  const started = Date.now();
  let pending = "";

  const child = spawn(process.execPath, [resolve(HERE, "demo.mjs")], {
    env: { ...process.env, FORCE_COLOR: "1" },
    stdio: ["ignore", "pipe", "inherit"],
  });

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
    pending += chunk;
    const parts = pending.split("\n");
    pending = parts.pop() ?? "";
    // Timestamp at line completion — close enough to real pacing, and it
    // keeps the SVG line-based rather than character-based (much smaller).
    const t = (Date.now() - started) / 1000;
    for (const raw of parts) {
      for (const line of wrap(raw.replace(/\r/g, ""))) {
        frames.push({ t, text: line });
      }
    }
  });

  const code = await new Promise((r) => child.on("close", r));
  if (code !== 0) {
    console.error(`\ndemo exited ${code} — not writing an SVG of a failed run.`);
    process.exit(code ?? 1);
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, buildSvg(frames), "utf8");

  const kb = (Buffer.byteLength(buildSvg(frames)) / 1024).toFixed(1);
  console.log(`\nwrote ${OUT}  (${frames.length} lines, ${kb} KB)`);
}

main();
