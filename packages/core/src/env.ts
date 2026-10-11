// Feature-004 guard pattern (contracts/script/KiteScriptCommon.s.sol `_req`):
// abort by NAME — never print any value. Services compose their own required
// sets on top of these primitives.
import { KiteError } from "./errors.js";

export class EnvMissing extends KiteError {
  constructor(name: string) {
    super("env_missing", `EnvMissing(${name})`);
    this.name = "EnvMissing";
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) throw new EnvMissing(name);
  return value;
}

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}
