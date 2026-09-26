/** branch name / branch verify / pr title / session title — 命名規則の適用 */

import { flagBoolean, flagString } from "../lib/args.mts";
import { branchName, parseBranch, renderPrTitle } from "../lib/branch.mts";
import { ValidationError } from "../lib/errors.mts";
import { currentBranch, defaultBranch, listRemoteBranches } from "../lib/git.mts";
import { emit } from "../lib/output.mts";
import { register } from "../lib/registry.mts";
import { requirePhase, resolvePrBase, scopeFor, stackParent } from "../lib/stack.mts";

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
    "",
    "stackedOn / prBase は「先行フェーズのブランチの上に積んでいるか」の**目安**です。",
    "このコマンドはネットワークへ行かないため、リモートで先行 PR がマージされた直後は",
    "まだスタック中と見えることがあります。**PR の base として正なのは pr base** で、",
    "そちらは必要ならリモート追跡参照を更新します。",
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
        "hikyaku の規則に従ったブランチで作業してください",
        `git switch ${expected} || git switch -c ${expected}`,
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
  usage: "hikyaku pr base <phase> [<cycle>] [--ref] [--no-fetch] [--root <path>] [--json]",
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
    "**--ref を付けるとローカルで解決できる ref を返します。** PR の base に渡すのは",
    "ブランチ名ですが、git merge-base や git diff に渡すには解決できる ref が要ります。",
    "リモート追跡参照しか無いブランチを名前のまま渡すと解決に失敗し、コミット済み",
    "差分が空になります。レビューの差分基準にはこちらを使ってください。",
    "",
    "  hikyaku pr base build-01 002-billing         → hikyaku/002-billing/build-01",
    "  hikyaku pr base build-01 002-billing --ref   → origin/hikyaku/002-billing/build-01",
    "",
    "**PR の base として正なのはこのコマンドです。** branch verify の stackedOn は",
    "ネットワークへ行かないため（毎フェーズの冒頭とコミット直前に走るため）、",
    "リモートで先行 PR がマージされた直後は古い可能性があります。あちらは目安、",
    "PR を作るときはこちらを使ってください。",
    "",
    "マージ状況を確認できない（デフォルトブランチの tasklist も base の ref も",
    "読めない）場合は、スタック元を推測せずデフォルトブランチを返します。",
  ].join("\n"),
  run: async ({ args, operands }) => {
    const phase = requirePhase(operands[0]);
    const scope = scopeFor(args, phase, operands[1]);
    const { config, cycle } = scope;

    // PR の base に使う名前と、ローカルの git 操作に使う ref は別物。
    // リモート追跡参照しか無いブランチ名をそのまま git merge-base に渡すと解決に失敗する
    const { base: prBase, ref: localRef, stacked, defaultBase } = await resolvePrBase(scope, phase, {
      fetch: !flagBoolean(args, "no-fetch"),
    });

    // スタック元がリモートに無ければ PR は作れない（マージ後に削除された等）
    let missingOnRemote = false;
    if (stacked !== undefined) {
      const remote = await listRemoteBranches(config.repoRoot);
      missingOnRemote = remote.unavailable === undefined && !remote.names.includes(stacked.name);
    }

    const wantRef = flagBoolean(args, "ref");

    emit(
      {
        base: prBase,
        ref: localRef ?? null,
        stackedOn: stacked?.name ?? null,
        stackedOnMissingOnRemote: missingOnRemote,
        baseBranch: defaultBase ?? null,
        phase,
        cycle,
      },
      () => {
        const head = wantRef ? (localRef ?? prBase) : prBase;
        if (stacked === undefined) return head;
        const lines = [head, `（スタック元です。デフォルトブランチ ${defaultBase ?? "?"} ではありません）`];
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
