/**
 * コマンドの登録と help の生成。
 *
 * SKILL.md には「いつ、なぜ使うか」だけを書き、「どう使うか」はここに集約する。
 * これにより SKILL.md から引数リファレンスを追い出せる。
 */

import type { ParsedArgs } from "./args.mts";
import { HikyakuError } from "./errors.mts";

export interface CommandContext {
  args: ParsedArgs;
  /** サブコマンド名を除いた位置引数 */
  operands: string[];
}

export interface Command {
  /** "cycle new" のようにスペース区切りのフルネーム */
  name: string;
  summary: string;
  usage: string;
  /** help <command> で表示する詳細（オプション一覧・出力例など） */
  details?: string;
  /** 書き込みを伴うか（--dry-run に対応すべきコマンド） */
  writes?: boolean;
  run: (ctx: CommandContext) => void | Promise<void>;
}

const commands = new Map<string, Command>();

export function register(command: Command): void {
  commands.set(command.name, command);
}

export function allCommands(): Command[] {
  return [...commands.values()];
}

/**
 * 位置引数からコマンドを解決する。
 * 2語コマンド（"cycle new"）を優先し、無ければ1語コマンドを探す。
 */
export function resolveCommand(positional: string[]): { command: Command; operands: string[] } {
  const two = positional.slice(0, 2).join(" ");
  if (positional.length >= 2 && commands.has(two)) {
    return { command: commands.get(two) as Command, operands: positional.slice(2) };
  }
  const one = positional[0];
  if (one !== undefined && commands.has(one)) {
    return { command: commands.get(one) as Command, operands: positional.slice(1) };
  }
  if (one === undefined) {
    throw new HikyakuError("コマンドが指定されていません", "hikyaku help で一覧を表示します。");
  }

  const siblings = namespaceOf(one);
  if (siblings.length > 0) {
    throw new HikyakuError(
      `${one} のサブコマンドを指定してください`,
      `使用できるサブコマンド: ${siblings.map((c) => c.name.split(" ")[1]).join(" / ")}`,
    );
  }
  throw new HikyakuError(`不明なコマンドです: ${positional.join(" ")}`, "hikyaku help で一覧を表示します。");
}

function namespaceOf(prefix: string): Command[] {
  return allCommands().filter((c) => c.name.startsWith(`${prefix} `));
}

/** 全体の help */
export function renderOverview(version: string): string {
  const lines = [
    `hikyaku ${version} — Hikyaku ワークフローの決定的な処理を担う CLI`,
    "",
    "使い方:",
    "  node <plugin>/scripts/hikyaku.mts <command> [options]",
    "",
    "グローバルオプション:",
    "  --root <path>      HIKYAKU_ROOT を明示指定する",
    "  --profile <name>   profile を上書きする（light | saving | standard | strict）",
    "  --json             機械可読な JSON で出力する",
    "  --dry-run          書き込みを行わず、何が起きるかだけを表示する",
    "  --help             ヘルプを表示する",
    "",
    "コマンド:",
  ];

  const top: Command[] = [];
  const grouped = new Map<string, Command[]>();
  for (const command of allCommands()) {
    const [head, tail] = command.name.split(" ");
    if (tail === undefined) {
      top.push(command);
    } else {
      const list = grouped.get(head as string) ?? [];
      list.push(command);
      grouped.set(head as string, list);
    }
  }

  for (const command of top) {
    lines.push(`  ${command.name.padEnd(18)}${command.summary}`);
  }
  for (const list of grouped.values()) {
    lines.push("");
    for (const command of list) {
      lines.push(`  ${command.name.padEnd(18)}${command.summary}`);
    }
  }

  lines.push("", "個別のヘルプ:", "  hikyaku help <command>");
  return lines.join("\n");
}

/** 個別コマンドの help */
export function renderCommandHelp(command: Command): string {
  const lines = [command.summary, "", "使い方:", `  ${command.usage}`];
  if (command.details) {
    lines.push("", command.details.trimEnd());
  }
  if (command.writes) {
    lines.push("", "このコマンドはファイルを書き換えます。--dry-run で差分だけを確認できます。");
  }
  return lines.join("\n");
}

/** 名前空間の help */
export function renderNamespaceHelp(prefix: string): string | undefined {
  const list = namespaceOf(prefix);
  if (list.length === 0) return undefined;
  const lines = [`${prefix} コマンド:`, ""];
  for (const command of list) {
    lines.push(`  ${command.name.padEnd(18)}${command.summary}`);
  }
  return lines.join("\n");
}
