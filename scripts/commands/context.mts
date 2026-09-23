/**
 * context — そのフェーズで読むべきドキュメントの候補を返す。
 *
 * 「何を読むか」がフェーズごとに SKILL.md へ散らばると、4箇所に同じ表が載って
 * 必ず食い違う。フェーズ→論理名の対応はここが唯一の正。
 *
 * **絞り込みはしない。** どれが今回のスコープに関係するかは概要欄を読んで
 * 判断することで、それはスキル（LLM）の仕事。ここは候補と、なぜ候補なのかだけを
 * 返す。必要度を機械が言い切ると、概要欄で絞る判断を放棄して全部読む方向に倒れる。
 *
 * 返すのは**実在して読めるもの**だけ。欠落の検出は next（中断点）と validate の
 * 担当で、ここが兼ねると「読むもの」と「足りないもの」が同じ表に混ざる。
 * ただし未作成の永続ドキュメントは1行にまとめて添える（overview が無いことは
 * architect の調査方針を変えるため、消してしまうと判断材料が落ちる）。
 */

import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { isPhase, type Phase } from "../lib/branch.mts";
import { loadGuide, type DocEntry } from "../lib/docs.mts";
import { HikyakuError } from "../lib/errors.mts";
import { emit, table } from "../lib/output.mts";
import { register } from "../lib/registry.mts";
import { buildDirName, normalizeBuildId, type BuildRecord } from "../lib/tasklist.mts";
import { openCycle, type CycleContext } from "../lib/workspace.mts";

interface Suggestion {
  /** 論理名（永続ドキュメント）またはファイル名 */
  ref: string;
  /** どこから来た候補か */
  origin: "doc" | "cycle" | "build" | "workflow";
  /** リポジトリルートからの相対パス */
  path: string;
  /** document-guide の管理列。永続ドキュメント以外は undefined */
  ownership?: string;
  /** なぜ読むのか。概要欄と違い、Hikyaku 側の理由 */
  reason: string;
  /** document-guide の概要欄。絞り込みの判断材料 */
  summary?: string;
}

/**
 * フェーズごとに読む永続ドキュメントの論理名と、その理由。
 *
 * planner に overview を入れていないのは、企画が「何を作るか」の合意であって
 * 実装済みの現実を前提に置く場面ではないため。制約だけは再質問を避けるために読む。
 */
const DOC_REASONS: Record<string, Record<string, string>> = {
  plan: {
    constraints: "既に確定している非機能要件を再度質問しないため",
    glossary: "ユーザーストーリーで使う語を既存の定義に揃えるため",
  },
  architect: {
    overview: "実装済みの現実。既存コード調査の差分の基準になる",
    constraints: "既に確定している非機能要件。再度質問しないため",
    decisions: "過去の設計判断。採用理由とトレードオフを把握し、覆さないため",
    learnings: "既知の落とし穴",
    conventions: "規約",
    "security-model": "認証認可・信頼境界に触れる設計のため",
    "test-strategy": "テスト方針",
    glossary: "ドメイン用語",
    "tech-stack": "参考。コードと矛盾したらコードが正",
    "db-schema": "参考。正はマイグレーション",
    interfaces: "参考。正は OpenAPI / 型定義",
  },
  close: {
    overview: "昇格先。責務・境界・データフローの変化を反映する",
    learnings: "昇格先。再現条件が明確な落とし穴",
    constraints: "昇格先。実装中に判明した制約",
    conventions: "昇格先。以後の書き方・進め方の取り決め",
    decisions: "ADR の status を accepted → implemented に更新する",
  },
};

/** build-NN は architect と同じ集合を読む。理由だけ実装視点に寄せる */
const BUILD_DOC_REASONS: Record<string, string> = {
  ...DOC_REASONS["architect"],
  overview: "実装済みの現実。他サイクルの成果も含む",
  decisions: "過去の設計判断。実装中に覆さない（覆すなら handoff に記録する）",
};

function docReasons(phase: Phase): Record<string, string> {
  if (phase.startsWith("build-")) return BUILD_DOC_REASONS;
  return DOC_REASONS[phase] ?? {};
}

/** そのフェーズで読むサイクル成果物。[サイクルディレクトリからの相対パス, 理由] */
function cycleArtifacts(phase: Phase): [string, string][] {
  if (phase === "plan") {
    return [["planning/questions.md", "中断からの再開時、既に確認した内容"]];
  }
  if (phase === "architect") {
    return [
      ["planning/user-stories.md", "このサイクルの要件。設計の入力"],
      ["planning/questions.md", "企画で解消した論点"],
      ["design/codebase-survey.md", "中断からの再開時、既に調査した内容"],
      ["design/design-questions.md", "中断からの再開時、既に確認した内容"],
    ];
  }
  if (phase === "close") {
    return [
      ["design/design-delta.md", "このサイクルが作った差分。昇格候補の素材"],
      ["design/codebase-survey.md", "調査で得た知見"],
      ["tasklist.md", "全ビルドの完了状況"],
    ];
  }
  if (phase.startsWith("build-")) {
    return [
      ["design/design-delta.md", "このサイクルが作ろうとしている差分"],
      ["design/codebase-survey.md", "既存コード調査"],
      ["planning/user-stories.md", "このサイクルの要件"],
    ];
  }
  return [];
}

/**
 * 依存ビルドの handoff.md。
 *
 * 依存グラフは tasklist.md が持っているので、スキルが手で辿る必要はない。
 * 辿り漏らすと先行ビルドの実績を知らないまま実装することになる。
 */
function dependencyHandoffs(builds: BuildRecord[], id: string): [string, string][] {
  // tasklist 側は buildID を正規化して持つ（"02" ではなく "2"）。
  // 素の "02" で引くと依存を辿れず、静かに handoff を読み落とす
  const build = builds.find((b) => b.id === normalizeBuildId(id));
  if (!build) return [];
  return build.dependsOn.map((dep) => [
    `${buildDirName(dep)}/handoff.md`,
    `${buildDirName(id)} が依存する先行ビルドの申し送り`,
  ]);
}

register({
  name: "context",
  summary: "そのフェーズで読むべきドキュメントの候補を返す",
  usage: "hikyaku context <phase> [<cycle>] [--root <path>] [--json]",
  details: [
    "phase: plan | architect | build-NN | close",
    "",
    "返すのは候補と、なぜ候補なのかだけです。どれが今回のスコープに関係するかは",
    "概要欄を見て判断してください。全部読む必要はありません。",
    "",
    "実在して読めるものだけを返します。欠落の検出は next（中断点）と validate の",
    "担当です。ただし未作成の永続ドキュメントは末尾に1行だけ添えます",
    "（overview が無いことは architect の調査方針を変えるため）。",
    "",
    "永続ドキュメントの所在は document-guide.md が正です。管理が「対象外」の",
    "ものは候補にも未作成にも出しません（意図的に持たないため）。",
    "",
    "build-NN では、tasklist.md の依存グラフから先行ビルドの handoff.md を",
    "辿ります。手で辿ると漏れるためです。",
    "",
    "パスはすべてリポジトリルートからの相対です。--json はサブエージェントへの",
    "委任プロンプトに流し込む用途を想定しています（概要欄で絞る仕組みが",
    "委任先では使えないため、渡すものを呼び出し元が決める必要がある）。",
  ].join("\n"),
  run: ({ args, operands }) => {
    const rawPhase = operands[0];
    if (rawPhase === undefined) {
      throw new HikyakuError(
        "phase を指定してください",
        "使用できる値: plan | architect | build-NN | close",
      );
    }
    if (!isPhase(rawPhase) || rawPhase === "init" || rawPhase === "create") {
      throw new HikyakuError(
        `読むべきドキュメントを持たないフェーズです: ${rawPhase}`,
        "使用できる値: plan | architect | build-NN | close",
      );
    }
    const phase = rawPhase;

    const { config, context: ctx } = openCycle(args, operands[1]);
    const suggestions: Suggestion[] = [];
    const missing: string[] = [];

    for (const entry of docEntriesFor(loadGuide(config.hikyakuRoot), phase)) {
      const path = entry.path;
      if (path === undefined || !existsSync(join(config.repoRoot, path))) {
        missing.push(entry.name);
        continue;
      }
      suggestions.push({
        ref: entry.name,
        origin: "doc",
        path,
        ownership: entry.ownership,
        reason: docReasons(phase)[entry.name] as string,
        summary: entry.summary,
      });
    }

    const cycleRel = relative(config.repoRoot, ctx.directory);
    const pushIfPresent = (
      origin: Suggestion["origin"],
      rel: string,
      reason: string,
    ): void => {
      if (!existsSync(join(ctx.directory, rel))) return;
      suggestions.push({ ref: rel, origin, path: join(cycleRel, rel), reason });
    };

    for (const [rel, reason] of cycleArtifacts(phase)) pushIfPresent("cycle", rel, reason);

    if (phase.startsWith("build-")) {
      const id = normalizeBuildId(phase.slice("build-".length));
      // 番号のタイプミスで、それらしい候補が返って成功するのを防ぐ。
      // tasklist に無いビルドは存在しないビルドで、読むものも決められない
      if (!ctx.builds.some((b) => b.id === id)) {
        throw new HikyakuError(
          `tasklist.md に無いビルドです: ${phase}`,
          ctx.builds.length === 0
            ? "ビルドがまだ登録されていません。ARCHITECT フェーズで分割してください。"
            : `登録されているビルド: ${ctx.builds.map((b) => buildDirName(b.id)).join(", ")}`,
        );
      }
      pushIfPresent("cycle", `${buildDirName(id)}/issue.md`, "このビルドの定義");
      for (const [rel, reason] of dependencyHandoffs(ctx.builds, id)) {
        pushIfPresent("build", rel, reason);
      }
    }

    if (phase === "close") {
      for (const build of ctx.builds) {
        pushIfPresent(
          "build",
          `${buildDirName(build.id)}/handoff.md`,
          "昇格候補の素材。全ビルドの申し送りを読む",
        );
      }
    }

    const instructions = join(config.hikyakuRoot, "instructions.md");
    if (existsSync(instructions)) {
      suggestions.push({
        ref: "instructions.md",
        origin: "workflow",
        path: relative(config.repoRoot, instructions),
        reason: "このリポジトリで Hikyaku を回すときの指示。スキルより優先する",
      });
    }

    emit({ cycle: ctx.name, phase, suggestions, missingDocs: missing }, () =>
      render(ctx, phase, suggestions, missing),
    );
  },
});

/** そのフェーズが読む論理名のうち、「対象外」でないものを guide の並びで返す */
function docEntriesFor(entries: DocEntry[], phase: Phase): DocEntry[] {
  const reasons = docReasons(phase);
  return entries.filter((e) => reasons[e.name] !== undefined && e.ownership !== "対象外");
}

function render(
  ctx: CycleContext,
  phase: Phase,
  suggestions: Suggestion[],
  missing: string[],
): string {
  const lines = [`${ctx.name} / ${phase} で読む候補`, ""];

  const docs = suggestions.filter((s) => s.origin === "doc");
  if (docs.length > 0) {
    lines.push("永続ドキュメント（document-guide.md より）");
    lines.push(
      table(docs.map((s) => [s.ref, s.path, s.ownership ?? "", s.summary || s.reason])),
      "",
    );
  }

  const cycleRows = suggestions.filter((s) => s.origin === "cycle" || s.origin === "build");
  if (cycleRows.length > 0) {
    lines.push("サイクル・ビルド");
    lines.push(table(cycleRows.map((s) => [s.path, s.reason])), "");
  }

  const workflow = suggestions.filter((s) => s.origin === "workflow");
  if (workflow.length > 0) {
    lines.push("ワークフロー");
    lines.push(table(workflow.map((s) => [s.path, s.reason])), "");
  }

  if (missing.length > 0) {
    lines.push(`未作成: ${missing.join(", ")}`, "");
  }

  lines.push("概要欄を見て、今回のスコープに関係するものだけを読んでください。");
  return lines.join("\n");
}
