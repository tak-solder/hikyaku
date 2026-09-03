/** external sync — 外部システムへの片方向投影 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { flagBoolean, flagString } from "../lib/args.mts";
import { loadConfig, type ExternalTarget } from "../lib/config.mts";
import { emit, warn } from "../lib/output.mts";
import { register } from "../lib/registry.mts";
import { buildDirName, loadTasklist, type BuildRecord } from "../lib/tasklist.mts";
import { resolveCycle } from "../lib/workspace.mts";

const run = promisify(execFile);

/** 投影する issue の本文。末尾のフッターが片方向であることを明示する */
function renderBody(repoPath: string, issueBody: string, build: BuildRecord): string {
  const deps =
    build.dependsOn.length > 0
      ? `\n\n**依存**: ${build.dependsOn.map(buildDirName).join(", ")}（参考情報。依存判定の正は tasklist.md）`
      : "";
  return [
    issueBody.trim(),
    deps,
    "",
    "---",
    `このissueは Hikyaku が \`${repoPath}\` から自動生成しています（片方向投影）。`,
    "**編集はリポジトリ側で行ってください。** ここでの編集は次回の同期で失われます。",
  ].join("\n");
}

interface Projection {
  buildId: string;
  title: string;
  body: string;
  /** 既存の外部レコードへの参照（tasklist の issue 列） */
  existing: string;
  sourcePath: string;
}

function buildProjections(
  cycleName: string,
  directory: string,
  builds: BuildRecord[],
): Projection[] {
  return builds.flatMap((build) => {
    const relative = `${cycleName}/${buildDirName(build.id)}/issue.md`;
    const issuePath = join(directory, buildDirName(build.id), "issue.md");
    if (!existsSync(issuePath)) return [];
    return [
      {
        buildId: build.id,
        title: `[${cycleName}] ${buildDirName(build.id)} ${build.title}`,
        body: renderBody(relative, readFileSync(issuePath, "utf8"), build),
        existing: build.issue,
        sourcePath: issuePath,
      },
    ];
  });
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

register({
  name: "external sync",
  summary: "tasklist と issue.md を外部システムへ片方向で投影する",
  usage: "hikyaku external sync [<target>] [<cycle>] [--root <path>] [--dry-run]",
  writes: true,
  details: [
    "**マスターは常にファイル側です。** 外部システムは可視化のためのビューにすぎず、",
    "読み取りにも完了判定にも使いません。投影は片方向・冪等で、何度実行しても収束します。",
    "",
    "外部側で人間が編集した内容は次回の同期で失われます。投影する本文の末尾に",
    "その旨のフッターを入れます。",
    "",
    "**失敗してもワークフローは止めません。** 警告を出して終了コード 0 で終わります。",
    "外部システムに到達できないことが実装や設計を止める理由にはならないためです。",
    "",
    "target を省略すると .hikyaku.config の [external] target を使います。",
    "",
    "  none    何もしない",
    "  github  gh CLI で issue を作成・更新する（gh が無ければ警告のみ）",
    "  asana   投影内容を出力する。実際の反映は Asana MCP ツールを持つスキル側が行う",
  ].join("\n"),
  run: async ({ args, operands }) => {
    const config = loadConfig({ root: flagString(args, "root") });
    const explicit = operands[0];
    const known: ExternalTarget[] = ["none", "github", "asana"];
    const target = (
      explicit !== undefined && (known as string[]).includes(explicit)
        ? explicit
        : config.external.target
    ) as ExternalTarget;
    const cycleKey = explicit !== undefined && !(known as string[]).includes(explicit)
      ? explicit
      : operands[1];

    if (target === "none") {
      emit({ target, synced: [] }, () =>
        "[external] target が none のため、投影する対象はありません。",
      );
      return;
    }

    const ctx = resolveCycle(config.hikyakuRoot, cycleKey);
    const projections = buildProjections(
      ctx.name,
      ctx.directory,
      loadTasklist(ctx.directory),
    );
    const dryRun = flagBoolean(args, "dry-run");

    if (projections.length === 0) {
      emit({ target, cycle: ctx.name, synced: [] }, () =>
        `${ctx.name}: 投影できる issue.md がありません。`,
      );
      return;
    }

    if (target === "asana" || dryRun) {
      // Asana は MCP ツール経由でしか操作できないため、投影内容を出力して
      // スキル側に委ねる。dry-run も同じ形で内容だけを見せる
      emit({ target, cycle: ctx.name, projections, applied: false }, () => {
        const lines = [
          `${ctx.name} → ${target}${dryRun ? "（--dry-run）" : ""}`,
          "",
          ...projections.map(
            (p) =>
              `## ${p.title}\n参照: ${p.existing || "（未作成）"}\n出典: ${p.sourcePath}\n\n${p.body}\n`,
          ),
        ];
        if (target === "asana") {
          lines.push(
            "",
            "Asana への反映は、Asana MCP ツールを持つスキル側で行ってください。",
            "スクリプトからは外部 API を呼びません。",
          );
        }
        return lines.join("\n");
      });
      return;
    }

    // github: gh CLI がある場合のみ実行する
    if (!(await hasGh(config.repoRoot))) {
      warn("gh CLI が見つからないため、GitHub への投影をスキップしました。");
      emit({ target, cycle: ctx.name, applied: false, reason: "gh-not-found" }, () =>
        [
          "gh CLI が見つかりません。GitHub への投影をスキップしました。",
          "",
          "投影は可視化のためのものなので、ワークフローは止まりません。",
          "後から `hikyaku external sync github` を実行すれば収束します。",
        ].join("\n"),
      );
      return;
    }

    const results: { buildId: string; action: string; ref: string }[] = [];
    for (const projection of projections) {
      try {
        const number = /#(\d+)/.exec(projection.existing)?.[1];
        if (number === undefined) {
          const { stdout } = await run(
            "gh",
            [
              "issue",
              "create",
              "--title",
              projection.title,
              "--body",
              projection.body,
              ...repoArgs(config.external.githubRepo),
            ],
            { cwd: config.repoRoot, timeout: 30_000 },
          );
          results.push({ buildId: projection.buildId, action: "created", ref: stdout.trim() });
        } else {
          await run(
            "gh",
            ["issue", "edit", number, "--body", projection.body, ...repoArgs(config.external.githubRepo)],
            { cwd: config.repoRoot, timeout: 30_000 },
          );
          results.push({ buildId: projection.buildId, action: "updated", ref: `#${number}` });
        }
      } catch (error) {
        const message =
          (error instanceof Error ? error.message.split("\n")[0] : String(error)) ?? String(error);
        warn(`${buildDirName(projection.buildId)} の投影に失敗しました: ${message}`);
        results.push({ buildId: projection.buildId, action: "failed", ref: message });
      }
    }

    emit({ target, cycle: ctx.name, results, applied: true }, () =>
      [
        `${ctx.name} → github`,
        "",
        ...results.map((r) => `  ${buildDirName(r.buildId)}  ${r.action}  ${r.ref}`),
        "",
        "作成した issue の URL は tasklist.md の issue 列へ手動で記録してください",
        "（issue 列は作成時に一度だけ記録し、以後不変です）。",
      ].join("\n"),
    );
  },
});

function repoArgs(repo: string | undefined): string[] {
  return repo === undefined ? [] : ["--repo", repo];
}

