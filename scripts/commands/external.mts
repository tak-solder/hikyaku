/** external sync / ref — サイクルの GitHub issue の起票と、PR からの参照 */

import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { flagBoolean } from "../lib/args.mts";
import { isPhase, type Phase } from "../lib/branch.mts";
import { assertCurrentConfig, checkExternalTarget, EXTERNAL_TARGETS, type ExternalTarget, type ResolvedConfig } from "../lib/config.mts";
import { cyclesPath, loadCycles, renderCyclesFile } from "../lib/cycles.mts";
import { HikyakuError } from "../lib/errors.mts";
import { emit, warn } from "../lib/output.mts";
import { repoRelative } from "../lib/paths.mts";
import { register } from "../lib/registry.mts";
import { formatRef, refNumber, refUrl } from "../lib/refs.mts";
import { openCycle, type CycleContext } from "../lib/workspace.mts";
import { originUrl } from "../lib/git.mts";
import { githubRepositoryOf } from "../lib/github.mts";

const run = promisify(execFile);

const FOOTER = [
  "---",
  "この issue は Hikyaku が PLAN の時点のリポジトリから生成しました（片方向投影）。ビルドの進捗はここに反映されません。",
  "**正はリポジトリ側です。** `hikyaku external sync` で起票し直すと、ここでの編集は上書きされます。",
];

/** サイクルの issue に載せる内容 */
interface Projection {
  title: string;
  body: string;
  /** 既に記録されている参照（cycles.md の外部列） */
  existing: string;
}

/**
 * サイクルのディレクトリの在り処。origin が GitHub なら tree URL、それ以外はリポジトリ相対パス。
 * github_repo（issue の起票先）からは作らない。サイクルのファイルがあるのは origin で、
 * 起票先は別のリポジトリでありうるため。base_branch が無ければ HEAD（GitHub がデフォルトブランチに解決する）
 */
function cycleLocation(config: ResolvedConfig, cycleName: string, filesRepository: string | undefined): string {
  const relative = `${repoRelative(config.repoRoot, config.hikyakuRoot)}/cycles/${cycleName}`;
  if (filesRepository === undefined) return relative;
  return `https://github.com/${filesRepository}/tree/${config.baseBranch ?? "HEAD"}/${relative}`;
}

/**
 * サイクルの issue の本文。
 *
 * ビルドの一覧と進捗は載せない。ビルドごとに同期しないので、載せると古い表示が残り続ける。
 * 進捗の正は tasklist.md の PR 列で、ここからはサイクルのディレクトリへのリンクだけを張る。
 */
function renderBody(config: ResolvedConfig, ctx: CycleContext, filesRepository: string | undefined): string {
  return [
    ctx.record.summary === "" ? "" : `${ctx.record.summary}\n`,
    `**profile**: ${ctx.record.profile || "—"}`,
    ctx.record.ticket === "" ? "" : `**チケット**: ${ctx.record.ticket}`,
    "",
    `**サイクル**: ${cycleLocation(config, ctx.name, filesRepository)}`,
    "",
    "要件は `planning/user-stories.md`、ビルドの一覧と進捗は `tasklist.md` にあります（PLAN の PR がマージされると開けます）。",
    "CLOSE の PR が `Closes` でこの issue を参照します。",
    "",
    ...FOOTER,
  ]
    .filter((line, index, all) => !(line === "" && all[index - 1] === ""))
    .join("\n");
}

async function projectionOf(config: ResolvedConfig, ctx: CycleContext): Promise<Projection> {
  const filesRepository = githubRepositoryOf(await originUrl(config.repoRoot));
  return {
    title: `[${ctx.name}] ${ctx.record.summary || ctx.record.slug}`,
    body: renderBody(config, ctx, filesRepository),
    existing: ctx.record.external,
  };
}

/** gh CLI が使えるか */
async function hasGh(cwd: string): Promise<boolean> {
  try {
    await run("gh", ["--version"], { cwd, timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

function repoArgs(repo: string | undefined): string[] {
  return repo === undefined ? [] : ["--repo", repo];
}

register({
  name: "external sync",
  summary: "サイクルの GitHub issue を作成・更新する（片方向投影）",
  usage: "hikyaku external sync [<target>] [<cycle>] [--root <path>] [--dry-run]",
  writes: true,
  details: [
    "**マスターは常にファイル側です。** issue は可視化のためのビューにすぎず、",
    "読み取りにも完了判定にも使いません。投影は片方向・冪等で、何度実行しても収束します。",
    "",
    "起票するのはサイクルに1つの issue だけです。ビルドごとには起票しません。",
    "本文は要約・profile・チケット・サイクルのディレクトリへのリンクで、ビルドの進捗は",
    "載せません（進捗の正は tasklist.md の PR 列）。通常は PLAN の PR を作る直前に",
    "planner が1回だけ呼び、以降のすべての PR がこの issue を参照します。",
    "",
    "参照は作成後に cycles.md の外部列へ自動で記録します。既に記録があれば、その issue の",
    "タイトルと本文を更新します。",
    "",
    "target を省略すると .hikyaku.config の [external] target を使います。",
    "",
    "  none    何もしない",
    "  github  gh CLI があれば issue を作成・更新する",
    "",
    "**gh CLI が無い場合も投影内容を出力します。** スキル側が GitHub MCP で起票し、",
    "cycle link で参照を記録してください（出力の applied が false、reason が gh-not-found のとき）。",
    "",
    "**失敗してもワークフローは止めません。** 警告を出して終了コード 0 で終わります。",
    "外部システムに到達できないことが実装や設計を止める理由にはならないためです。",
  ].join("\n"),
  run: async ({ args, operands }) => {
    const explicit = operands[0];
    if (explicit === "asana") checkExternalTarget(explicit, "target");
    const isTarget = explicit !== undefined && (EXTERNAL_TARGETS as readonly string[]).includes(explicit);
    const cycleKey = isTarget ? operands[1] : explicit;

    const { config, context: ctx } = openCycle(args, cycleKey);
    // サイクル設定に廃止したキー（target = "asana" など）が残っていれば、ルートの設定に戻って起票しない
    assertCurrentConfig(config);
    const target = (isTarget ? explicit : config.external.target) as ExternalTarget;

    if (target === "none") {
      emit({ target, cycle: ctx.name, applied: false, reason: "target-none", projection: null }, () =>
        "[external] target が none のため、起票する対象はありません。",
      );
      return;
    }

    const projection = await projectionOf(config, ctx);
    const dryRun = flagBoolean(args, "dry-run");
    const gh = !dryRun && (await hasGh(config.repoRoot));

    if (!gh) {
      const reason = dryRun ? "dry-run" : "gh-not-found";
      emit({ target, cycle: ctx.name, applied: false, reason, projection }, () => {
        const lines = [
          `${ctx.name} → ${target}${dryRun ? "（--dry-run）" : ""}`,
          "",
          `## ${projection.title}`,
          `参照: ${projection.existing || "（未作成）"}`,
          "",
          projection.body,
          "",
        ];
        if (reason === "gh-not-found") {
          lines.push(
            "gh CLI が見つかりません。GitHub MCP ツールを持つスキル側で適用してください。",
            "",
            "  1. issue を作成する（既存の参照があれば、その issue を更新する）",
            "  2. 参照を記録する: hikyaku cycle link --external <issueのURL>",
          );
        }
        return lines.join("\n");
      });
      return;
    }

    let action: "created" | "updated";
    let ref = projection.existing;
    try {
      const number = refNumber(projection.existing);
      if (number === undefined) {
        const { stdout } = await run(
          "gh",
          ["issue", "create", "--title", projection.title, "--body", projection.body, ...repoArgs(config.external.githubRepo)],
          { cwd: config.repoRoot, timeout: 30_000 },
        );
        ref = formatRef(stdout.trim().split("\n").pop() ?? "", "issue");
        action = "created";
      } else {
        await run(
          "gh",
          ["issue", "edit", number, "--title", projection.title, "--body", projection.body, ...repoArgs(config.external.githubRepo)],
          { cwd: config.repoRoot, timeout: 30_000 },
        );
        action = "updated";
      }
    } catch (error) {
      const message = error instanceof Error ? (error.message.split("\n")[0] ?? error.message) : String(error);
      warn(`サイクルの issue の起票に失敗しました: ${message}`);
      emit({ target, cycle: ctx.name, applied: false, reason: "failed", action: "failed", ref: message }, () =>
        `${ctx.name} → github  failed  ${message}`,
      );
      return;
    }

    // 作成した参照をファイルへ記録する。手で書き写す運用は必ず抜ける
    if (ref !== ctx.record.external) {
      const records = loadCycles(config.hikyakuRoot).map((record) =>
        record.id === ctx.record.id ? { ...record, external: ref } : record,
      );
      writeFileSync(cyclesPath(config.hikyakuRoot), renderCyclesFile(records), "utf8");
    }

    emit({ target, cycle: ctx.name, applied: true, action, ref }, () =>
      [`${ctx.name} → github  ${action}  ${ref}`, "", "参照は cycles.md の外部列に記録しました。"].join("\n"),
    );
  },
});

register({
  name: "external ref",
  summary: "PR 本文に入れるサイクルの issue への参照行を生成する",
  usage: "hikyaku external ref <phase> [<cycle>] [--root <path>]",
  details: [
    "サイクルの issue が記録されているとき、PR から issue へリンクするための1行を返します。",
    "",
    "  close     Closes #{サイクルの issue}",
    "  その他     Refs #{サイクルの issue}（閉じない）",
    "",
    "GitHub のクローズキーワードは `#12` か URL しか解釈しないため、Markdown リンク",
    "ではなく素の番号で出します（リンクだけ張られて issue が閉じない事故を防ぐため）。",
    "",
    "参照がまだ記録されていない、または target が none の場合は空を返します。",
    "PR 本文にリンクが無いこと自体は問題ではないので、エラーにはしません。",
    "",
    "**issue が閉じても完了判定には使いません。** 判定は常に tasklist.md の PR 列です。",
  ].join("\n"),
  run: ({ args, operands }) => {
    const phaseRaw = operands[0];
    if (phaseRaw === undefined || !isPhase(phaseRaw)) {
      throw new HikyakuError(
        "フェーズを指定してください",
        "使用できる値: init | token-guide | create | plan | architect | build-NN | close | conductor",
      );
    }
    const phase: Phase = phaseRaw;
    const { config, context: ctx } = openCycle(args, operands[1]);
    assertCurrentConfig(config);

    const reference = ctx.record.external;
    const number = refNumber(reference);
    const url = refUrl(reference);
    // ファイルへのローカルリンクのような、外部への参照でない値は出さない
    const subject = number !== undefined ? `#${number}` : url !== undefined && /^https?:\/\//.test(url) ? url : undefined;
    if (config.external.target === "none" || subject === undefined) {
      emit({ line: "", target: config.external.target }, () => "");
      return;
    }

    const line = `${phase === "close" ? "Closes" : "Refs"} ${subject}`;
    emit({ line, target: config.external.target, phase, cycle: ctx.name }, () => line);
  },
});
