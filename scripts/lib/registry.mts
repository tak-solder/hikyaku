/**
 * コマンドの登録と help の生成。
 *
 * SKILL.md には「いつ、なぜ使うか」だけを書き、「どう使うか」はここに集約する。
 * これにより SKILL.md から引数リファレンスを追い出せる。
 */

import { GLOBAL_FLAGS, type ParsedArgs } from "./args.mts";
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
  /**
   * 受け付けるオプション（グローバルオプション以外、-- を除いた名前）。
   * 宣言したコマンドでは、ここに無いオプションと maxOperands を超える位置引数を
   * 実行前に拒否する。指定したつもりの値が黙って落ちたまま書き込みが成功するのを防ぐ
   */
  options?: readonly string[];
  /** 受け付ける位置引数の最大数（options を宣言したときだけ使う。既定 0） */
  maxOperands?: number;
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

/**
 * options を宣言したコマンドについて、不明なオプションと余分な位置引数を拒否する。
 *
 * parseArgs は知らないオプションも受け取るため、ここで弾かないと
 * "--deps 1,2"（空白を含む1引数）や --depz のタイプミスが黙って無視される。
 */
export function assertArguments(command: Command, args: ParsedArgs, operands: string[]): void {
  const options = command.options;
  if (options === undefined) return;

  for (const flag of args.flags.keys()) {
    if (GLOBAL_FLAGS.has(flag) || options.includes(flag)) continue;
    const joined = /^(\S+)\s+(.+)$/.exec(flag);
    const hint =
      joined && (GLOBAL_FLAGS.has(joined[1] as string) || options.includes(joined[1] as string))
        ? `オプションと値が1つの引数で渡されています。--${joined[1]} と ${joined[2]} を別の引数に分けるか、--${joined[1]}=${joined[2]} の形で渡してください。`
        : `使用できるオプション: ${options.length === 0 ? "（グローバルオプションのみ）" : options.map((o) => `--${o}`).join(" ")}`;
    throw new HikyakuError(`不明なオプションです: --${flag}`, `${hint}\n使い方: ${command.usage}`);
  }

  const maxOperands = command.maxOperands ?? 0;
  if (operands.length > maxOperands) {
    throw new HikyakuError(
      `余分な引数があります: ${operands.slice(maxOperands).map((o) => JSON.stringify(o)).join(" ")}`,
      `使い方: ${command.usage}`,
    );
  }
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
    "  --profile <name>   profile を上書きする（express | economy | standard | thorough）",
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
    lines.push(`  ${command.name.padEnd(22)}${command.summary}`);
  }
  for (const list of grouped.values()) {
    lines.push("");
    for (const command of list) {
      lines.push(`  ${command.name.padEnd(22)}${command.summary}`);
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
    lines.push(`  ${command.name.padEnd(22)}${command.summary}`);
  }
  return lines.join("\n");
}
