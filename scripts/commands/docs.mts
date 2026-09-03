/** docs list / validate / link — document-guide.md を扱う */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { flagBoolean, flagString } from "../lib/args.mts";
import { loadConfig } from "../lib/config.mts";
import { HikyakuError, ValidationError } from "../lib/errors.mts";
import {
  DOC_DEFINITIONS,
  guidePath,
  loadGuide,
  renderIndexBlock,
  validateGuide,
} from "../lib/docs.mts";
import { renderTable, upsertMarkerBlock } from "../lib/markdown.mts";
import { emit, table } from "../lib/output.mts";
import { register } from "../lib/registry.mts";

const INDEX_MARKER = "hikyaku:docs";

register({
  name: "docs list",
  summary: "document-guide.md を解析して永続ドキュメントの一覧を返す",
  usage: "hikyaku docs list [--root <path>] [--json]",
  details: [
    "管理列の意味:",
    "  hikyaku  Hikyaku のテンプレートに従う。書く/書かない・振る舞い・形式のすべてを適用",
    "  repo     既存形式が正。Hikyaku は追記のみで、形式には手を出さない",
    "  未作成    次に必要になったとき Hikyaku が作成する",
    "  対象外    意図的に持たない（理由を概要欄に書く）",
  ].join("\n"),
  run: ({ args }) => {
    const config = loadConfig({ root: flagString(args, "root") });
    const entries = loadGuide(config.hikyakuRoot);

    emit({ entries }, () =>
      table(
        entries.map((e) => [e.name, e.ownership, e.path ?? "—", e.summary]),
        ["論理名", "管理", "パス", "概要"],
      ),
    );
  },
});

register({
  name: "docs validate",
  summary: "document-guide.md のパスが実在するか、記載に漏れがないかを検証する",
  usage: "hikyaku docs validate [--root <path>] [--json]",
  details: [
    "検証する内容:",
    "  - 論理名が既知のものか、重複していないか",
    "  - 管理が hikyaku / repo の行のパスが実在するか",
    "  - 必要なドキュメントの行が揃っているか（未作成 / 対象外 でも行は必要）",
    "  - 対象外の行に理由が書かれているか",
    "",
    "ポインタ形式にしている利点がここに出る。コピーと違い、陳腐化を機械検出できる。",
    "",
    "問題が見つかった場合は終了コード 2 で終了します。",
  ].join("\n"),
  run: ({ args }) => {
    const config = loadConfig({ root: flagString(args, "root") });
    const entries = loadGuide(config.hikyakuRoot);
    const problems = validateGuide(entries, config.repoRoot);

    emit({ ok: problems.length === 0, problems }, () =>
      problems.length === 0
        ? "document-guide.md に問題は見つかりませんでした。"
        : problems.map((p) => `✗ ${p.entry}: ${p.message}`).join("\n"),
    );

    if (problems.length > 0) {
      throw new ValidationError(problems.map((p) => `${p.entry}: ${p.message}`));
    }
  },
});

register({
  name: "docs link",
  summary: "AGENTS.md の索引ブロックを document-guide.md から再生成する",
  usage: "hikyaku docs link [--root <path>] [--dry-run]",
  writes: true,
  details: [
    "AGENTS.md（無ければ CLAUDE.md）に、マーカーで囲んだ索引ブロックを冪等に書き込みます。",
    "",
    "  <!-- hikyaku:docs:begin -->",
    "  ...生成される索引...",
    "  <!-- hikyaku:docs:end -->",
    "",
    "AGENTS.md は AI エージェントが自動で読む唯一の場所であり、ここに索引が無いと",
    "Hikyaku 以外のセッションは永続ドキュメントの存在に気づけません。",
    "マーカー方式なので、人間が書いた部分は保持されます。",
    "",
    "リポジトリ全体の AI 設定を書き換えるため、承認を取ってから実行してください。",
  ].join("\n"),
  run: ({ args }) => {
    const config = loadConfig({ root: flagString(args, "root") });
    const entries = loadGuide(config.hikyakuRoot);
    const dryRun = flagBoolean(args, "dry-run");

    const target = findInstructionFile(config.repoRoot);
    const before = existsSync(target) ? readFileSync(target, "utf8") : "";
    const { content, created } = upsertMarkerBlock(before, INDEX_MARKER, renderIndexBlock(entries));
    const changed = content !== before;
    const relPath = relative(config.repoRoot, target) || target;

    emit(
      { file: relPath, changed, created, dryRun, block: renderIndexBlock(entries) },
      () => {
        if (!changed) return `${relPath} の索引ブロックは最新です。変更はありません。`;
        const action = created ? "索引ブロックを追加します" : "索引ブロックを更新します";
        const lines = [`${relPath}: ${action}`, "", renderIndexBlock(entries)];
        if (dryRun) lines.push("", "(--dry-run のため書き込んでいません)");
        return lines.join("\n");
      },
    );

    if (changed && !dryRun) writeFileSync(target, content, "utf8");
  },
});

/** AGENTS.md を優先し、無ければ CLAUDE.md、どちらも無ければ AGENTS.md を新規作成する */
function findInstructionFile(repoRoot: string): string {
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const path = join(repoRoot, name);
    if (existsSync(path)) return path;
  }
  return join(repoRoot, "AGENTS.md");
}

register({
  name: "docs scaffold",
  summary: "document-guide.md の雛形を出力する（init から使う）",
  usage: "hikyaku docs scaffold [--root <path>]",
  details: [
    "既知の論理名をすべて『未作成』で並べた雛形を標準出力に書き出します。",
    "検出したリポジトリ固有ドキュメントを当てはめるのは init スキルの役割です。",
    "",
    "このコマンド自体はファイルを書き込みません。",
  ].join("\n"),
  run: ({ args }) => {
    const config = loadConfig({ root: flagString(args, "root"), allowMissingRoot: true });
    if (config.hikyakuRoot !== "" && existsSync(guidePath(config.hikyakuRoot))) {
      throw new HikyakuError(
        `既に存在します: ${guidePath(config.hikyakuRoot)}`,
        "上書きせずに既存の内容を編集してください。",
      );
    }
    const text = renderGuideScaffold();
    emit({ scaffold: text }, () => text);
  },
});

export function renderGuideScaffold(): string {
  const rows = DOC_DEFINITIONS.map((d) => [
    d.name,
    "未作成",
    "—",
    d.level === "required" ? d.purpose : `（任意）${d.purpose}`,
  ]);

  return [
    "# ドキュメントガイド",
    "",
    "このリポジトリの永続ドキュメントが、どこに、誰の管理で存在するかを宣言します。",
    "Hikyaku はこのファイルを唯一の手がかりとして永続ドキュメントを読み書きします。",
    "",
    "| 管理 | 意味 |",
    "| --- | --- |",
    "| `hikyaku` | Hikyaku のテンプレートに従う。形式まで Hikyaku が決める |",
    "| `repo` | 既存形式が正。Hikyaku は追記のみで、形式には手を出さない |",
    "| `未作成` | まだ無い。次に必要になったとき Hikyaku が作成する |",
    "| `対象外` | 意図的に持たない。理由を概要欄に書く |",
    "",
    renderTable(["論理名", "管理", "パス", "概要"], rows),
    "",
  ].join("\n");
}

