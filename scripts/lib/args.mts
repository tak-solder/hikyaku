/**
 * コマンドライン引数の解析。
 *
 * --key value / --key=value / --flag（真偽値）に対応する。
 * 値を取らないフラグは BOOLEAN_FLAGS に列挙する（次のトークンを誤って値として
 * 食べてしまわないため）。
 */

import { HikyakuError } from "./errors.mts";

const BOOLEAN_FLAGS = new Set([
  "json",
  "dry-run",
  "help",
  "version",
  "active",
  "all",
  "verbose",
]);

export interface ParsedArgs {
  positional: string[];
  flags: Map<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] as string;

    if (token === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }

    if (!token.startsWith("-")) {
      positional.push(token);
      continue;
    }

    const body = token.replace(/^--?/, "");
    const eq = body.indexOf("=");
    if (eq !== -1) {
      flags.set(body.slice(0, eq), body.slice(eq + 1));
      continue;
    }

    if (BOOLEAN_FLAGS.has(body)) {
      flags.set(body, true);
      continue;
    }

    const next = argv[i + 1];
    if (next === undefined || next.startsWith("-")) {
      flags.set(body, true);
      continue;
    }
    flags.set(body, next);
    i += 1;
  }

  return { positional, flags };
}

export function flagString(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  if (value === undefined) return undefined;
  if (typeof value === "boolean") {
    throw new HikyakuError(`--${name} には値が必要です`);
  }
  return value;
}

export function flagBoolean(args: ParsedArgs, name: string): boolean {
  return args.flags.get(name) === true;
}

export function flagInteger(args: ParsedArgs, name: string): number | undefined {
  const value = flagString(args, name);
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || String(parsed) !== value.trim()) {
    throw new HikyakuError(`--${name} は整数で指定してください（現在: ${value}）`);
  }
  return parsed;
}

/** カンマ区切りのリストを読む（--deps 1,2,3） */
export function flagList(args: ParsedArgs, name: string): string[] | undefined {
  const value = flagString(args, name);
  if (value === undefined) return undefined;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}
