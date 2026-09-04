/** init — ワークスペースの雛形を冪等に生成する */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { flagBoolean, flagString } from "../lib/args.mts";
import { PROFILE_NAMES } from "../lib/config.mts";
import { cyclesPath, renderCyclesFile } from "../lib/cycles.mts";
import { guidePath } from "../lib/docs.mts";
import { HikyakuError } from "../lib/errors.mts";
import { emit } from "../lib/output.mts";
import { repoRoot } from "../lib/paths.mts";
import { register } from "../lib/registry.mts";
import { renderGuideScaffold } from "./docs.mts";

interface PlannedFile {
  path: string;
  content: string;
  /** 既に存在する場合は生成をスキップする（冪等性のため既存は決して上書きしない） */
  status: "create" | "skip";
}

register({
  name: "init",
  summary: "HIKYAKU_ROOT の雛形（設定・cycles.md・document-guide.md）を生成する",
  usage: "hikyaku init --root <path> [--dry-run] [--json]",
  writes: true,
  details: [
    "生成するファイル（既存のものは決して上書きしません）:",
    "",
    "  リポジトリルート/.hikyaku.config   hikyaku_root を記録する",
    "  {HIKYAKU_ROOT}/.hikyaku.config     このワークフロー固有の上書き用（全項目コメントアウト）",
    "  {HIKYAKU_ROOT}/cycles.md           サイクル索引",
    "  {HIKYAKU_ROOT}/document-guide.md   ドキュメントガイドの雛形（全て『未作成』）",
    "",
    "既存の設計ドキュメントを検出して document-guide.md へ登録するのは",
    "/hikyaku:init スキルの役割です（対話が必要なため）。",
    "",
    "v1 と異なり {HIKYAKU_ROOT}/.gitignore は生成しません。ファイル正へ一本化した結果、",
    "除外すべきローカルキャッシュが無くなり、サイクル文書はすべてコミット対象になります。",
    "close-cycle が別セッションで retrospective.md を素材として読むため、除外すると読めません。",
  ].join("\n"),
  run: ({ args, operands }) => {
    const root = repoRoot();
    const requested = flagString(args, "root") ?? operands[0];
    if (requested === undefined) {
      throw new HikyakuError(
        "HIKYAKU_ROOT を指定してください",
        "例: hikyaku init --root docs/hikyaku",
      );
    }

    const hikyakuRoot = isAbsolute(requested) ? requested : resolve(root, requested);
    const rel = relative(root, hikyakuRoot) || ".";
    const dryRun = flagBoolean(args, "dry-run");

    const repoConfigPath = join(root, ".hikyaku.config");
    const repoConfigIssues = inspectRepoConfig(repoConfigPath, rel);

    const planned: PlannedFile[] = [
      plan(repoConfigPath, renderRepoConfig(rel)),
      plan(join(hikyakuRoot, ".hikyaku.config"), renderWorkspaceConfig()),
      plan(cyclesPath(hikyakuRoot), renderCyclesFile([])),
      plan(guidePath(hikyakuRoot), renderGuideScaffold()),
    ];

    emit(
      {
        hikyakuRoot,
        dryRun,
        files: planned.map((f) => ({ path: relative(root, f.path), status: f.status })),
        repoConfigIssues,
      },
      () => {
        const lines = [`HIKYAKU_ROOT: ${rel}`, ""];
        for (const file of planned) {
          const mark = file.status === "create" ? "+" : "=";
          const note = file.status === "create" ? "生成" : "既存のため変更しません";
          lines.push(`${mark} ${relative(root, file.path).padEnd(40)} ${note}`);
        }
        if (repoConfigIssues.length > 0) {
          lines.push(
            "",
            "⚠ 既存の .hikyaku.config に対応が必要です（このコマンドは既存ファイルを書き換えません）:",
            ...repoConfigIssues.map((issue) => `  - ${issue}`),
          );
        }
        if (dryRun) lines.push("", "(--dry-run のため書き込んでいません)");
        else if (planned.every((f) => f.status === "skip") && repoConfigIssues.length === 0) {
          lines.push("", "すべて既存のため、変更はありません。");
        }
        return lines.join("\n");
      },
    );

    if (dryRun) return;

    for (const file of planned) {
      if (file.status === "skip") continue;
      mkdirSync(join(file.path, ".."), { recursive: true });
      writeFileSync(file.path, file.content, "utf8");
    }
  },
});

function plan(path: string, content: string): PlannedFile {
  return { path, content, status: existsSync(path) ? "skip" : "create" };
}

/**
 * 既存のリポジトリルート設定を検査する。
 *
 * init は既存ファイルを決して上書きしないため、既に .hikyaku.config がある場合は
 * hikyaku_root が記録されないまま終わる。黙って進むと、設定が古い doc_root を
 * 指したままになり、以降のコマンドが別のパスを見にいく。必要な対応を明示する。
 */
function inspectRepoConfig(path: string, expectedRoot: string): string[] {
  if (!existsSync(path)) return [];
  const source = readFileSync(path, "utf8");
  const issues: string[] = [];

  const declared = /^\s*hikyaku_root\s*=\s*["']([^"']*)["']/m.exec(source)?.[1];
  const legacy = /^\s*doc_root\s*=\s*["']([^"']*)["']/m.exec(source)?.[1];

  if (declared === undefined && legacy !== undefined) {
    issues.push(
      `doc_root = "${legacy}" は v1 のキーです。hikyaku_root = "${expectedRoot}" にリネームしてください`,
    );
  } else if (declared === undefined) {
    issues.push(`hikyaku_root = "${expectedRoot}" を追記してください`);
  } else if (declared !== expectedRoot) {
    issues.push(
      `hikyaku_root が "${declared}" ですが、今回指定されたのは "${expectedRoot}" です。どちらが正しいか確認してください`,
    );
  }

  if (/^\s*issue_backend\s*=/m.test(source)) {
    issues.push(
      "issue_backend は廃止されました。[external] target へ移行してください（完了判定が変わるため自動変換しません）",
    );
  }
  return issues;
}

/** リポジトリルートの設定。hikyaku_root はここでのみ有効 */
function renderRepoConfig(hikyakuRoot: string): string {
  return [
    "# Hikyaku の設定（リポジトリ全体）",
    "#",
    "# ドキュメントの所在は document-guide.md が唯一の宣言先です。",
    "# このファイルには振る舞いの設定だけを書きます。",
    "",
    `hikyaku_root = "${hikyakuRoot}"`,
    "",
    "# サイクル作成時に提示する profile の既定値。",
    "# 無条件には採用されず、create-cycle が必ず明示的な選択を求めます。",
    `# profile = "standard"   # ${PROFILE_NAMES.join(" | ")}`,
    "",
    "# PR のベースブランチ（未設定ならリポジトリのデフォルトブランチを自動検出）",
    '# base_branch = "main"',
    "",
    "# ビルド分割の BP 上限",
    "# bp_max = 8",
    "",
    "# [branch]",
    "# ブランチ名は {prefix}{separator}{cycle}{separator}{phase} で構成します。",
    "# 着手状態の導出にブランチ名を解析するため、構造は固定です。",
    '# prefix = "hikyaku"',
    '# separator = "/"        # 空文字は不可（解析できなくなるため）',
    "",
    "# [pr]",
    "# PR タイトルは表示専用なので自由に組み立てられます。",
    "# 使える変数: {cycle} {cycle_id} {cycle_name} {phase} {build_id} {title}",
    '# title = "[hikyaku] {cycle}: {phase} {title}"',
    "",
    "# [review.security]",
    "# security_review を推奨する判定基準。設定すると既定値を丸ごと置き換えます。",
    "# 機微情報の定義はプロダクトごとに異なるため、自然言語で記述します。",
    "# triggers = \"\"\"",
    "# - 個人情報・秘密情報を扱う",
    "# - 認証・認可",
    "# - 決済",
    "# \"\"\"",
    "",
    "# [external]",
    "# 外部システムへは冪等な片方向投影のみを行います。マスターは常にファイル側です。",
    '# target = "none"        # none | github | asana',
    '# github_repo = "owner/repo"',
    '# asana_project_gid = "..."',
    "",
  ].join("\n");
}

/** HIKYAKU_ROOT 側の上書き設定。hikyaku_root 以外のキーを指定できる */
function renderWorkspaceConfig(): string {
  return [
    "# このワークフロー固有の設定",
    "#",
    "# リポジトリルートの .hikyaku.config をキー単位で上書きします。",
    "# hikyaku_root はここでは指定できません（リポジトリルートでのみ有効）。",
    "",
    '# profile = "standard"',
    "# bp_max = 8",
    "",
  ].join("\n");
}
