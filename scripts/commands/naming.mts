/** branch name / pr title — 命名規則の適用 */

import { flagString } from "../lib/args.mts";
import { branchName, isPhase, renderPrTitle, type Phase } from "../lib/branch.mts";
import { loadConfig } from "../lib/config.mts";
import { HikyakuError } from "../lib/errors.mts";
import { emit } from "../lib/output.mts";
import { register } from "../lib/registry.mts";

function requirePhase(raw: string | undefined): Phase {
  if (raw === undefined) {
    throw new HikyakuError(
      "フェーズを指定してください",
      "使用できる値: init | create | plan | architect | build-NN | close",
    );
  }
  if (!isPhase(raw)) {
    throw new HikyakuError(
      `フェーズの値が不正です: ${raw}`,
      "使用できる値: init | create | plan | architect | build-NN（NN は2桁以上の数字）| close",
    );
  }
  return raw;
}

register({
  name: "branch name",
  summary: "命名規則からブランチ名を生成する",
  usage: "hikyaku branch name <phase> [<cycle>] [--root <path>]",
  details: [
    "  {prefix}{separator}{cycle}{separator}{phase}",
    "",
    "init はサイクルに属さないため {prefix}{separator}init になります。",
    "",
    "ブランチ名は着手状態の導出に解析されるため、構造は固定です。",
    "prefix と separator は [branch] で設定できますが、separator に空文字は指定できません",
    "（サイクルとフェーズを切り出せなくなるため）。",
    "",
    "separator を \"-\" にしても解析できるのは、フェーズが閉じた集合だからです。",
    "prefix を前から、フェーズを後ろから剥がせばサイクルが残ります。",
  ].join("\n"),
  run: ({ args, operands }) => {
    const config = loadConfig({ root: flagString(args, "root") });
    const phase = requirePhase(operands[0]);
    const name = branchName(config.branch, phase, operands[1]);
    emit({ branch: name, phase, cycle: operands[1] }, () => name);
  },
});

register({
  name: "pr title",
  summary: "テンプレートから PR タイトルを生成する",
  usage: "hikyaku pr title <phase> [<cycle>] [--build-title <text>] [--root <path>]",
  details: [
    "テンプレートは [pr] title で設定します。使える変数:",
    "",
    "  {cycle}       002-billing",
    "  {cycle_id}    002",
    "  {cycle_name}  billing",
    "  {phase}       init / create / plan / architect / build-01 / close",
    "  {build_id}    01（builder のみ）",
    "  {title}       --build-title の値（他フェーズでは空）",
    "",
    "空になった変数は前後の区切り文字ごと詰めます。init のようにサイクルを持たない",
    "フェーズで \"[hikyaku] : init\" のような出力にならないようにするためです。",
    "",
    "PR タイトルは表示専用で解析されないため、テンプレートは自由に組み立てられます。",
  ].join("\n"),
  run: ({ args, operands }) => {
    const config = loadConfig({ root: flagString(args, "root") });
    const phase = requirePhase(operands[0]);
    const buildId = /^build-(\d+)$/.exec(phase)?.[1];
    const title = renderPrTitle(config.pr.title, {
      cycle: operands[1],
      phase,
      buildId,
      title: flagString(args, "build-title"),
    });
    emit({ title, phase, cycle: operands[1] }, () => title);
  },
});
