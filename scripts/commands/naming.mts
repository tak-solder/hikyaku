/** branch name / branch verify / pr title / session title — 命名規則の適用 */

import { flagString, type ParsedArgs } from "../lib/args.mts";
import { branchName, isPhase, parseBranch, renderPrTitle, type Phase } from "../lib/branch.mts";
import { loadConfig } from "../lib/config.mts";
import { HikyakuError, ValidationError } from "../lib/errors.mts";
import { currentBranch } from "../lib/git.mts";
import { emit } from "../lib/output.mts";
import { register } from "../lib/registry.mts";
import { openCycle } from "../lib/workspace.mts";

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

/**
 * 対象サイクルを決める。init はサイクルに属さないので undefined を返す。
 * 明示指定が無ければ通常の解決（ブランチ → 栞 → 唯一の active）に委ねる。
 */
function cycleFor(args: ParsedArgs, phase: Phase, operand: string | undefined): string | undefined {
  if (phase === "init") return undefined;
  if (operand !== undefined) return operand;
  return openCycle(args, undefined).context.name;
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
    const cycle = cycleFor(args, phase, operands[1]);
    const name = branchName(config.branch, phase, cycle);
    emit({ branch: name, phase, cycle }, () => name);
  },
});

register({
  name: "branch verify",
  summary: "今いるブランチが命名規則に沿っているか確認する",
  usage: "hikyaku branch verify <phase> [<cycle>] [--root <path>] [--json]",
  details: [
    "生成（branch name）と対になる検証です。命名を生成できても検証していないと、",
    "エージェントが用意した別のブランチの上で作業してしまう事故を防げません。",
    "",
    "各フェーズの冒頭と、成果物を書き出す直前に実行してください。",
    "",
    "  一致            終了コード 0",
    "  不一致 / 別命名  終了コード 2。期待するブランチ名と切り替えコマンドを表示",
    "",
    "終了コード 2 は「実行したが問題が見つかった」なので、実行できなかった場合",
    "（終了コード 1）と区別して扱えます。",
    "",
    "サイクルを省略すると通常の解決に委ねますが、現在のブランチも判断材料に",
    "使うため、フェーズのサイクルが分かっている場合は明示してください。",
  ].join("\n"),
  run: ({ args, operands }) => {
    const config = loadConfig({ root: flagString(args, "root") });
    const phase = requirePhase(operands[0]);
    const cycle = cycleFor(args, phase, operands[1]);
    const expected = branchName(config.branch, phase, cycle);
    const actual = currentBranch(config.repoRoot);
    const parsed = actual === undefined ? undefined : parseBranch(config.branch, actual);
    const ok = actual === expected;

    emit({ ok, expected, actual, phase, cycle, parsed }, () => {
      if (ok) return `✓ ${actual}`;
      const lines = [
        `期待するブランチ: ${expected}`,
        `現在のブランチ  : ${actual ?? "(detached HEAD)"}`,
        "",
      ];
      lines.push(
        parsed === undefined
          ? "現在のブランチは Hikyaku の命名規則に沿っていません。"
          : `現在のブランチは ${parsed.cycle ?? "-"} の ${parsed.phase} を指しています。`,
      );
      lines.push("", `切り替え: git switch ${expected} || git switch -c ${expected}`);
      return lines.join("\n");
    });

    if (!ok) {
      throw new ValidationError([
        `ブランチが一致しません（期待: ${expected} / 現在: ${actual ?? "detached HEAD"}）`,
      ]);
    }
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
    const cycle = cycleFor(args, phase, operands[1]);
    const buildId = /^build-(\d+)$/.exec(phase)?.[1];
    const title = renderPrTitle(config.pr.title, {
      cycle,
      phase,
      buildId,
      title: flagString(args, "build-title"),
    });
    emit({ title, phase, cycle }, () => title);
  },
});

register({
  name: "session title",
  summary: "テンプレートからセッション名を生成する",
  usage: "hikyaku session title <phase> [<cycle>] [--build-title <text>] [--root <path>]",
  details: [
    "テンプレートは [session] title で設定します。変数は pr title と共通です:",
    "",
    "  {cycle} {cycle_id} {cycle_name} {phase} {build_id} {title}",
    "",
    "既定は \"{cycle} {phase} {title}\"（例: 002-billing build-01 請求テーブル）。",
    "",
    "**空文字にするとセッション名を変更しません。** 有効・無効のフラグは別に持たず、",
    "テンプレートが空かどうかで決まります。",
    "",
    "セッション名の変更手段を持たない環境もあるため、スキル側は「使えれば適用、",
    "使えなければスキップ」で扱います。",
  ].join("\n"),
  run: ({ args, operands }) => {
    const config = loadConfig({ root: flagString(args, "root") });
    const phase = requirePhase(operands[0]);

    if (config.session.title === "") {
      emit({ title: undefined, phase, disabled: true }, () =>
        "[session] title が空のため、セッション名は変更しません。",
      );
      return;
    }

    const cycle = cycleFor(args, phase, operands[1]);
    const buildId = /^build-(\d+)$/.exec(phase)?.[1];
    const title = renderPrTitle(config.session.title, {
      cycle,
      phase,
      buildId,
      title: flagString(args, "build-title"),
    });
    emit({ title, phase, cycle }, () => title);
  },
});
