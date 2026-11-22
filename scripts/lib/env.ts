import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Reads `.dev.vars` (KEY=value lines, as wrangler does) into process.env, without overriding a variable that is already set.
 * Scripts use this so `npm run db:migrate` works with the same settings the Worker reads in development.
 */
export function loadDevVars(file = join(process.cwd(), ".dev.vars")): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith("#")) continue;
    const value = m[2]!.replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[m[1]!] === undefined) process.env[m[1]!] = value;
  }
}

/** The value of a `--name value` command-line option, or undefined. */
export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

/** A connection string with the password hidden, for messages. */
export const redact = (url: string): string => url.replace(/\/\/([^:/@]+):[^@]*@/, "//$1:****@");
