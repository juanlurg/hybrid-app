/**
 * Browser walkthrough. Signs up a throwaway athlete, onboards, then visits
 * every screen on both a phone and a desktop viewport, failing on any
 * console error, any 4xx/5xx, or any Next.js error overlay.
 *
 *   npm run dev            # in another terminal
 *   npx tsx scripts/walkthrough.ts [--shots]
 */

import { chromium, type ConsoleMessage, type Page } from "playwright";
import { mkdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.WALKTHROUGH_URL ?? "http://localhost:3000";
const SHOTS = process.argv.includes("--shots");
const SHOT_DIR = resolve(process.cwd(), ".walkthrough");

function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* env already set */
  }
}
loadEnv();

const problems: string[] = [];
let visited = 0;

/** Noise that is not a defect: dev-only warnings and favicon 404s. */
const IGNORE = [
  /Download the React DevTools/i,
  /favicon/i,
  /Fast Refresh/i,
  /\[Fast Refresh\]/i,
  /webpack-hmr/i,
  /Failed to load resource.*manifest/i,
];

function watch(page: Page, label: string) {
  const onConsole = (msg: ConsoleMessage) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (IGNORE.some((r) => r.test(text))) return;
    problems.push(`[${label}] console: ${text}`);
  };
  const onPageError = (err: Error) => {
    problems.push(`[${label}] uncaught: ${err.message}`);
  };
  const onResponse = (res: { status: () => number; url: () => string }) => {
    const status = res.status();
    const url = res.url();
    if (status < 400) return;
    if (IGNORE.some((r) => r.test(url))) return;
    problems.push(`[${label}] ${status} ${url.replace(BASE, "")}`);
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("response", onResponse);
  return () => {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    page.off("response", onResponse);
  };
}

/**
 * Text the same colour as what it sits on.
 *
 * This exists because an unlayered `button { color: inherit }` in
 * globals.css once beat every `text-*` utility in `@layer utilities`,
 * turning every button label black-on-black. It typechecked, it linted,
 * it built, and the only way to catch it was to look.
 */
async function invisibleText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    // Let the browser do the colour conversion: computed styles come back
    // as rgb(), lab() or oklch() depending on the property and gamut, and
    // hand-parsing that is how you end up comparing 0.62 to 158.
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const paint = canvas.getContext("2d", { willReadFrequently: true })!;

    const parse = (css: string): [number, number, number, number] => {
      paint.clearRect(0, 0, 1, 1);
      paint.fillStyle = "#000000";
      paint.fillStyle = css; // invalid values leave the previous fill
      paint.fillRect(0, 0, 1, 1);
      const d = paint.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3] / 255];
    };
    const luminance = ([r, g, b]: number[]) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    /** Walk up until something actually paints a background. */
    const backdrop = (el: Element): number[] => {
      let node: Element | null = el;
      while (node) {
        const bg = parse(getComputedStyle(node).backgroundColor);
        if (bg[3] > 0.1) return bg;
        node = node.parentElement;
      }
      return [255, 255, 255, 1];
    };

    const hits: string[] = [];
    const seen = new Set<string>();

    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      const text = (el.textContent ?? "").trim();
      if (!text || text.length > 60) continue;
      // Only leaf-ish nodes, so we blame the element that owns the text.
      if (el.children.length > 0) continue;

      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;
      if (parseFloat(style.opacity) < 0.15) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;

      const fg = parse(style.color);
      if (fg[3] < 0.15) continue;
      const bg = backdrop(el);

      const l1 = luminance(fg);
      const l2 = luminance(bg);
      const contrast =
        (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

      // 1.6:1 is far below WCAG; this only catches text that is
      // effectively unreadable, not merely low-contrast.
      if (contrast < 1.6) {
        const key = `${text}|${style.color}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push(
          `"${text}" ${style.color} on rgb(${bg.slice(0, 3).join(", ")}) — ${contrast.toFixed(2)}:1`,
        );
      }
    }
    return hits.slice(0, 8);
  });
}

async function visit(page: Page, path: string, viewport: string) {
  const label = `${viewport} ${path}`;
  const stop = watch(page, label);
  try {
    const res = await page.goto(`${BASE}${path}`, {
      waitUntil: "networkidle",
      timeout: 45_000,
    });
    if (res && res.status() >= 400) {
      problems.push(`[${label}] navigation returned ${res.status()}`);
    }

    // Next's dev error overlay.
    const overlay = await page.locator("nextjs-portal").count();
    if (overlay > 0) {
      const text = await page.locator("nextjs-portal").innerText().catch(() => "");
      if (/error/i.test(text)) {
        problems.push(`[${label}] error overlay: ${text.slice(0, 300)}`);
      }
    }

    const body = (await page.locator("body").innerText().catch(() => "")) ?? "";
    if (body.trim().length < 20) {
      problems.push(`[${label}] rendered almost nothing`);
    }
    if (/Application error|Unhandled Runtime Error|Internal Server Error/i.test(body)) {
      problems.push(`[${label}] error page: ${body.slice(0, 200)}`);
    }

    // No page should scroll sideways.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (overflow > 2) {
      problems.push(`[${label}] horizontal overflow of ${overflow}px`);
    }

    for (const hit of await invisibleText(page)) {
      problems.push(`[${label}] invisible text: ${hit}`);
    }

    if (SHOTS) {
      mkdirSync(SHOT_DIR, { recursive: true });
      const name = `${viewport}${path.replace(/\//g, "_") || "_home"}.png`;
      await page.screenshot({ path: resolve(SHOT_DIR, name), fullPage: true });
    }

    visited += 1;
    console.log(`  ok   ${label}`);
  } catch (error) {
    problems.push(`[${label}] threw: ${(error as Error).message}`);
    console.log(`  FAIL ${label}`);
  } finally {
    stop();
  }
}

async function main() {
  const browser = await chromium.launch();
  const email = `walk-${Date.now()}@bloques.test`;
  const password = "correcthorsebatterystaple";

  const context = await browser.newContext({
    viewport: { width: 412, height: 892 },
    deviceScaleFactor: 2,
  });

  // tsx compiles with esbuild's `keepNames`, which wraps every named
  // function in a `__name(...)` call. That helper does not exist inside
  // the page, so any evaluate() carrying a named inner function throws.
  await context.addInitScript(() => {
    (globalThis as unknown as { __name: (fn: unknown) => unknown }).__name = (
      fn: unknown,
    ) => fn;
  });

  const page = await context.newPage();

  console.log("Sign up");
  const stopSignup = watch(page, "phone /registro");
  await page.goto(`${BASE}/registro`, { waitUntil: "networkidle" });
  await page.fill('input[name="display_name"]', "Walkthrough");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([
    page.waitForURL(/\/onboarding/, { timeout: 45_000 }),
    page.click('button[type="submit"]'),
  ]);
  stopSignup();
  console.log("  ok   redirected to /onboarding");

  console.log("\nOnboarding");
  const stopOnboard = watch(page, "phone /onboarding");
  await page.fill('input[name="starts_on"]', "2026-09-14");
  await page.fill('input[name="lthr"]', "168");
  await page.fill('input[name="body_weight_kg"]', "80");
  await Promise.all([
    page.waitForURL((url) => new URL(url).pathname === "/", { timeout: 60_000 }),
    page.click('button[type="submit"]'),
  ]);
  stopOnboard();
  console.log("  ok   landed on Hoy");

  // Proof the engine reached the screen: F2 week 1, hip thrust basic.
  const hoyText = await page.locator("body").innerText();
  const weightMatch = hoyText.match(/(\d+[,.]?\d*)\s*\n?\s*KG/i);
  console.log(
    `  ok   Hoy shows a working weight: ${weightMatch?.[1] ?? "(none found)"}`,
  );
  if (!weightMatch) problems.push("[phone /] no working weight rendered");

  const ROUTES = [
    "/",
    "/semana",
    "/progreso",
    "/programa",
    "/historial",
    "/editor",
    "/ajustes",
    "/movilidad",
    "/generar",
    "/carrera/2026-09-15",
  ];

  console.log("\nPhone 412×892");
  for (const route of ROUTES) await visit(page, route, "phone");

  console.log("\nDesktop 1440×900");
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const route of ROUTES) await visit(page, route, "desktop");

  console.log("\nSession runner");
  await page.setViewportSize({ width: 412, height: 892 });
  const stopRunner = watch(page, "phone session");
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  const startButton = page.getByRole("button", { name: /empezar sesión/i });
  if ((await startButton.count()) > 0) {
    await Promise.all([
      page.waitForURL(/\/sesion\//, { timeout: 45_000 }),
      startButton.first().click(),
    ]);
    console.log("  ok   session started");

    const done = page.getByRole("button", { name: /^hecho/i });
    await done.first().click();
    await page.waitForTimeout(1200);

    const runnerText = await page.locator("body").innerText();
    if (!/1\/\d+ series|1 \/ \d+/.test(runnerText.replace(/\s+/g, " "))) {
      console.log("  note  set counter text not matched; continuing");
    }
    console.log("  ok   logged a set");

    // Rest timer should have appeared.
    if (!/DESCANSO/i.test(runnerText)) {
      problems.push("[phone session] rest timer did not appear after a set");
    } else {
      console.log("  ok   rest timer running");
    }
    if (SHOTS) {
      mkdirSync(SHOT_DIR, { recursive: true });
      await page.screenshot({ path: resolve(SHOT_DIR, "phone_sesion.png"), fullPage: true });
    }
    visited += 1;
  } else {
    problems.push("[phone /] no start button on Hoy");
  }
  stopRunner();

  await browser.close();

  console.log(
    `\n${visited} screens visited, ${problems.length} problems` +
      (problems.length ? `\n\n${problems.map((p) => `  · ${p}`).join("\n")}\n` : "\n"),
  );
  process.exit(problems.length ? 1 : 0);
}

main().catch((error) => {
  console.error("\nwalkthrough threw:", error);
  process.exit(1);
});
