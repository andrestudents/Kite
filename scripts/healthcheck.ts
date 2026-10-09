// Kite repo health check — contract: specs/001-monorepo-scaffold/contracts/health-check.md
// Exit codes: 0 all ok · 1 workspace failure · 2 missing prerequisite.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";

type UnitStatus = "ok" | "FAIL";

interface Line {
  kind: "prereq" | "ws";
  name: string;
  status: UnitStatus;
  detail: string;
}

const ROOT = process.cwd();

const PREREQS = ["bun", "forge"] as const;

// PLAN §10 order.
const WORKSPACES: Array<{ path: string; membership: "bun-workspace" | "foundry" }> = [
  { path: "apps/web", membership: "bun-workspace" },
  { path: "apps/api", membership: "bun-workspace" },
  { path: "apps/relayer", membership: "bun-workspace" },
  { path: "apps/indexer", membership: "bun-workspace" },
  { path: "apps/orchestration", membership: "bun-workspace" },
  { path: "contracts", membership: "foundry" },
  { path: "packages/contracts", membership: "bun-workspace" },
  { path: "packages/core", membership: "bun-workspace" },
  { path: "packages/tsconfig", membership: "bun-workspace" },
];

function toolVersion(tool: string): { status: UnitStatus; detail: string } {
  const res = spawnSync(tool, ["--version"], { encoding: "utf8" });
  if (res.error) {
    return { status: "FAIL", detail: "missing prerequisite" };
  }
  const first = (res.stdout ?? "").trim().split("\n")[0] ?? "";
  return { status: res.status === 0 ? "ok" : "FAIL", detail: first };
}

function globMatches(glob: string, rel: string): boolean {
  const g = glob.split("/");
  const p = rel.split("/");
  if (g.length !== p.length) return false;
  return g.every((seg, i) => (seg === "*" ? p[i] !== undefined && p[i] !== "" : seg === p[i]));
}

function bunWorkspaceGlobs(): string[] {
  try {
    const rootPkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      workspaces?: string[];
    };
    return rootPkg.workspaces ?? [];
  } catch {
    return [];
  }
}

function checkBunWorkspace(rel: string, globs: string[]): { status: UnitStatus; detail: string } {
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs)) {
    return { status: "FAIL", detail: "directory missing" };
  }
  const pkgPath = path.join(abs, "package.json");
  if (!existsSync(pkgPath)) {
    return { status: "FAIL", detail: "missing package.json" };
  }
  try {
    JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch {
    return { status: "FAIL", detail: "package.json unparseable" };
  }
  if (!globs.some((g) => globMatches(g, rel))) {
    return { status: "FAIL", detail: "not resolved by root workspaces" };
  }
  return { status: "ok", detail: "package.json resolves" };
}

function checkFoundry(prereqsOk: boolean): { status: UnitStatus; detail: string } {
  if (!existsSync(path.join(ROOT, "contracts", "foundry.toml"))) {
    return { status: "FAIL", detail: "foundry.toml missing" };
  }
  if (!prereqsOk) {
    return { status: "FAIL", detail: "prerequisite forge missing" };
  }
  const res = spawnSync("forge", ["build", "--root", path.join(ROOT, "contracts")], {
    encoding: "utf8",
  });
  if (res.error || res.status !== 0) {
    return { status: "FAIL", detail: `forge build exited ${res.status ?? "signal"}` };
  }
  return { status: "ok", detail: "forge build" };
}

const lines: Line[] = [];
let missingPrereq = false;

for (const tool of PREREQS) {
  const { status, detail } = toolVersion(tool);
  lines.push({ kind: "prereq", name: tool, status, detail });
  if (status === "FAIL") missingPrereq = true;
}

const globs = bunWorkspaceGlobs();
for (const ws of WORKSPACES) {
  const result =
    ws.membership === "foundry" ? checkFoundry(!missingPrereq) : checkBunWorkspace(ws.path, globs);
  lines.push({ kind: "ws", name: ws.path, status: result.status, detail: result.detail });
}

for (const line of lines) {
  const kind = line.kind.padEnd(6);
  const name = line.name.padEnd(20);
  console.log(`${kind} ${name} ${line.status.padEnd(4)} ${line.detail}`);
}

const okCount = lines.filter((l) => l.kind === "ws" && l.status === "ok").length;
const total = lines.filter((l) => l.kind === "ws").length;
console.log(`${okCount}/${total} workspaces ok`);

const anyWsFail = okCount < total;
process.exit(missingPrereq ? 2 : anyWsFail ? 1 : 0);
