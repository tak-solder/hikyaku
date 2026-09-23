/** validate — ワークスペース全体の整合性を検証する */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { flagString } from "../lib/args.mts";
import { loadConfig } from "../lib/config.mts";
import { cycleDir, cycleDirName, loadCycles } from "../lib/cycles.mts";
import { loadGuide, validateGuide } from "../lib/docs.mts";
import { HikyakuError, ValidationError } from "../lib/errors.mts";
import { emit } from "../lib/output.mts";
import { register } from "../lib/registry.mts";
import { buildDirName, loadTasklist, validateGraph } from "../lib/tasklist.mts";

interface Problem {
  scope: string;
  message: string;
}

/** HIKYAKU_ROOT 直下で改名したファイル。[旧名, 新名] */
const RENAMED_FILES: [string, string][] = [["instruction.md", "instructions.md"]];

register({
  name: "validate",
  summary: "document-guide・cycles.md・各 tasklist の整合性をまとめて検証する",
  usage: "hikyaku validate [<cycle>] [--root <path>] [--json]",
  details: [
    "検証する内容:",
    "  - 読み込まれなくなった旧名のファイルが残っていないか",
    "  - document-guide.md のパスが実在するか（docs validate と同じ）",
    "  - cycles.md の依存先サイクルが存在するか、循環していないか",
    "  - 各サイクルのディレクトリが存在するか",
    "  - 各 tasklist.md の依存グラフに循環や存在しない依存が無いか",
    "  - tasklist.md に登録されたビルドの issue.md が存在するか",
    "",
    "スキル内の検証は Hikyaku が書いたものしか見ませんが、これを CI から",
    "呼べば人間が手で編集した内容の不整合も拾えます。",
    "",
    "問題が見つかった場合は終了コード 2 で終了します。",
  ].join("\n"),
  run: ({ args, operands }) => {
    const config = loadConfig({ root: flagString(args, "root") });
    const problems: Problem[] = [];

    // 旧名のまま置かれていると、スキルが読まなくなったことに誰も気づけない。
    // 「設定したのに効かない」という最も気づきにくい壊れ方なので、黙って無視しない
    for (const [stale, current] of RENAMED_FILES) {
      if (!existsSync(join(config.hikyakuRoot, stale))) continue;
      const hint = existsSync(join(config.hikyakuRoot, current))
        ? `${current} が既にあります。旧名のファイルは削除してください`
        : `git mv で ${current} へ改名してください`;
      problems.push({
        scope: stale,
        message: `${current} に改名されました。この名前では読み込まれません。${hint}`,
      });
    }

    for (const problem of validateGuide(loadGuide(config.hikyakuRoot), config.repoRoot)) {
      problems.push({ scope: `document-guide/${problem.entry}`, message: problem.message });
    }

    const records = loadCycles(config.hikyakuRoot);
    const ids = new Set(records.map((record) => record.id));
    const filter = operands[0];

    // 引数のタイプミスで対象サイクルが1つも検証されないまま成功するのを防ぐ。
    // 「検証した結果、問題が無かった」と「そもそも検証していない」は別物
    if (
      filter !== undefined &&
      !records.some(
        (record) =>
          filter === record.id || filter === record.slug || filter === cycleDirName(record),
      )
    ) {
      throw new HikyakuError(
        `サイクルが見つかりません: ${filter}`,
        "hikyaku cycle list で一覧を確認してください。",
      );
    }

    for (const record of records) {
      const name = cycleDirName(record);
      if (filter !== undefined && filter !== record.id && filter !== record.slug && filter !== name) {
        continue;
      }

      for (const dep of record.dependsOn) {
        if (!ids.has(dep)) {
          problems.push({ scope: `cycles/${name}`, message: `依存先のサイクルが存在しません: ${dep}` });
        }
        if (dep === record.id) {
          problems.push({ scope: `cycles/${name}`, message: "自分自身に依存しています" });
        }
      }

      const directory = cycleDir(config.hikyakuRoot, record);
      if (!existsSync(directory)) {
        problems.push({ scope: `cycles/${name}`, message: `ディレクトリが存在しません: ${directory}` });
        continue;
      }

      const builds = loadTasklist(directory);
      for (const problem of validateGraph(builds)) {
        problems.push({ scope: `${name}/tasklist`, message: problem.message });
      }
      // ディレクトリではなく issue.md の有無を見る。git は空ディレクトリを追跡
      // しないため、ディレクトリの存在は clone 後に再現しない
      for (const build of builds) {
        const issuePath = join(directory, buildDirName(build.id), "issue.md");
        if (!existsSync(issuePath)) {
          problems.push({
            scope: `${name}/${buildDirName(build.id)}`,
            message: "tasklist.md に登録されていますが issue.md がありません",
          });
        }
      }
    }

    for (const cycle of findCycleDependencyLoops(records)) {
      problems.push({
        scope: "cycles",
        message: `サイクル間の依存に循環があります: ${cycle.join(" → ")}`,
      });
    }

    emit({ ok: problems.length === 0, problems }, () =>
      problems.length === 0
        ? "整合性の問題は見つかりませんでした。"
        : problems.map((p) => `✗ ${p.scope}: ${p.message}`).join("\n"),
    );

    if (problems.length > 0) {
      throw new ValidationError(problems.map((p) => `${p.scope}: ${p.message}`));
    }
  },
});

function findCycleDependencyLoops(
  records: { id: string; dependsOn: string[] }[],
): string[][] {
  const edges = new Map(records.map((record) => [record.id, record.dependsOn]));
  const state = new Map<string, "visiting" | "done">();
  const found: string[][] = [];
  const stack: string[] = [];

  const visit = (id: string): void => {
    const current = state.get(id);
    if (current === "done") return;
    if (current === "visiting") {
      found.push([...stack.slice(stack.indexOf(id)), id]);
      return;
    }
    state.set(id, "visiting");
    stack.push(id);
    for (const next of edges.get(id) ?? []) {
      if (edges.has(next)) visit(next);
    }
    stack.pop();
    state.set(id, "done");
  };

  for (const record of records) visit(record.id);
  return found;
}
