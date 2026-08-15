#!/usr/bin/env node
/**
 * Record `demo.mjs` as a self-contained animated SVG.
 *
 * This is a scene player, not a terminal replay, and that distinction was
 * learned the hard way. The first version faithfully reproduced the scrolling
 * log — 47 lines accumulating over 26 seconds — which was accurate and
 * completely unreadable. A README viewer is watching, not reading: the eye
 * needs one idea at a time, held long enough to finish, in a frame that does
 * not move. So each step gets the screen to itself and then hands it over.
 *
 * Why SVG rather than GIF: it embeds in a GitHub README, stays text (so it
 * diffs and compresses), weighs ~15 KB instead of megabytes, and needs no
 * recorder installed — asciinema and termtosvg are Unix-only and this repo is
 * developed on Windows. GitHub renders SVG through <img>, which runs CSS but
 * blocks scripts, so pure CSS keyframes are the one technique that survives.
 *
 *   pnpm demo:record          # the end-to-end run
 *   pnpm demo:record:slack    # the Slack detect-and-route run
 *
 * Both require `pnpm dev` in another terminal.
 */

import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Each recordable demo, and how its frame should be labelled. */
const TARGETS = {
  demo: {
    script: "demo.mjs",
    out: "../docs/demo-run.svg",
    chrome: "pnpm demo",
    subtitle: "· end-to-end, no inference key",
  },
  slack: {
    script: "slack-demo.mjs",
    out: "../docs/demo-slack.svg",
    chrome: "pnpm demo:slack",
    subtitle: "· detect, then decide",
  },
};

const targetName = process.argv[2] ?? "demo";
const TARGET = TARGETS[targetName];
if (!TARGET) {
  console.error(`unknown target "${targetName}". try: ${Object.keys(TARGETS).join(", ")}`);
  process.exit(1);
}
const OUT = resolve(HERE, TARGET.out);

const COLS = 74;
const FONT = 15;
const CHAR_W = FONT * 0.6;
const LINE_H = 25;
const PAD = 26;
const CHROME = 36;
const HEADER = 46;
const TITLE_H = 34;
/** Fixed body height so scenes never resize the frame as they swap. */
const BODY_LINES = 4;

/** Seconds a scene stays up: enough to read its longest line, plus a beat. */
const BASE_HOLD = 1.7;
const PER_LINE = 0.78;
const FINAL_HOLD = 2.6;

const PALETTE = {
  fg: "#e8eaed",
  bg: "#0e1014",
  frame: "#07080a",
  30: "#5b6371", 31: "#ff5f56", 32: "#35d07f", 33: "#f5a623",
  34: "#6a9fff", 35: "#c678dd", 36: "#35d0d8", 37: "#e8eaed",
  90: "#8b93a1", 91: "#ff8b85", 92: "#6ee9a8", 93: "#ffd479",
  94: "#9dc0ff", 95: "#dda6e8", 96: "#7fe6eb", 97: "#ffffff",
};

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
    for (const raw of m[1].split(";")) {
      const code = Number(raw || "0");
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

const escapeXml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Visible width, ignoring escape codes. */
const visibleLength = (s) => s.replace(/\x1b\[[0-9;]*m/g, "").length;

/**
 * Wrap to COLS, carrying the active colour across the break.
 *
 * SVG text does not wrap on its own, so an unwrapped line simply runs off the
 * side of the frame — visible in the render, invisible in the data, which is
 * how it survived a rewrite. The BODY_LINES guard counts lines AFTER wrapping
 * for the same reason.
 */
function wrap(line) {
  if (visibleLength(line) <= COLS) return [line];

  const out = [];
  let current = "";
  let width = 0;
  let active = "";

  for (const tok of line.split(/(\x1b\[[0-9;]*m|\s+)/).filter((t) => t !== "")) {
    if (/^\x1b\[/.test(tok)) {
      current += tok;
      active = /\[0m$/.test(tok) ? "" : tok;
      continue;
    }
    if (width + tok.length > COLS && width > 0) {
      out.push(current);
      current = `${active}  `;
      width = 2;
      if (/^\s+$/.test(tok)) continue;
    }
    current += tok;
    width += tok.length;
  }
  if (current.trim()) out.push(current);
  return out;
}

function tspans(text) {
  return parseAnsi(text)
    .map((run) => {
      const attrs = [];
      if (run.color) attrs.push(`fill="${run.color}"`);
      if (run.bold) attrs.push(`font-weight="700"`);
      return `<tspan xml:space="preserve" ${attrs.join(" ")}>${escapeXml(run.text)}</tspan>`;
    })
    .join("");
}

/**
 * Keyframes with a visible window. Every offset must be DISTINCT and
 * increasing: when two keyframes share an offset the later one wins, which
 * silently deletes the other and turns an intended step into a long linear
 * fade. That bug shipped once already.
 */
function windowKeyframes(name, startPct, endPct, total) {
  const EPS = 0.01;
  const a = Math.max(0, startPct);
  const b = Math.min(100, endPct);
  const stops = [];

  if (a <= EPS) stops.push(`0%{opacity:1}`);
  else stops.push(`0%,${(a - EPS).toFixed(3)}%{opacity:0}`, `${a.toFixed(3)}%{opacity:1}`);

  if (b >= 100 - EPS) stops.push(`100%{opacity:1}`);
  else stops.push(`${b.toFixed(3)}%{opacity:1}`, `${(b + EPS).toFixed(3)}%,100%{opacity:0}`);

  return (
    `@keyframes ${name}{${stops.join("")}}` +
    `.${name}{opacity:0;animation:${name} ${total}s linear infinite}`
  );
}

function buildSvg(scenes, meta) {
  const width = Math.round(COLS * CHAR_W + PAD * 2);
  const bodyTop = CHROME + HEADER + TITLE_H;
  const height = Math.round(bodyTop + BODY_LINES * LINE_H + PAD + 14);

  // Lay the scenes out on a timeline first; percentages come after.
  let clock = 0;
  const timed = scenes.map((sc, i) => {
    const hold = BASE_HOLD + sc.lines.length * PER_LINE + (i === scenes.length - 1 ? FINAL_HOLD : 0);
    const start = clock;
    clock += hold;
    return { ...sc, start, end: clock };
  });
  const total = clock;

  const css = [];
  const body = [];

  timed.forEach((sc, i) => {
    const startPct = (sc.start / total) * 100;
    const endPct = (sc.end / total) * 100;
    css.push(windowKeyframes(`s${i}`, startPct, endPct, total));

    const parts = [];

    // Step counter and title.
    parts.push(
      `<text x="${PAD}" y="${CHROME + HEADER + 22}" font-size="12" fill="#5b6371" xml:space="preserve">STEP ${sc.n} / ${scenes.length}</text>`,
    );
    parts.push(
      `<text x="${PAD + 84}" y="${CHROME + HEADER + 22}" font-size="15" font-weight="700" fill="${PALETTE[33]}">${escapeXml(sc.title)}</text>`,
    );

    // Body lines, each staggered in slightly so the scene has some life. The
    // stagger multiplies with the scene's own show/hide via group opacity.
    sc.lines.forEach((line, k) => {
      const at = sc.start + 0.28 + k * 0.3;
      const atPct = (at / total) * 100;
      const name = `l${i}_${k}`;
      css.push(windowKeyframes(name, atPct, endPct, total));
      const y = bodyTop + (k + 1) * LINE_H;
      parts.push(`<text class="${name}" x="${PAD}" y="${y}">${tspans(line)}</text>`);
    });

    body.push(`<g class="s${i}">${parts.join("")}</g>`);
  });

  // Progress segments: one per scene, lit while that scene is on screen.
  const segW = (width - PAD * 2) / scenes.length;
  const segY = height - 16;
  const segs = timed
    .map((sc, i) => {
      const x = PAD + i * segW;
      const w = segW - 4;
      return (
        `<rect x="${x.toFixed(1)}" y="${segY}" width="${w.toFixed(1)}" height="3" rx="1.5" fill="#232830"/>` +
        `<rect class="s${i}" x="${x.toFixed(1)}" y="${segY}" width="${w.toFixed(1)}" height="3" rx="1.5" fill="${PALETTE[33]}"/>`
      );
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-monospace,'SF Mono','Cascadia Mono','Roboto Mono',Menlo,Consolas,monospace" font-size="${FONT}">
<style>
${css.join("\n")}
text{fill:${PALETTE.fg};white-space:pre}
</style>
<rect width="${width}" height="${height}" rx="10" fill="${PALETTE.frame}"/>
<rect x="1" y="${CHROME}" width="${width - 2}" height="${height - CHROME - 1}" fill="${PALETTE.bg}"/>
<circle cx="20" cy="18" r="5.5" fill="#ff5f56"/>
<circle cx="39" cy="18" r="5.5" fill="#ffbd2e"/>
<circle cx="58" cy="18" r="5.5" fill="#27c93f"/>
<text x="${width / 2}" y="23" text-anchor="middle" font-size="12" fill="#5b6371">${escapeXml(meta.chrome)}</text>
<text x="${PAD}" y="${CHROME + 28}" font-size="15" font-weight="700" fill="${PALETTE[36]}">talk-to-my-claude<tspan font-weight="400" fill="#5b6371">  ${escapeXml(meta.subtitle)}</tspan></text>
${body.join("\n")}
${segs}
</svg>
`;
}

async function main() {
  const scenes = [];
  let pending = "";
  let done = null;

  const child = spawn(process.execPath, [resolve(HERE, TARGET.script)], {
    env: { ...process.env, TTMC_DEMO_JSON: "1", FORCE_COLOR: "1" },
    stdio: ["ignore", "pipe", "inherit"],
  });

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    pending += chunk;
    const parts = pending.split("\n");
    pending = parts.pop() ?? "";
    for (const raw of parts) {
      if (!raw.trim()) continue;
      let ev;
      try {
        ev = JSON.parse(raw);
      } catch {
        continue;
      }
      if (ev.type === "scene") {
        scenes.push({ n: ev.n, title: ev.title, lines: [] });
        process.stdout.write(`  ${String(ev.n).padStart(2, "0")} ${ev.title}\n`);
      } else if (ev.type === "line" && scenes.length > 0) {
        scenes.at(-1).lines.push(...wrap(ev.text));
      } else if (ev.type === "done") {
        done = ev;
      } else if (ev.type === "fail") {
        process.stderr.write(`FAILED ${ev.text}\n`);
      }
    }
  });

  const code = await new Promise((r) => child.on("close", r));
  if (code !== 0) {
    console.error(`\ndemo exited ${code} — not writing an SVG of a failed run.`);
    process.exit(code);
  }
  if (!done) {
    // Distinct from a failed run, and it means the demo forgot to emit its
    // terminating event — conflating the two sent me hunting the wrong bug.
    console.error(
      `\n${TARGET.script} exited cleanly but never emitted a "done" event, so the run cannot be confirmed complete.`,
    );
    process.exit(1);
  }

  const over = scenes.filter((s) => s.lines.length > BODY_LINES);
  if (over.length > 0) {
    // Silently clipping would make the recording quietly lie about the run.
    console.error(
      `\nscene(s) ${over.map((s) => s.n).join(", ")} exceed BODY_LINES=${BODY_LINES} and would be clipped.`,
    );
    process.exit(1);
  }

  const svg = buildSvg(scenes, { subtitle: TARGET.subtitle, chrome: TARGET.chrome });
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, svg, "utf8");

  console.log(
    `\nwrote ${OUT}  (${scenes.length} scenes, ${(Buffer.byteLength(svg) / 1024).toFixed(1)} KB)`,
  );
}

main();
