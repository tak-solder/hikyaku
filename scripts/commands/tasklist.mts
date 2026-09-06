/** tasklist read / add / update / done — ビルド一覧の操作 */

import { flagBoolean, flagInteger, flagList, flagString } from "../lib/args.mts";
import { HikyakuError, ValidationError } from "../lib/errors.mts";
import { emit, table } from "../lib/output.mts";
import { register } from "../lib/registry.mts";
import {
  buildDirName,
  isComplete,
  normalizeBuildId,
  renderGraph,
  validateGraph,
  type BuildRecord,
} from "../lib/tasklist.mts";
import { formatRef } from "../lib/refs.mts";
import { openCycle, writeTasklist, type CycleContext } from "../lib/workspace.mts";

function context(args: Parameters<typeof flagString>[0], key: string | undefined): CycleContext {
  return openCycle(args, key).context;
}

/** 変更後のグラフを検証し、問題があれば書き込まずに終了する */
function assertGraphOk(builds: BuildRecord[]): void {
  const problems = validateGraph(builds);
  if (problems.length > 0) {
    throw new ValidationError(problems.map((p) => p.message));
  }
}

function summarize(builds: BuildRecord[]): string {
  return table(
    builds.map((build) => [
      buildDirName(build.id),
      build.title,
      build.bp === undefined ? "—" : String(build.bp),
      build.dependsOn.length > 0 ? build.dependsOn.map(buildDirName).join(", ") : "—",
      isComplete(build) ? "完了" : "未完了",
      build.pr || "—",
    ]),
    ["build", "title", "BP", "依存", "状態", "PR"],
  );
}

register({
  name: "tasklist read",
  summary: "tasklist.md を解析してビルド一覧を返す",
  usage: "hikyaku tasklist read [<cycle>] [--json]",
  details: [
    "サイクルを省略した場合、進行中のサイクルが1つだけならそれを対象にします。",
    "完了判定は PR 列が非空かどうかの一点です。",
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
    "hikyaku tasklist add [<cycle>] --title <text> [--bp <n>] [--deps 1,2] [--issue <link>] [--dry-run]",
  writes: true,
  details: [
    "buildID は max(既存) + 1 を自動採番します。既存 ID のリナンバリングは行いません。",
    "",
    "issue.md の本文は LLM が書き、この コマンドは tasklist.md の行だけを更新します。",
    "長い Markdown をスクリプトへ渡す必要をなくすための分担です。",
    "",
    "追加後に依存グラフを再生成し、循環依存と存在しない依存を検証します。",
    "問題があれば書き込まずに終了コード 2 で終了します。",
    "",
    "承認は呼び出し元のスキルが取ります。--dry-run で差分だけを提示してください。",
  ].join("\n"),
  run: ({ args, operands }) => {
    const ctx = context(args, operands[0]);
    const title = flagString(args, "title");
    if (title === undefined) throw new HikyakuError("--title を指定してください");

    const id = String(
      ctx.builds.reduce((acc, build) => Math.max(acc, Number.parseInt(build.id, 10) || 0), 0) + 1,
    );
    const record: BuildRecord = {
      id,
      title,
      bp: flagInteger(args, "bp"),
      dependsOn: (flagList(args, "deps") ?? []).map(normalizeBuildId),
      issue: flagString(args, "issue") ?? `[issue](./${buildDirName(id)}/issue.md)`,
      pr: "",
    };

    const next = [...ctx.builds, record];
    assertGraphOk(next);
    finish(ctx, next, args, `${buildDirName(id)} を追加します`, record);
  },
});

register({
  name: "tasklist update",
  summary: "既存ビルドのタイトル・BP・依存を更新する",
  usage:
    "hikyaku tasklist update [<cycle>] --id <n> [--title <text>] [--bp <n>] [--deps 1,2] [--dry-run]",
  writes: true,
  details: [
    "ビルドの分割は「元ビルドの update + 新ビルドの add」で表現します。",
    "専用の split コマンドは持ちません（既存コマンドの組み合わせで足りるため）。",
    "",
    "完了済み（PR 列が非空）のビルドは更新できません。依存グラフの整合性が崩れるためです。",
  ].join("\n"),
  run: ({ args, operands }) => {
    const ctx = context(args, operands[0]);
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
      bp: flagInteger(args, "bp") ?? target.bp,
      dependsOn: deps ? deps.map(normalizeBuildId) : target.dependsOn,
    };

    const next = ctx.builds.map((build) => (build.id === id ? updated : build));
    assertGraphOk(next);
    finish(ctx, next, args, `${buildDirName(id)} を更新します`, updated);
  },
});

register({
  name: "tasklist done",
  summary: "ビルドの完了を記録する（PR 列を埋める）",
  usage: "hikyaku tasklist done [<cycle>] --id <n> --pr <url> [--dry-run]",
  writes: true,
  details: [
    "PR 列を埋めることがビルドの完了記録そのものです。status 列は持ちません。",
    "",
    "URL は issue 列と同じ `[#12](URL)` の形に整えて記録します。番号を判別できない",
    "場合は `[PR](URL)` になります。完了判定は「非空かどうか」の一点なので、",
    "表記の違いが判定に影響することはありません。",
    "",
    "この変更は当該ビルドの PR に同梱してください。そうすることで、デフォルト",
    "ブランチ上で PR 列が埋まっていること自体が「マージ済み = 完了」を意味します。",
    "先にデフォルトブランチへ入れてしまうと、未マージのビルドを完了と誤判定します。",
  ].join("\n"),
  run: ({ args, operands }) => {
    const ctx = context(args, operands[0]);
    const rawId = flagString(args, "id");
    const id = rawId === undefined ? undefined : normalizeBuildId(rawId);
    const pr = flagString(args, "pr");
    if (id === undefined) throw new HikyakuError("--id を指定してください");
    if (pr === undefined) throw new HikyakuError("--pr に PR の URL を指定してください");
    // PR 列は「非空かどうか」だけで完了判定される。typo をそのまま入れると、
    // 未マージのビルドが完了扱いになり、依存ビルドが着手可能になってしまう
    if (!/^https?:\/\/\S+$/.test(pr.trim())) {
      throw new HikyakuError(
        `--pr は PR の URL を指定してください: ${JSON.stringify(pr)}`,
        "PR 列が非空であること自体が完了を意味するため、URL 以外は受け付けません。",
      );
    }

    const target = ctx.builds.find((build) => build.id === id);
    if (!target) throw new HikyakuError(`${buildDirName(id)} が見つかりません`);

    // issue 列と同じ `[#12](URL)` 形式に揃える。生の URL のままだと表が横に伸びる
    const updated: BuildRecord = { ...target, pr: formatRef(pr, "PR") };
    const next = ctx.builds.map((build) => (build.id === id ? updated : build));
    finish(ctx, next, args, `${buildDirName(id)} を完了として記録します`, updated);
  },
});

register({
  name: "tasklist link",
  summary: "外部システムへ投影した issue の参照を記録する",
  usage: "hikyaku tasklist link [<cycle>] --id <n> --issue <url> [--dry-run]",
  writes: true,
  details: [
    "tasklist.md の issue 列を埋めます。gh CLI が使える場合は external sync が",
    "自動で記録するので、このコマンドを直接使うのは GitHub MCP や Asana MCP で",
    "スキル側が投影した場合です。",
    "",
    "issue 列の初期値は `[issue](./build-NN/issue.md)`（ファイルへのリンク）です。",
    "外部へ投影したらその参照で置き換えます。マスターは常にファイル側で、",
    "外部システムは可視化のためのビューにすぎません。",
  ].join("\n"),
  run: ({ args, operands }) => {
    const ctx = context(args, operands[0]);
    const rawId = flagString(args, "id");
    const id = rawId === undefined ? undefined : normalizeBuildId(rawId);
    const issue = flagString(args, "issue");
    if (id === undefined) throw new HikyakuError("--id を指定してください");
    if (issue === undefined) throw new HikyakuError("--issue に issue の URL を指定してください");

    const target = ctx.builds.find((build) => build.id === id);
    if (!target) throw new HikyakuError(`${buildDirName(id)} が見つかりません`);

    const updated: BuildRecord = { ...target, issue: formatRef(issue, "issue") };
    const next = ctx.builds.map((build) => (build.id === id ? updated : build));
    finish(ctx, next, args, `${buildDirName(id)} の issue 列を記録します`, updated);
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
