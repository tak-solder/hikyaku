/** tasklist read / add / update / done — ビルド一覧の操作 */

import { flagBoolean, flagList, flagString } from "../lib/args.mts";
import { HikyakuError, ValidationError } from "../lib/errors.mts";
import { emit, table } from "../lib/output.mts";
import { register } from "../lib/registry.mts";
import {
  buildDirName,
  isComplete,
  normalizeBuildId,
  readyBuilds,
  renderGraph,
  validateGraph,
  type BuildRecord,
} from "../lib/tasklist.mts";
import { assertCurrentConfig } from "../lib/config.mts";
import { formatK, parseTokenAmount } from "../lib/tokens.mts";
import { openCycle, writeTasklist, type CycleContext } from "../lib/workspace.mts";

/** --peak（380k・380000）。--bp は廃止 */
function readPeak(args: Parameters<typeof flagString>[0]): number | undefined {
  if (args.flags.has("bp")) {
    throw new HikyakuError("--bp は廃止しました", "architect 段階の予測ピークを --peak <トークン数>（380k など）で渡してください。");
  }
  const raw = flagString(args, "peak");
  if (raw === undefined) return undefined;
  const peak = parseTokenAmount(raw);
  if (peak === undefined || peak === 0) throw new HikyakuError(`--peak はトークン数で指定してください（現在: ${raw}）`, "例: --peak 380k");
  return peak;
}

function context(args: Parameters<typeof flagString>[0], key: string | undefined): CycleContext {
  return openCycle(args, key).context;
}

/** 書き込む操作の対象サイクル。サイクル設定に v3 で廃止したキーが残っていれば止める */
function writableContext(args: Parameters<typeof flagString>[0], key: string | undefined): CycleContext {
  const opened = openCycle(args, key);
  assertCurrentConfig(opened.config);
  return opened.context;
}

/** 変更後のグラフを検証し、問題があれば書き込まずに終了する */
function assertGraphOk(builds: BuildRecord[]): void {
  const problems = validateGraph(builds);
  if (problems.length > 0) {
    throw new ValidationError(problems.map((p) => p.message));
  }
}

/**
 * 見出しに添える予測ピークと依存。表の中だと「指定したつもりが落ちた」ことに気づきにくいため、
 * 追加・更新したビルドの値だけを見出しで明示する
 */
function describeInput(build: BuildRecord): string {
  const peak = build.peak === undefined ? "なし" : formatK(build.peak);
  const deps = build.dependsOn.length > 0 ? build.dependsOn.map(buildDirName).join(", ") : "なし";
  return `予測ピーク: ${peak} / 依存: ${deps}`;
}

function summarize(builds: BuildRecord[]): string {
  const ready = new Set(readyBuilds(builds).map((build) => build.id));
  return table(
    builds.map((build) => [
      buildDirName(build.id),
      build.title,
      formatK(build.peak),
      build.dependsOn.length > 0 ? build.dependsOn.map(buildDirName).join(", ") : "—",
      isComplete(build) ? "完了" : ready.has(build.id) ? "着手可能" : "待機中",
      build.pr || "—",
    ]),
    ["build", "title", "予測ピーク", "依存", "状態", "PR"],
  );
}

register({
  name: "tasklist read",
  summary: "tasklist.md を解析してビルド一覧を返す",
  usage: "hikyaku tasklist read [<cycle>] [--json]",
  options: [],
  maxOperands: 1,
  details: [
    "サイクルを省略した場合、進行中のサイクルが1つだけならそれを対象にします。",
    "完了判定は、PR 列か各ビルドの完了の記録（build-NN/progress.jsonl の pr の done）が在るかの一点です。",
  ].join("\n"),
  run: ({ args, operands }) => {
    const ctx = context(args, operands[0]);
    emit({ cycle: ctx.name, builds: ctx.builds, graph: renderGraph(ctx.builds) }, () =>
      ctx.builds.length === 0
        ? `${ctx.name}: ビルドはまだ登録されていません。`
        : `${ctx.name}\n\n${summarize(ctx.builds)}`,
    );
  },
});

register({
  name: "tasklist add",
  summary: "ビルドを追加し、依存グラフを再生成する",
  usage:
    "hikyaku tasklist add [<cycle>] --title <text> [--peak <トークン数>] [--deps 1,2] [--dry-run]",
  writes: true,
  options: ["title", "peak", "bp", "deps"], // bp は廃止の案内を返すため受け付ける
  maxOperands: 1,
  details: [
    "buildID は max(既存) + 1 を自動採番します。既存 ID のリナンバリングは行いません。",
    "",
    "issue.md の本文は LLM が書き、この コマンドは tasklist.md の行だけを更新します。",
    "長い Markdown をスクリプトへ渡す必要をなくすための分担です。",
    "",
    "追加後に依存グラフを再生成し、循環依存と存在しない依存を検証します。",
    "問題があれば書き込まずに終了コード 2 で終了します。",
    "",
    "不明なオプションと余分な引数は、書き込まずに終了コード 1 で終了します。",
    "`--deps 1,2` が空白を含む1つの引数で渡った場合も不明なオプションとして扱います",
    "（黙って依存なしで登録すると、依存グラフが壊れたことに気づけないため）。",
    "",
    "承認は呼び出し元のスキルが取ります。--dry-run で差分だけを提示してください。",
  ].join("\n"),
  run: ({ args, operands }) => {
    const ctx = writableContext(args, operands[0]);
    const title = flagString(args, "title");
    if (title === undefined) throw new HikyakuError("--title を指定してください");

    const id = String(
      ctx.builds.reduce((acc, build) => Math.max(acc, Number.parseInt(build.id, 10) || 0), 0) + 1,
    );
    const record: BuildRecord = {
      id,
      title,
      peak: readPeak(args),
      dependsOn: (flagList(args, "deps") ?? []).map(normalizeBuildId),
      pr: "",
    };

    const next = [...ctx.builds, record];
    assertGraphOk(next);
    finish(ctx, next, args, `${buildDirName(id)} を追加します（${describeInput(record)}）`, record);
  },
});

register({
  name: "tasklist update",
  summary: "既存ビルドのタイトル・予測ピーク・依存を更新する",
  usage:
    "hikyaku tasklist update [<cycle>] --id <n> [--title <text>] [--peak <トークン数>] [--deps 1,2] [--dry-run]",
  writes: true,
  options: ["id", "title", "peak", "bp", "deps"], // bp は廃止の案内を返すため受け付ける
  maxOperands: 1,
  details: [
    "ビルドの分割は「元ビルドの update + 新ビルドの add」で表現します。",
    "専用の split コマンドは持ちません（既存コマンドの組み合わせで足りるため）。",
    "",
    "完了済み（PR 列か完了の記録が在る）のビルドは更新できません。依存グラフの整合性が崩れるためです。",
    "",
    "不明なオプションと余分な引数は、書き込まずに終了コード 1 で終了します。",
  ].join("\n"),
  run: ({ args, operands }) => {
    const ctx = writableContext(args, operands[0]);
    const rawId = flagString(args, "id");
    const id = rawId === undefined ? undefined : normalizeBuildId(rawId);
    if (id === undefined) throw new HikyakuError("--id を指定してください");

    const target = ctx.builds.find((build) => build.id === id);
    if (!target) throw new HikyakuError(`${buildDirName(id)} が見つかりません`);
    if (isComplete(target)) {
      throw new HikyakuError(
        `${buildDirName(id)} は完了済みのため更新できません`,
        "完了済みビルドのスコープや依存を変えると、依存グラフの整合性が崩れます。",
      );
    }

    const deps = flagList(args, "deps");
    const updated: BuildRecord = {
      ...target,
      title: flagString(args, "title") ?? target.title,
      peak: readPeak(args) ?? target.peak,
      dependsOn: deps ? deps.map(normalizeBuildId) : target.dependsOn,
    };

    const next = ctx.builds.map((build) => (build.id === id ? updated : build));
    assertGraphOk(next);
    finish(ctx, next, args, `${buildDirName(id)} を更新します（${describeInput(updated)}）`, updated);
  },
});

register({
  name: "tasklist done",
  summary: "完了したビルドの依存グラフを、完了の記録から描き直す",
  usage: "hikyaku tasklist done [<cycle>] --id <n> [--dry-run]",
  writes: true,
  options: ["id", "pr"], // pr は廃止の案内を返すため受け付ける
  maxOperands: 1,
  details: [
    "ビルドの完了の記録は、builder の pr の done（step report の --pr）です。このコマンドは",
    "その記録を読み、tasklist.md の依存グラフを描き直します。PR 列には書きません。",
    "",
    "表は行のあいだに空行を挟めないため、並行するビルドの PR が隣り合う行の PR 列を埋めると、",
    "Git は必ずコンフリクトにします。依存グラフはビルドごとのブロックに分かれているので、",
    "このコマンドで変わるのは完了したビルドのブロックだけです。PR 列は cycle close がまとめて埋めます。",
    "",
    "完了の記録が無ければ、書き込まずに終了コード 1 で終了します。",
    "結果は当該ビルドの PR に同梱してください（記録と同じく、デフォルトブランチへ先に入れない）。",
  ].join("\n"),
  run: ({ args, operands }) => {
    if (args.flags.has("pr")) {
      throw new HikyakuError(
        "tasklist done の --pr は廃止しました",
        "完了は step report の pr の done（--pr <PR の URL>）で記録します。記録してから --id だけで実行し直してください。",
      );
    }
    const ctx = writableContext(args, operands[0]);
    const rawId = flagString(args, "id");
    const id = rawId === undefined ? undefined : normalizeBuildId(rawId);
    if (id === undefined) throw new HikyakuError("--id を指定してください");

    const target = ctx.builds.find((build) => build.id === id);
    if (!target) throw new HikyakuError(`${buildDirName(id)} が見つかりません`);
    if (!isComplete(target)) {
      throw new HikyakuError(
        `${buildDirName(id)} の完了の記録がありません`,
        `PR を作ったら、先に step report ${buildDirName(id)} pr --result done --pr <PR の URL> で記録してください。`,
      );
    }
    finish(ctx, ctx.builds, args, `${buildDirName(id)} の完了を依存グラフに描きます（PR: ${target.pr}）`, target);
  },
});

function finish(
  ctx: CycleContext,
  builds: BuildRecord[],
  args: Parameters<typeof flagBoolean>[0],
  headline: string,
  changed: BuildRecord,
): void {
  const dryRun = flagBoolean(args, "dry-run");
  emit({ cycle: ctx.name, changed, builds, dryRun, graph: renderGraph(builds) }, () => {
    const lines = [`${ctx.name}: ${headline}`, "", summarize(builds), "", "依存グラフ:", renderGraph(builds)];
    if (dryRun) lines.push("", "(--dry-run のため書き込んでいません)");
    return lines.join("\n");
  });
  if (!dryRun) writeTasklist(ctx, builds);
}
