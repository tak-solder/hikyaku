/** branch name / branch verify / pr title / session title — 命名規則の適用 */

import { flagBoolean, flagString, type ParsedArgs } from "../lib/args.mts";
import { branchName, isPhase, parseBranch, renderPrTitle, type Phase } from "../lib/branch.mts";
import { loadConfig, type ResolvedConfig } from "../lib/config.mts";
import { HikyakuError, ValidationError } from "../lib/errors.mts";
import {
  currentBranch,
  defaultBranch,
  listKnownBranches,
  listRemoteBranches,
  localSha,
  nearestAncestorBranch,
  type KnownBranch,
} from "../lib/git.mts";
import { emit } from "../lib/output.mts";
import { register } from "../lib/registry.mts";
import { normalizeBuildId } from "../lib/tasklist.mts";
import { resolveViews } from "../lib/views.mts";
import { openCycle, type CycleContext } from "../lib/workspace.mts";

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

interface Scope {
  /** サイクル固有設定を重ねた設定。init ではリポジトリルートの設定 */
  config: ResolvedConfig;
  cycle: string | undefined;
  /** init 以外では対象サイクル。スタック元の導出に使う */
  context: CycleContext | undefined;
}

/**
 * 対象サイクルと、そのサイクルの設定を決める。
 * init はサイクルに属さないのでリポジトリルートの設定だけを使う。
 *
 * 明示指定があっても解決を通す。[branch] / [pr] / [session] はサイクル側で
 * 上書きできるため、サイクルディレクトリを特定しないと名前を組み立てられない。
 * 引数を ID や slug で渡されたときにディレクトリ名へ正規化されるのも、
 * 解決を通す副次的な効果（`002` から `002-billing` のブランチ名が出る）。
 */
function scopeFor(args: ParsedArgs, phase: Phase, operand: string | undefined): Scope {
  if (phase === "init") {
    return { config: loadConfig({ root: flagString(args, "root") }), cycle: undefined, context: undefined };
  }
  const opened = openCycle(args, operand);
  return { config: opened.config, cycle: opened.context.name, context: opened.context };
}

/**
 * スタック元のブランチを導出する。
 *
 * デフォルトブランチへマージせず、先行フェーズのブランチから積んだ場合、
 * PR の base はデフォルトブランチではなくそのブランチになる。状態は保存せず、
 * 「同じサイクルの Hikyaku ブランチのうち、HEAD の祖先で、まだ base に
 * 取り込まれていない、最も近いもの」として導出する。
 *
 * 取り込み済みの判定は2つ併用する。
 *
 *   祖先関係      git merge-base --is-ancestor で base に含まれるか
 *   base の PR 列  そのビルドの PR 列がデフォルトブランチで非空か
 *
 * 後者が要るのは、**squash merge / rebase merge ではマージ済みでも
 * ブランチの先端が base の祖先にならない**ため。どれだけ fetch しても
 * 祖先関係は false のままなので、Hikyaku 自身の完了の定義で補う。
 *
 * 積んでいなければ undefined を返す（＝PR の base はデフォルトブランチ）。
 */
async function stackParent(
  config: ResolvedConfig,
  context: CycleContext | undefined,
  phase: Phase,
  base: string | undefined,
  options: { fetch: boolean },
): Promise<KnownBranch | undefined> {
  if (context === undefined) return undefined;

  const views = await resolveViews(config, context, { fetch: options.fetch });

  const candidates = (await listKnownBranches(config.repoRoot)).filter((branch) => {
    if (branch.name === base) return false;
    const parsed = parseBranch(config.branch, branch.name);
    if (parsed === undefined || parsed.cycle !== context.name || parsed.phase === phase) {
      return false;
    }
    // マージ済みのビルドは、祖先関係に関わらずスタック元にならない
    const buildId = /^build-(\d+)$/.exec(parsed.phase)?.[1];
    if (buildId !== undefined && views.mergedIds?.has(normalizeBuildId(buildId)) === true) {
      return false;
    }
    return true;
  });
  if (candidates.length === 0) return undefined;

  const baseRefs: string[] = [];
  if (base !== undefined) {
    for (const ref of [`origin/${base}`, base]) {
      if ((await localSha(config.repoRoot, ref)) !== undefined) baseRefs.push(ref);
    }
  }

  return nearestAncestorBranch(config.repoRoot, candidates, baseRefs);
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
    "外からは区別できないためです。**呼び出し元のスキルはユーザーに尋ねてください。**",
    "「今回は実行環境の都合だから」という推測を通すと、本当に紛れ込んだ場合も",
    "同じ理屈で通ります。区別できないからこそ人間に尋ねる場面です。",
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
    "[branch] はサイクル設定でも上書きできます。期待するブランチ名は対象サイクルの",
    "設定で組み立てるため、サイクルごとに prefix が違っていても正しい名前が出ます。",
    "",
    "サイクルを省略すると通常の解決に委ねますが、現在のブランチも判断材料に",
    "使うため、フェーズのサイクルが分かっている場合は明示してください。",
  ].join("\n"),
  run: async ({ args, operands }) => {
    const phase = requirePhase(operands[0]);
    const { config, cycle, context } = scopeFor(args, phase, operands[1]);
    const expected = branchName(config.branch, phase, cycle);
    const actual = currentBranch(config.repoRoot);
    const parsed = actual === undefined ? undefined : parseBranch(config.branch, actual);
    const ok = actual === expected;

    const base = config.baseBranch ?? defaultBranch(config.repoRoot);
    // base が分からなければ true/false のどちらとも言えない。推測せず null で返す
    const onBaseBranch = base === undefined || actual === undefined ? null : actual === base;

    // ここは毎フェーズの冒頭とコミット直前に走るので fetch しない。
    // PR の base として正なのは pr base（そちらは必要なら追跡参照を更新する）
    const stacked = await stackParent(config, context, phase, base, { fetch: false });
    const prBase = stacked?.name ?? base;

    emit(
      {
        ok,
        expected,
        actual,
        phase,
        cycle,
        parsed,
        baseBranch: base ?? null,
        onBaseBranch,
        stackedOn: stacked?.name ?? null,
        prBase: prBase ?? null,
      },
      () => {
      if (ok) {
        return stacked === undefined
          ? `✓ ${actual}`
          : `✓ ${actual}\nスタック元: ${stacked.name}（PR の base はこのブランチ）`;
      }

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
        "**どのブランチで作業するかはユーザーに尋ねてください。判断しないでください。**",
        "実行環境が割り当てたブランチと、別の作業のブランチに紛れ込んだ状態は、",
        "ここからは区別できません。前者だと推測して進めると、後者も同じ理屈で通ります。",
        "",
        `Hikyaku の規則に従う場合: git switch ${expected} || git switch -c ${expected}`,
      );

      if (parsed !== undefined && cycle !== undefined && parsed.cycle === cycle && actual !== undefined) {
        lines.push(
          "",
          `同じサイクルの ${parsed.phase} のブランチに居ます。ここから ${expected} を切ると、`,
          "先行フェーズの成果を取り込んだ**スタック**になります。デフォルトブランチへ",
          `マージされていなくても着手できますが、PR の base は ${actual} になります。`,
        );
      }
      return lines.join("\n");
      },
    );

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
    const phase = requirePhase(operands[0]);
    const { config, cycle } = scopeFor(args, phase, operands[1]);
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
  name: "pr base",
  summary: "PR のマージ先ブランチを返す（スタックしていればスタック元）",
  usage: "hikyaku pr base <phase> [<cycle>] [--no-fetch] [--root <path>] [--json]",
  details: [
    "通常はデフォルトブランチを返します。先行フェーズのブランチから積んでいる",
    "（スタックしている）場合は、そのブランチを返します。",
    "",
    "スタック元は状態として保存せず、ブランチの祖先関係から導出します。同じサイクルの",
    "Hikyaku ブランチのうち、HEAD の履歴に含まれていて、**まだ base に取り込まれて",
    "いない**、最も近いものがスタック元です。マージ済みのブランチも HEAD の祖先に",
    "なるため、取り込み済みを除かないと「デフォルトブランチから切っただけ」を",
    "スタックと誤判定します。",
    "",
    "  stackedOn: null    積んでいない。PR の base はデフォルトブランチ",
    "  stackedOn: <name>  積んでいる。PR の base はそのブランチ",
    "",
    "積んだままデフォルトブランチへ PR を作ると、先行ビルドの差分まで含んだ PR に",
    "なります。**PR を作る直前に実行してください。**",
    "",
    "レビューの差分基準（git merge-base <base> HEAD）にも同じ値を使います。",
  ].join("\n"),
  run: async ({ args, operands }) => {
    const phase = requirePhase(operands[0]);
    const { config, cycle, context } = scopeFor(args, phase, operands[1]);
    const base = config.baseBranch ?? defaultBranch(config.repoRoot);
    const stacked = await stackParent(config, context, phase, base, {
      fetch: !flagBoolean(args, "no-fetch"),
    });
    const prBase = stacked?.name ?? base;

    // スタック元がリモートに無ければ PR は作れない（マージ後に削除された等）
    let missingOnRemote = false;
    if (stacked !== undefined) {
      const remote = await listRemoteBranches(config.repoRoot);
      missingOnRemote = remote.unavailable === undefined && !remote.names.includes(stacked.name);
    }

    if (prBase === undefined) {
      throw new HikyakuError(
        "PR のマージ先を決められません",
        "base_branch を設定するか、origin/HEAD が解決できる状態にしてください。",
      );
    }

    emit(
      {
        base: prBase,
        stackedOn: stacked?.name ?? null,
        stackedOnMissingOnRemote: missingOnRemote,
        baseBranch: base ?? null,
        phase,
        cycle,
      },
      () => {
        if (stacked === undefined) return prBase;
        const lines = [prBase, `（スタック元です。デフォルトブランチ ${base ?? "?"} ではありません）`];
        if (missingOnRemote) {
          lines.push(
            "",
            `! ${stacked.name} は origin にありません。マージ後に削除された可能性があります。`,
            "  この名前では PR を作れません。ローカルに古い追跡参照が残っていないか",
            "  確認してください（git fetch --prune origin）。",
          );
        }
        return lines.join("\n");
      },
    );
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
    const phase = requirePhase(operands[0]);
    const { config, cycle } = scopeFor(args, phase, operands[1]);

    if (config.session.title === "") {
      emit({ title: undefined, phase, cycle, disabled: true }, () =>
        "[session] title が空のため、セッション名は変更しません。",
      );
      return;
    }

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
