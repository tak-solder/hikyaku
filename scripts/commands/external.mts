/** external sync / ref — 外部システムへの片方向投影 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { flagBoolean, flagString } from "../lib/args.mts";
import { isPhase, type Phase } from "../lib/branch.mts";
import { type ExternalTarget, type ResolvedConfig } from "../lib/config.mts";
import { cyclesPath, loadCycles, renderCyclesFile } from "../lib/cycles.mts";
import { HikyakuError } from "../lib/errors.mts";
import { emit, warn } from "../lib/output.mts";
import { register } from "../lib/registry.mts";
import { formatRef, refNumber, refUrl } from "../lib/refs.mts";
import { buildDirName, isComplete, type BuildRecord } from "../lib/tasklist.mts";
import { openCycle, writeTasklist, type CycleContext } from "../lib/workspace.mts";

const run = promisify(execFile);

const FOOTER = [
  "---",
  "このページは Hikyaku がリポジトリから自動生成しています（片方向投影）。",
  "**編集はリポジトリ側で行ってください。** ここでの編集は次回の同期で失われます。",
];

/** 投影の単位。親（サイクル）と子（ビルド）で形は同じ */
interface Projection {
  kind: "parent" | "build";
  /** 子のみ。tasklist の buildID */
  buildId: string | undefined;
  title: string;
  body: string;
  /** 既に記録されている参照（cycles.md の外部列 / tasklist の issue 列） */
  existing: string;
}

/** tasklist.md の在り処。GitHub なら blob URL、それ以外はリポジトリ相対パス */
function tasklistLocation(config: ResolvedConfig, cycleName: string): string {
  const relative = `${relativeRoot(config)}/cycles/${cycleName}/tasklist.md`;
  if (config.external.target === "github" && config.external.githubRepo !== undefined) {
    const ref = config.baseBranch ?? "HEAD";
    return `https://github.com/${config.external.githubRepo}/blob/${ref}/${relative}`;
  }
  return relative;
}

function relativeRoot(config: ResolvedConfig): string {
  return config.hikyakuRoot.startsWith(`${config.repoRoot}/`)
    ? config.hikyakuRoot.slice(config.repoRoot.length + 1)
    : config.hikyakuRoot;
}

/**
 * 親 issue の本文。
 *
 * ビルド一覧と完了状態を毎回ファイルから作り直すので、何度同期しても収束する。
 * 完了の正は tasklist.md の PR 列であって、ここの表示ではない。
 */
function renderParentBody(config: ResolvedConfig, ctx: CycleContext): string {
  const rows =
    ctx.builds.length === 0
      ? ["（ビルドはまだ分割されていません）"]
      : ctx.builds.map(
          (build) =>
            `- [${isComplete(build) ? "x" : " "}] ${buildDirName(build.id)} ${build.title}` +
            `${build.issue === "" ? "" : ` — ${build.issue}`}`,
        );

  return [
    ctx.record.summary === "" ? "" : `${ctx.record.summary}\n`,
    `**profile**: ${ctx.record.profile || "—"}`,
    ctx.record.ticket === "" ? "" : `**チケット**: ${ctx.record.ticket}`,
    "",
    `**tasklist**: ${tasklistLocation(config, ctx.name)}`,
    "",
    "## ビルド",
    "",
    ...rows,
    "",
    "完了判定の正は tasklist.md の `PR` 列です。ここの表示は同期時点のものです。",
    "",
    ...FOOTER,
  ]
    .filter((line, index, all) => !(line === "" && all[index - 1] === ""))
    .join("\n");
}

function renderBuildBody(
  config: ResolvedConfig,
  ctx: CycleContext,
  build: BuildRecord,
  issueBody: string,
): string {
  const deps =
    build.dependsOn.length > 0
      ? `**依存**: ${build.dependsOn.map(buildDirName).join(", ")}（参考情報。依存判定の正は tasklist.md）`
      : "";
  const parent = ctx.record.external === "" ? "" : `**親**: ${ctx.record.external}`;
  const source = `${relativeRoot(config)}/cycles/${ctx.name}/${buildDirName(build.id)}/issue.md`;

  return [
    issueBody.trim(),
    "",
    parent,
    deps,
    "",
    `出典: \`${source}\``,
    "",
    ...FOOTER,
  ]
    .filter((line, index, all) => !(line === "" && all[index - 1] === ""))
    .join("\n");
}

function buildProjections(config: ResolvedConfig, ctx: CycleContext): Projection[] {
  const parent: Projection = {
    kind: "parent",
    buildId: undefined,
    title: `[${ctx.name}] ${ctx.record.summary || ctx.record.slug}`,
    body: renderParentBody(config, ctx),
    existing: ctx.record.external,
  };

  const builds = ctx.builds.flatMap((build) => {
    const issuePath = join(ctx.directory, buildDirName(build.id), "issue.md");
    if (!existsSync(issuePath)) return [];
    return [
      {
        kind: "build" as const,
        buildId: build.id,
        title: `[${ctx.name}] ${buildDirName(build.id)} ${build.title}`,
        body: renderBuildBody(config, ctx, build, readFileSync(issuePath, "utf8")),
        existing: build.issue,
      },
    ];
  });

  // 親を先に作る。子の本文が親を参照するため
  return [parent, ...builds];
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

/** 既存の参照から issue 番号を取り出す。無ければ新規作成 */
function existingNumber(projection: Projection): string | undefined {
  return refNumber(projection.existing);
}

interface SyncResult {
  kind: Projection["kind"];
  buildId: string | undefined;
  action: "created" | "updated" | "failed";
  ref: string;
}

register({
  name: "external sync",
  summary: "tasklist と issue.md を外部システムへ片方向で投影する",
  usage: "hikyaku external sync [<target>] [<cycle>] [--root <path>] [--dry-run]",
  writes: true,
  details: [
    "**マスターは常にファイル側です。** 外部システムは可視化のためのビューにすぎず、",
    "読み取りにも完了判定にも使いません。投影は片方向・冪等で、何度実行しても収束します。",
    "",
    "投影する単位は2つです。",
    "",
    "  親  サイクルに1つ。tasklist へのリンクとビルド一覧を持つ",
    "  子  各ビルドの issue.md",
    "",
    "**親が無ければ先に作ります。** どのフェーズから同期を始めても収束するようにする",
    "ためで、通常は PLAN の PR を作る直前に最初の同期が走ります。その時点で親があれば、",
    "以降のすべての PR が親を参照できます。",
    "",
    "参照は作成後に自動で記録します（親は cycles.md の外部列、子は tasklist.md の",
    "issue 列）。手で書き写す運用は必ず抜けるためです。",
    "",
    "target を省略すると .hikyaku.config の [external] target を使います。",
    "",
    "  none    何もしない",
    "  github  gh CLI があれば issue を作成・更新する",
    "  asana   投影内容を出力する。反映は Asana MCP ツールを持つスキル側が行う",
    "",
    "**gh CLI が無い場合も投影内容を出力します。** スキル側が GitHub MCP で適用し、",
    "cycle link / tasklist link で参照を記録してください（出力の applied が false、",
    "reason が gh-not-found のとき）。",
    "",
    "**失敗してもワークフローは止めません。** 警告を出して終了コード 0 で終わります。",
    "外部システムに到達できないことが実装や設計を止める理由にはならないためです。",
  ].join("\n"),
  run: async ({ args, operands }) => {
    const known: ExternalTarget[] = ["none", "github", "asana"];
    const explicit = operands[0];
    const cycleKey =
      explicit !== undefined && !(known as string[]).includes(explicit) ? explicit : operands[1];

    const { config, context: ctx } = openCycle(args, cycleKey);
    const target = (
      explicit !== undefined && (known as string[]).includes(explicit)
        ? explicit
        : config.external.target
    ) as ExternalTarget;

    if (target === "none") {
      emit({ target, cycle: ctx.name, applied: false, reason: "target-none", projections: [] }, () =>
        "[external] target が none のため、投影する対象はありません。",
      );
      return;
    }

    const projections = buildProjections(config, ctx);
    const dryRun = flagBoolean(args, "dry-run");
    const gh = target === "github" && !dryRun ? await hasGh(config.repoRoot) : false;

    if (!gh) {
      const reason = dryRun ? "dry-run" : target === "asana" ? "asana" : "gh-not-found";
      emit({ target, cycle: ctx.name, applied: false, reason, projections }, () => {
        const lines = [`${ctx.name} → ${target}${dryRun ? "（--dry-run）" : ""}`, ""];
        for (const projection of projections) {
          lines.push(
            `## ${projection.title}`,
            `種別: ${projection.kind === "parent" ? "親（サイクル）" : `子（${buildDirName(projection.buildId ?? "")}）`}`,
            `参照: ${projection.existing || "（未作成）"}`,
            "",
            projection.body,
            "",
          );
        }
        if (reason === "gh-not-found") {
          lines.push(
            "gh CLI が見つかりません。GitHub MCP ツールを持つスキル側で適用してください。",
            "",
            "  1. 親を作成/更新する（既存参照があれば更新）",
            "  2. 子を作成/更新し、可能であれば親の sub-issue として紐づける",
            "  3. 参照を記録する:",
            "       hikyaku cycle link --external <親issueのURL>",
            "       hikyaku tasklist link --id <n> --issue <子issueのURL>",
          );
        } else if (reason === "asana") {
          lines.push(
            "Asana への反映は、Asana MCP ツールを持つスキル側で行ってください。",
            "スクリプトからは外部 API を呼びません。参照の記録は cycle link / tasklist link です。",
          );
        }
        return lines.join("\n");
      });
      return;
    }

    const results: SyncResult[] = [];
    let parentRef = ctx.record.external;
    const issueRefs = new Map<string, string>();

    for (const projection of projections) {
      // 親を作った直後の子は、親参照を本文に含められるよう作り直す
      const body =
        projection.kind === "build" && parentRef !== ctx.record.external
          ? projection.body.replace("**親**: ", `**親**: ${parentRef}`)
          : projection.body;
      try {
        const number = existingNumber(projection);
        if (number === undefined) {
          const { stdout } = await run(
            "gh",
            [
              "issue",
              "create",
              "--title",
              projection.title,
              "--body",
              body,
              ...repoArgs(config.external.githubRepo),
            ],
            { cwd: config.repoRoot, timeout: 30_000 },
          );
          const url = stdout.trim().split("\n").pop() ?? "";
          const ref = formatRef(url, projection.kind === "parent" ? "親issue" : "issue");
          results.push({ kind: projection.kind, buildId: projection.buildId, action: "created", ref });
          if (projection.kind === "parent") parentRef = ref;
          else if (projection.buildId !== undefined) issueRefs.set(projection.buildId, ref);
        } else {
          await run(
            "gh",
            ["issue", "edit", number, "--body", body, ...repoArgs(config.external.githubRepo)],
            { cwd: config.repoRoot, timeout: 30_000 },
          );
          results.push({
            kind: projection.kind,
            buildId: projection.buildId,
            action: "updated",
            ref: projection.existing,
          });
        }
      } catch (error) {
        const message =
          (error instanceof Error ? error.message.split("\n")[0] : String(error)) ?? String(error);
        warn(
          `${projection.kind === "parent" ? "親" : buildDirName(projection.buildId ?? "")} の投影に失敗しました: ${message}`,
        );
        results.push({
          kind: projection.kind,
          buildId: projection.buildId,
          action: "failed",
          ref: message,
        });
      }
    }

    // 作成した参照をファイルへ記録する。手で書き写す運用は必ず抜ける
    if (parentRef !== ctx.record.external) {
      const records = loadCycles(config.hikyakuRoot).map((record) =>
        record.id === ctx.record.id ? { ...record, external: parentRef } : record,
      );
      writeFileSync(cyclesPath(config.hikyakuRoot), renderCyclesFile(records), "utf8");
    }
    if (issueRefs.size > 0) {
      writeTasklist(
        ctx,
        ctx.builds.map((build) => {
          const ref = issueRefs.get(build.id);
          return ref === undefined ? build : { ...build, issue: ref };
        }),
      );
    }

    emit({ target, cycle: ctx.name, results, applied: true, parent: parentRef }, () =>
      [
        `${ctx.name} → github`,
        "",
        ...results.map(
          (r) =>
            `  ${r.kind === "parent" ? "親        " : buildDirName(r.buildId ?? "").padEnd(10)}${r.action}  ${r.ref}`,
        ),
        "",
        "参照は cycles.md の外部列と tasklist.md の issue 列に記録しました。",
      ].join("\n"),
    );
  },
});

register({
  name: "external ref",
  summary: "PR 本文に入れる外部システムへの参照行を生成する",
  usage: "hikyaku external ref <phase> [<cycle>] [--build <NN>] [--root <path>]",
  details: [
    "外部連携が有効なとき、PR から issue / タスクへリンクするための1行を返します。",
    "",
    "  build-NN  Closes #{そのビルドの子issue}",
    "  close     Closes #{親issue}",
    "  その他     Refs #{親issue}（閉じない）",
    "",
    "GitHub のクローズキーワードは `#12` か URL しか解釈しないため、Markdown リンク",
    "ではなく素の番号で出します（リンクだけ張られて issue が閉じない事故を防ぐため）。",
    "",
    "Asana はタスクの URL を1行で返します（Closes に相当する記法が無いため）。",
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
        "使用できる値: init | create | plan | architect | build-NN | close",
      );
    }
    const phase: Phase = phaseRaw;
    const { config, context: ctx } = openCycle(args, operands[1]);

    if (config.external.target === "none") {
      emit({ line: "", target: "none" }, () => "");
      return;
    }

    const buildId = flagString(args, "build") ?? /^build-(\d+)$/.exec(phase)?.[1];
    const build =
      buildId === undefined
        ? undefined
        : ctx.builds.find((item) => item.id === buildId.replace(/^0+(?=\d)/, ""));

    const reference = build?.issue ?? ctx.record.external;
    if (reference === undefined || reference === "" || reference.startsWith("[issue](./")) {
      // 初期値（ファイルへのローカルリンク）は外部への参照ではない
      emit({ line: "", target: config.external.target }, () => "");
      return;
    }

    const url = refUrl(reference);
    if (config.external.target === "asana") {
      const line = url === undefined ? "" : `タスク: ${url}`;
      emit({ line, target: "asana", phase, cycle: ctx.name, buildId }, () => line);
      return;
    }

    // GitHub のクローズキーワードは #12 か URL しか解釈しない。
    // Markdown リンクのまま置くと、リンクは張られても issue が閉じない
    const number = refNumber(reference);
    const subject = number === undefined ? url : `#${number}`;
    if (subject === undefined) {
      emit({ line: "", target: config.external.target }, () => "");
      return;
    }
    const closes = phase === "close" || /^build-\d+$/.test(phase);
    const line = `${closes ? "Closes" : "Refs"} ${subject}`;

    emit({ line, target: config.external.target, phase, cycle: ctx.name, buildId }, () => line);
  },
});
