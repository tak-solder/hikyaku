#!/usr/bin/env node
/**
 * Hikyaku CLI — ワークフローの決定的な処理を担う。
 *
 *   スクリプト = 計算・解析・整形・検証
 *   LLM        = 判断・生成・対話
 *
 * 承認はこのスクリプトでは扱わない。書き込みコマンドは --dry-run で
 * 「何が起きるか」を返し、承認を取るのは常に呼び出し元のスキル。
 *
 * スキルからの呼び出しは Windows と古い Node を考慮して node 経由で統一する:
 *   node "${CLAUDE_PLUGIN_ROOT}/scripts/hikyaku.mts" <command>
 */

import { flagBoolean, parseArgs } from "./lib/args.mts";
import { EXIT_ERROR, EXIT_OK, EXIT_VALIDATION, HikyakuError, ValidationError } from "./lib/errors.mts";
import { isJsonMode, setJsonMode } from "./lib/output.mts";
import { pluginVersion } from "./lib/paths.mts";
import { renderCommandHelp, renderOverview, resolveCommand } from "./lib/registry.mts";

// コマンドの登録（import の副作用で register される）
import "./commands/meta.mts";
import "./commands/config.mts";
import "./commands/doctor.mts";
import "./commands/docs.mts";
import "./commands/init.mts";
import "./commands/cycle.mts";
import "./commands/tasklist.mts";
import "./commands/next.mts";
import "./commands/validate.mts";

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  setJsonMode(flagBoolean(args, "json"));

  if (flagBoolean(args, "version")) {
    process.stdout.write(`${pluginVersion()}\n`);
    return EXIT_OK;
  }

  if (args.positional.length === 0) {
    // 引数なしは usage を出して 1（git と同じ挙動）
    process.stderr.write(`${renderOverview(pluginVersion())}\n`);
    return EXIT_ERROR;
  }

  const { command, operands } = resolveCommand(args.positional);

  if (flagBoolean(args, "help")) {
    process.stdout.write(`${renderCommandHelp(command)}\n`);
    return EXIT_OK;
  }

  await command.run({ args, operands });
  return EXIT_OK;
}

function report(error: unknown): number {
  if (error instanceof ValidationError) {
    if (isJsonMode()) {
      process.stderr.write(`${JSON.stringify({ ok: false, problems: error.problems }, null, 2)}\n`);
    } else {
      process.stderr.write(`\n検証に失敗しました:\n`);
      for (const problem of error.problems) process.stderr.write(`  - ${problem}\n`);
    }
    return EXIT_VALIDATION;
  }

  if (error instanceof HikyakuError) {
    process.stderr.write(`error: ${error.message}\n`);
    if (error.hint) process.stderr.write(`${error.hint}\n`);
    return EXIT_ERROR;
  }

  process.stderr.write(`error: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  return EXIT_ERROR;
}

try {
  process.exitCode = await main();
} catch (error) {
  process.exitCode = report(error);
}
