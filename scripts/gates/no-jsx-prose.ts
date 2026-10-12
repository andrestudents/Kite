// T005 — the catalogs-only string gate (research D6, FR-021): user-facing
// prose lives in the locale catalogs (apps/web/src/locales/*), nowhere else.
// Scans apps/web/src:
//   (a) raw prose in screens/** JSX text nodes — one-line `>text<` spans AND
//       standalone prose lines (multiline text nodes); interpolation-only JSX
//       ({locale.x.y}) is exempt; prose string literals at toast/banner/error
//       call-sites in screens/** also fail (catalog + interpolate, never
//       inline copy). Attribute-technical literals (className, href, …) are
//       exempt; user-facing attributes (alt/title/placeholder/value) are NOT.
//   (b) zero dangerouslySetInnerHTML under screens/** (research D10).
//   (c) zero banned words (wallet/gas/chain/token/seed/pending/"onchain
//       transaction") in ANY string literal outside locales/ — tests and
//       template ${expressions} (code paths, like keys/enums) exempt.
// Exit 0 with evidence / exit 1 listing file:line. Grown by every screen task.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = "apps/web/src";
const SCREENS = `${SRC}/screens`;
const LOCALES = `${SRC}/locales`;

const BANNED = /\b(wallet|gas|chain|token|seed|pending)\b|onchain transaction/i;
const LETTER_RUN = /[A-Za-z]{2,}/;
const CODE_PUNCT = /[<>{}()[\];=`"'\\]/;
const BARE_WORD = /^[A-Za-zÀ-ÿ'’.,!?%…—-]+$/;
const FIRST_TOKENS = new Set([
  "import",
  "export",
  "from",
  "return",
  "case",
  "default",
  "await",
  "async",
]);
// Technical attributes may hold identifiers; user-facing ones may not hold
// prose (alt/title/placeholder/value must come from the catalogs too).
const ATTR_EXEMPT =
  /\b(className|style|key|type|id|href|src|for|role|target|rel|method|action|viewBox|fill|stroke|points|width|height|xmlns|data-[a-zA-Z-]*|aria-[a-zA-Z-]*)\s*=/;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(path);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      yield path;
    }
  }
}

const problems: string[] = [];
function flag(file: string, lineNo: number, rule: string, text: string): void {
  problems.push(`${file}:${lineNo} [${rule}] ${text.trim()}`);
}

/** All string literals on one line, with their quote kind. */
function literalsOn(line: string): Array<{ quote: string; content: string }> {
  const out: Array<{ quote: string; content: string }> = [];
  const re = /(?<!\\)(["'`])((?:\\.|(?!\1).)*)\1/g;
  for (const m of line.matchAll(re)) {
    out.push({ quote: m[1], content: m[2] });
  }
  return out;
}

/** Template ${...} expressions are code paths (keys/enums exemption). */
function stripTemplateExprs(content: string, quote: string): string {
  return quote === "`" ? content.replace(/\$\{[^}]*\}/g, " ") : content;
}

function isProse(content: string): boolean {
  const alpha = content.split(/\s+/).filter((t) => /^[A-Za-zÀ-ÿ]{2,}[.,!?…()]*$/.test(t));
  return alpha.length >= 2;
}

for (const file of walk(SRC)) {
  const underScreens = file.startsWith(`${SCREENS}/`);
  const underLocales = file.startsWith(`${LOCALES}/`);
  // Test files are not shipped UI — none of the rules target them (they may
  // quote banned copy in guard assertions and prose in doc comments).
  const isTest = /\.test\.(ts|tsx)$/.test(file);
  const lines = readFileSync(file, "utf8").split("\n");
  let inBlockComment = false;

  lines.forEach((line, i) => {
    const lineNo = i + 1;
    if (isTest) return;

    // Comments are prose by nature but never rendered — skip them wholesale
    // (a `code // note` line still scans its code part; only full-comment
    // lines and block-comment spans are dropped).
    const trimmed0 = line.trim();
    if (inBlockComment) {
      if (trimmed0.includes("*/")) inBlockComment = false;
      return;
    }
    if (trimmed0.startsWith("//") || trimmed0.startsWith("*")) return;
    if (trimmed0.startsWith("/*")) {
      if (!trimmed0.includes("*/")) inBlockComment = true;
      return;
    }

    // (a1) one-line JSX text spans: >prose< — prose means a lowercase word
    // (type generics like Promise<void> are CamelCase single tokens).
    if (underScreens && file.endsWith(".tsx")) {
      for (const m of line.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)) {
        const cap = m[1];
        // a word STARTING lowercase marks prose (type generics like
        // Promise<void> are single CamelCase tokens, never prose)
        const lowerWord = /\b[a-zà-ÿ]{2,}/.test(cap);
        const words = cap.split(/\s+/).filter((t) => LETTER_RUN.test(t));
        if (lowerWord || words.length >= 2) {
          flag(file, lineNo, "jsx-prose", `raw JSX text: "${cap.trim()}"`);
        }
      }
      // (a2) standalone prose lines (multiline JSX text nodes)
      const trimmed = line.trim();
      if (
        trimmed.length > 0 &&
        !CODE_PUNCT.test(line) &&
        !trimmed.startsWith("//") &&
        !trimmed.startsWith("*") &&
        !trimmed.startsWith("/*")
      ) {
        const tokens = trimmed.split(/\s+/);
        const first = tokens[0] ?? "";
        const words = tokens.filter((t) => BARE_WORD.test(t) && LETTER_RUN.test(t));
        if (words.length >= 2 && !FIRST_TOKENS.has(first)) {
          flag(file, lineNo, "jsx-prose-line", trimmed);
        }
      }
    }

    // Module specifiers (import/export) are machine identifiers — the word
    // "chain" in a path says nothing about user-facing copy.
    const isModuleStmt = /^(import|export)\b/.test(trimmed0) || /^import\(/.test(trimmed0);
    for (const { quote, content } of literalsOn(line)) {
      // (a3) prose literals at call-sites under screens/** (toast/banner/…)
      if (
        underScreens &&
        !isModuleStmt &&
        !ATTR_EXEMPT.test(line) &&
        isProse(stripTemplateExprs(content, quote))
      ) {
        flag(file, lineNo, "literal-prose", content.trim());
      }
      // (c) banned words in any literal outside locales/
      if (!isModuleStmt && !underLocales && BANNED.test(stripTemplateExprs(content, quote))) {
        flag(file, lineNo, "banned-word", content.trim());
      }
    }

    // (b) no inline HTML injection under screens/**
    if (underScreens && line.includes("dangerouslySetInnerHTML")) {
      flag(file, lineNo, "no-inner-html", line.trim());
    }
  });
}

if (problems.length > 0) {
  console.log(`== no-jsx-prose: FAIL (${problems.length}) ==`);
  for (const p of problems) {
    console.log(p);
  }
  process.exit(1);
}
console.log("PASS (a) screens/** JSX text is catalogs/interpolation only");
console.log("PASS (b) zero dangerouslySetInnerHTML under screens/**");
console.log("PASS (c) zero banned words in string literals outside locales/");
console.log("== no-jsx-prose: PASS ==");
