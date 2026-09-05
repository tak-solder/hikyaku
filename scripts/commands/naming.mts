/** branch name / branch verify / pr title / session title — 命名規則の適用 */

import { flagString, type ParsedArgs } from "../lib/args.mts";
import { branchName, isPhase, parseBranch, renderPrTitle, type Phase } from "../lib/branch.mts";
import { loadConfig } from "../lib/config.mts";
import { HikyakuError, ValidationError } from "../lib/errors.mts";
import { currentBranch, defaultBranch } from "../lib/git.mts";
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
  name: "branch verify",
  summary: "今いるブランチを命名規則と突き合わせ、期待するブランチ名を返す",
  usage: "hikyaku branch verify <phase> [<cycle>] [--root <path>] [--json]",
  details: [
    "  {prefix}{separator}{cycle}{separator}{phase}",
    "",
    "init はサイクルに属さないため {prefix}{separator}init になります。",
    "",
    "**生成と検証を兼ねます。** 不一致のときは期待するブランチ名と切り替えコマンドを",
    "返すので、ブランチの作成にもこのコマンドを使ってください。名前を生成するだけの",
    "コマンドを別に持つと、生成しただけで確認しないまま作業する余地が残ります。",
    "",
    "各フェーズの冒頭と、成果物をコミットする直前に実行してください。冒頭では",
    "**一致しないのが普通**です（まだそのブランチに居ないため）。",
    "",
    "  一致            終了コード 0",
    "  不一致           終了コード 2。期待するブランチ名と切り替えコマンドを表示",
    "",
    "終了コード 2 は「実行したが問題が見つかった」なので、実行できなかった場合",
    "（終了コード 1）と区別して扱えます。",
    "",
    "不一致のときの扱いは、現在のブランチがデフォルトブランチかどうかで変わります。",
    "出力の onBaseBranch がこれを示します。",
    "",
    "  onBaseBranch: true   まだブランチを切っていないだけ。expected を作れば良い",
    "  onBaseBranch: false  既に何らかの作業ブランチに居る。**どう扱うかは人間の判断**",
    "  onBaseBranch: null   デフォルトブランチを特定できない（origin/HEAD が無い等）",
    "",
    "false と null のとき、スクリプトは「どうすべきか」を決めません。エージェントが",
    "用意した別のブランチかもしれず、実行環境がブランチ名を決めているのかもしれず、",
    "外からは区別できないためです。呼び出し元のスキルがユーザーに尋ねます。",
    "",
    "デフォルトブランチは base_branch の設定が正で、未設定なら origin/HEAD から",
    "導出します。どちらも無ければ null にします（\"main\" と推測しません）。",
    "",
    "ブランチ名は着手状態の導出に解析されるため、構造は固定です。",
    "prefix と separator は [branch] で設定できますが、separator に空文字は指定できません",
    "（サイクルとフェーズを切り出せなくなるため）。separator を \"-\" にしても解析できるのは、",
    "フェーズが閉じた集合だからです。prefix を前から、フェーズを後ろから剥がせば",
    "サイクルが残ります。",
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

    const base = config.baseBranch ?? defaultBranch(config.repoRoot);
    // base が分からなければ true/false のどちらとも言えない。推測せず null で返す
    const onBaseBranch = base === undefined || actual === undefined ? null : actual === base;

    emit({ ok, expected, actual, phase, cycle, parsed, baseBranch: base ?? null, onBaseBranch }, () => {
      if (ok) return `✓ ${actual}`;

      const lines = [
        `期待するブランチ: ${expected}`,
        `現在のブランチ  : ${actual ?? "(detached HEAD)"}`,
        `デフォルトブランチ: ${base ?? "(特定できません)"}`,
        "",
      ];

      if (onBaseBranch === true) {
        lines.push(
          "デフォルトブランチに居ます。まだこのフェーズのブランチを切っていないだけなので、",
          "期待する名前で作成してください。",
          "",
          `作成: git switch -c ${expected}`,
        );
        return lines.join("\n");
      }

      lines.push(
        parsed === undefined
          ? "既に作業ブランチに居ますが、Hikyaku の命名規則に沿っていません。"
          : `現在のブランチは ${parsed.cycle ?? "-"} の ${parsed.phase} を指しています。`,
        "",
        "**どのブランチで作業するかはユーザーに尋ねてください。** 実行環境がブランチ名を",
        "決めている場合もあれば、別の作業のブランチに紛れ込んでいる場合もあり、",
        "ここからは区別できません。",
        "",
        `Hikyaku の規則に従う場合: git switch ${expected} || git switch -c ${expected}`,
      );
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
