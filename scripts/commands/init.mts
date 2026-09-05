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
    "  リポジトリルート/.hikyaku.config   設定の唯一のベース。hikyaku_root を記録する",
    "  {HIKYAKU_ROOT}/cycles.md           サイクル索引",
    "  {HIKYAKU_ROOT}/document-guide.md   ドキュメントガイドの雛形（全て『未作成』）",
    "  {HIKYAKU_ROOT}/.gitignore          .hikyaku.local だけを除外する",
    "",
    "既存の設計ドキュメントを検出して document-guide.md へ登録するのは",
    "/hikyaku:init スキルの役割です（対話が必要なため）。",
    "",
    "設定を置ける場所はリポジトリルートとサイクルディレクトリの2箇所だけです。",
    "{HIKYAKU_ROOT}/.hikyaku.config は作りません（読み込まれません）。",
    "",
    ".gitignore が除外するのは .hikyaku.local の1行だけです。サイクル文書はすべて",
    "コミット対象にします。close-cycle が別セッションで retrospective.md を素材として",
    "読むため、まとめて除外すると読めなくなります。"
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
    const repoConfigIssues = [
      ...inspectRepoConfig(repoConfigPath, rel),
      ...inspectStaleWorkspaceConfig(hikyakuRoot),
    ];

    const planned: PlannedFile[] = [
      plan(repoConfigPath, renderRepoConfig(rel)),
      plan(cyclesPath(hikyakuRoot), renderCyclesFile([])),
      plan(guidePath(hikyakuRoot), renderGuideScaffold()),
      plan(join(hikyakuRoot, ".gitignore"), renderGitignore()),
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

/**
 * v2.0 の初期実装が生成していた中間層の設定を検出する。
 * 読み込まれなくなったので、置いたままだと設定が黙って無視される。
 */
function inspectStaleWorkspaceConfig(hikyakuRoot: string): string[] {
  const path = join(hikyakuRoot, ".hikyaku.config");
  if (!existsSync(path)) return [];
  return [
    `${path} は読み込まれません。内容をリポジトリルートの .hikyaku.config へ移して削除してください`,
  ];
}

/**
 * リポジトリルートの設定。hikyaku_root はここでのみ有効。
 *
 * テーブルの見出し（[branch] など）はコメントアウトしない。見出しごと
 * コメントアウトすると、利用者がキーのコメントだけを外したときに
 * そのキーがトップレベルへ落ちて黙って無視される。空テーブルは既定値へ
 * フォールバックするので、見出しを出しておいても実害はない。
 */
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
    "# ブランチ名は {prefix}{separator}{cycle}{separator}{phase} で構成します。",
    "# 着手状態の導出にブランチ名を解析するため、構造は固定です。",
    "[branch]",
    '# prefix = "hikyaku"',
    '# separator = "/"        # 空文字は不可（解析できなくなるため）',
    "",
    "# PR タイトルは表示専用なので自由に組み立てられます。",
    "# 使える変数: {cycle} {cycle_id} {cycle_name} {phase} {build_id} {title}",
    "[pr]",
    '# title = "[hikyaku] {cycle}: {phase} {title}"',
    "",
    "# セッション名。変数は [pr] と共通です。",
    "# 空文字にするとセッション名を変更しません。",
    "[session]",
    '# title = "{cycle} {phase} {title}"',
    "",
    "# security_review を推奨する判定基準。設定すると既定値を丸ごと置き換えます。",
    "# 機微情報の定義はプロダクトごとに異なるため、自然言語で記述します。",
    "[review.security]",
    "# triggers = \"\"\"",
    "# - 個人情報・秘密情報を扱う",
    "# - 認証・認可",
    "# - 決済",
    "# \"\"\"",
    "",
    "# 外部システムへは冪等な片方向投影のみを行います。マスターは常にファイル側です。",
    "[external]",
    '# target = "none"        # none | github | asana',
    '# github_repo = "owner/repo"',
    '# asana_project_gid = "..."',
    "",
  ].join("\n");
}

/**
 * HIKYAKU_ROOT の .gitignore。
 *
 * 除外するのは作業の栞（.hikyaku.local）だけ。包括パターンは書かない。
 * サイクル文書はすべてコミット対象で、とくに retrospective.md は close-cycle が
 * 別セッションから昇格素材として読むため、除外すると読めなくなる。
 */
function renderGitignore(): string {
  return [
    "# 最後に作業したサイクルを記録するローカル専用ファイル",
    ".hikyaku.local",
    "",
  ].join("\n");
}
