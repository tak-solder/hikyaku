/** version / help — 環境や使い方に関するコマンド */

import { emit } from "../lib/output.mts";
import { pluginVersion } from "../lib/paths.mts";
import {
  register,
  renderCommandHelp,
  renderNamespaceHelp,
  renderOverview,
  resolveCommand,
} from "../lib/registry.mts";
import { HikyakuError } from "../lib/errors.mts";

register({
  name: "version",
  summary: "スクリプトのバージョンを表示する",
  usage: "hikyaku version",
  details: "plugin.json の version を返します。--version でも同じ結果です。",
  run: () => {
    const version = pluginVersion();
    emit({ version }, () => version);
  },
});

register({
  name: "help",
  summary: "コマンドの一覧と使い方を表示する",
  usage: "hikyaku help [<command>]",
  details: [
    "引数なしで全コマンドの一覧を表示します。",
    "名前空間（cycle / tasklist など）を渡すとその配下の一覧を、",
    "コマンド名を渡すと詳細を表示します。",
    "",
    "例:",
    "  hikyaku help",
    "  hikyaku help cycle",
    "  hikyaku help cycle new",
  ].join("\n"),
  run: ({ operands }) => {
    if (operands.length === 0) {
      const text = renderOverview(pluginVersion());
      emit({ help: text }, () => text);
      return;
    }

    const namespaceHelp = operands.length === 1 ? renderNamespaceHelp(operands[0] as string) : undefined;
    if (namespaceHelp !== undefined) {
      emit({ help: namespaceHelp }, () => namespaceHelp);
      return;
    }

    try {
      const { command } = resolveCommand(operands);
      const text = renderCommandHelp(command);
      emit({ help: text }, () => text);
    } catch {
      throw new HikyakuError(
        `ヘルプが見つかりません: ${operands.join(" ")}`,
        "hikyaku help で一覧を表示します。",
      );
    }
  },
});
