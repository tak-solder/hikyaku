/** cycle new / list / status / close — サイクルのライフサイクル操作 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { flagBoolean, flagList, flagString } from "../lib/args.mts";
import { branchName } from "../lib/branch.mts";
import { loadConfig, PROFILE_NAMES, type ProfileName } from "../lib/config.mts";
import {
  cycleDir,
  cycleDirName,
  cyclesPath,
  loadCycles,
  nextCycleId,
  normalizeSlug,
  renderCyclesFile,
  type CycleRecord,
} from "../lib/cycles.mts";
import { HikyakuError } from "../lib/errors.mts";
import { listRemoteBranches } from "../lib/git.mts";
import { localPath, readLocalState, writeLocalState } from "../lib/local.mts";
import { deriveState, suggestCommand } from "../lib/phase.mts";
import { emit, table } from "../lib/output.mts";
import { pluginVersion } from "../lib/paths.mts";
import { register } from "../lib/registry.mts";
import { isComplete, loadTasklist } from "../lib/tasklist.mts";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function findCycle(records: CycleRecord[], key: string): CycleRecord {
  const found = records.find(
    (record) => record.id === key || record.slug === key || cycleDirName(record) === key,
  );
  if (!found) {
    throw new HikyakuError(
      `サイクルが見つかりません: ${key}`,
      `hikyaku cycle list で一覧を確認してください。`,
    );
  }
  return found;
}

register({
  name: "cycle new",
  summary: "サイクルを採番してディレクトリを作り、cycles.md に追記する",
  usage: "hikyaku cycle new <slug> --profile <name> [--ticket <ref>] [--depends 001,002] [--dry-run]",
  writes: true,
  details: [
    "--profile は必須です。サイクルの厳格さは作成時に明示的に選ぶ必要があります",
    `（${PROFILE_NAMES.join(" | ")}）。config の profile は推奨値の提示にすぎず、`,
    "無条件には採用しません。",
    "",
    "slug は英数字とハイフンに正規化されます。ブランチ名の解析を壊さないためです。",
    "",
    "cycles.md には作成時の Hikyaku バージョンも記録します。ディレクトリ構造や",
    "ファイル形式は作成時に決まるため、後からそれを解釈するのに必要です。",
    "",
    "--depends はサイクルレベルの依存です。ビルドレベルのクロスサイクル依存は",
    "依存グラフが2次元になって破綻するため、扱いません。",
  ].join("\n"),
  run: ({ args, operands }) => {
    const config = loadConfig({ root: flagString(args, "root") });
    const rawSlug = operands[0];
    if (rawSlug === undefined) {
      throw new HikyakuError("slug を指定してください", "例: hikyaku cycle new billing --profile light");
    }

    const profile = flagString(args, "profile");
    if (profile === undefined) {
      throw new HikyakuError(
        "--profile を指定してください",
        [
          "サイクルの厳格さは作成時に明示的に選ぶ必要があります。",
          "",
          "  light     承認ゲート最小・レビューは有効。人間の時間を節約する",
          "  saving    承認は残しレビューを落とす。AI 実行コストを節約する",
          "  standard  全レビュー有効・各フェーズで承認",
          "  strict    codebase-survey の確認を追加、validate を各ステップで実行",
        ].join("\n"),
      );
    }
    if (!(PROFILE_NAMES as string[]).includes(profile)) {
      throw new HikyakuError(
        `profile の値が不正です: ${profile}`,
        `使用できる値: ${PROFILE_NAMES.join(" | ")}`,
      );
    }

    const slug = normalizeSlug(rawSlug);
    const records = loadCycles(config.hikyakuRoot);
    if (records.some((record) => record.slug === slug && record.status === "active")) {
      throw new HikyakuError(`同じ slug の進行中サイクルが既にあります: ${slug}`);
    }

    const dependsOn = flagList(args, "depends") ?? [];
    for (const dep of dependsOn) {
      const target = records.find((record) => record.id === dep);
      if (!target) throw new HikyakuError(`依存先のサイクルが存在しません: ${dep}`);
    }

    const record: CycleRecord = {
      id: nextCycleId(records),
      slug,
      status: "active",
      profile: profile as ProfileName,
      hikyaku: pluginVersion(),
      ticket: flagString(args, "ticket") ?? "",
      dependsOn,
      started: today(),
      finished: "",
      summary: flagString(args, "summary") ?? "",
    };

    const directory = cycleDir(config.hikyakuRoot, record);
    const dryRun = flagBoolean(args, "dry-run");
    const active = records.filter((r) => r.status === "active");

    emit({ cycle: record, directory, dryRun, activeCycles: active.map((r) => cycleDirName(r)) }, () => {
      const lines = [
        `サイクル ${cycleDirName(record)} を作成します`,
        "",
        `  profile   ${record.profile}`,
        `  hikyaku   ${record.hikyaku}`,
        `  チケット  ${record.ticket || "—"}`,
        `  依存      ${dependsOn.length > 0 ? dependsOn.join(", ") : "—"}`,
        `  ディレクトリ  ${relative(config.repoRoot, directory)}`,
        `  ブランチ  ${branchName(config.branch, "create", cycleDirName(record))}`,
      ];
      if (active.length > 0) {
        lines.push(
          "",
          "他に進行中のサイクルがあります。設計の重複に注意してください:",
          ...active.map((r) => `  - ${cycleDirName(r)}（${r.summary || "要約なし"}）`),
        );
      }
      if (dryRun) lines.push("", "(--dry-run のため書き込んでいません)");
      return lines.join("\n");
    });

    if (dryRun) return;

    mkdirSync(join(directory, "planning"), { recursive: true });
    mkdirSync(join(directory, "design"), { recursive: true });
    writeFileSync(cyclesPath(config.hikyakuRoot), renderCyclesFile([...records, record]), "utf8");
  },
});

register({
  name: "cycle use",
  summary: "このチェックアウトで作業するサイクルを記録する",
  usage: "hikyaku cycle use <id|slug> [--root <path>] [--dry-run]",
  writes: true,
  details: [
    "{HIKYAKU_ROOT}/.hikyaku.local に記録します。git 管理対象外なので、",
    "他のメンバーには影響しません。",
    "",
    "サイクル省略時の対象決定は 現在のブランチ → この記録 → 唯一の進行中サイクル",
    "の順です。チーム開発では「最後にコミットされたサイクル」が他メンバーのもので",
    "あることが普通なので、リポジトリ側からは導出せずここに記録します。",
    "",
    "これはワークフローの状態ではなく作業の栞です。読むのは対象サイクルの決定だけで、",
    "next / validate / cycle status など判断に使う処理は参照しません。消しても支障は",
    "ありません（次にどのサイクルで作業するかを尋ねられるだけです）。",
  ].join("\n"),
  run: ({ args, operands }) => {
    const config = loadConfig({ root: flagString(args, "root") });
    const key = operands[0];
    if (key === undefined) {
      throw new HikyakuError(
        "サイクルを指定してください",
        "例: hikyaku cycle use 002-billing",
      );
    }

    const record = findCycle(loadCycles(config.hikyakuRoot), key);
    const name = cycleDirName(record);
    const path = localPath(config.hikyakuRoot);
    // 壊れた栞に上書きできないと、復旧手段が無くなる。読めなければ無視して上書きする
    let previous: string | undefined;
    try {
      previous = readLocalState(config.hikyakuRoot).cycle;
    } catch {
      previous = undefined;
    }
    const dryRun = flagBoolean(args, "dry-run");

    emit({ cycle: name, previous, path, dryRun }, () => {
      const lines = [
        `作業サイクルを ${name} に設定します${previous ? `（前回: ${previous}）` : ""}`,
        `記録先: ${relative(config.repoRoot, path)}`,
      ];
      if (record.status !== "active") {
        lines.push(
          `⚠ このサイクルは ${record.status} です。省略時の対象には選ばれません（active のみ）。`,
        );
      }
      if (dryRun) lines.push("", "(--dry-run のため書き込んでいません)");
      return lines.join("\n");
    });

    if (!dryRun) writeLocalState(config.hikyakuRoot, name);
  },
});

register({
  name: "cycle list",
  summary: "サイクルの一覧と導出した状態を表示する",
  usage: "hikyaku cycle list [--active] [--root <path>] [--json]",
  details: [
    "--active を付けると進行中のサイクルだけを表示します。",
    "並行サイクルの検出はここを起点に行います。",
    "",
    "状態は保存せず導出します:",
    "  planning      user-stories.md が無い",
    "  architecting  user-stories.md はあるが tasklist.md（またはビルド）が無い",
    "  building      未完了のビルドがある",
    "  completed     全ビルドが完了。だが永続ドキュメントへの昇格がまだ",
    "  closed        cycles.md に記録された status",
  ].join("\n"),
  run: ({ args }) => {
    const config = loadConfig({ root: flagString(args, "root") });
    const records = loadCycles(config.hikyakuRoot);
    const onlyActive = flagBoolean(args, "active");

    const rows = records
      .filter((record) => !onlyActive || record.status === "active")
      .map((record) => {
        const directory = cycleDir(config.hikyakuRoot, record);
        const builds = loadTasklist(directory);
        const state = deriveState(directory, record, builds);
        const done = builds.filter(isComplete).length;
        return {
          record,
          phase: state.phase,
          progress: builds.length > 0 ? `${done}/${builds.length}` : "—",
        };
      });

    emit(
      { cycles: rows.map((row) => ({ ...row.record, phase: row.phase, progress: row.progress })) },
      () =>
        rows.length === 0
          ? "サイクルはまだありません。/hikyaku:create-cycle で作成してください。"
          : table(
              rows.map((row) => [
                cycleDirName(row.record),
                row.phase,
                row.record.profile || "—",
                row.progress,
                row.record.ticket || "—",
                row.record.summary || "—",
              ]),
              ["サイクル", "状態", "profile", "ビルド", "チケット", "要約"],
            ),
    );
  },
});

register({
  name: "cycle status",
  summary: "1つのサイクルの状態と、中断していればその再開点を表示する",
  usage: "hikyaku cycle status <id|slug> [--root <path>] [--json]",
  details: [
    "ブランチ上の成果物の有無から「どこまで進んだか」を割り出します。",
    "成果物が1つできるごとにコミット & push されていることが前提です",
    "（コミットされていなければ他セッションからは見えません）。",
    "",
    "必須成果物と条件付き成果物を区別します。条件付きが無くても未完了とは限りません。",
    "",
    "着手中のブランチは origin から取得します。到達できない場合は表示が落ちるだけで、",
    "着手可能・待機の判定には影響しません。",
  ].join("\n"),
  run: async ({ args, operands }) => {
    const config = loadConfig({ root: flagString(args, "root") });
    const key = operands[0];
    if (key === undefined) throw new HikyakuError("サイクルを指定してください");

    const records = loadCycles(config.hikyakuRoot);
    const record = findCycle(records, key);
    const name = cycleDirName(record);
    const directory = cycleDir(config.hikyakuRoot, record);
    const builds = loadTasklist(directory);
    const state = deriveState(directory, record, builds);

    const remote = await listRemoteBranches(config.repoRoot);
    const prefix = branchName(config.branch, "plan", name).replace(/plan$/, "");
    const inProgress = remote.names.filter((branchRef) => branchRef.startsWith(prefix));

    emit(
      {
        cycle: record,
        phase: state.phase,
        resumeAt: state.resumeAt,
        artifacts: state.artifacts,
        branches: inProgress,
        remoteUnavailable: remote.unavailable,
        suggestion: suggestCommand(state.phase, relative(config.repoRoot, config.hikyakuRoot), name),
      },
      () => {
        const lines = [
          `cycle ${name}: ${state.phase}${versionNote(record.hikyaku)}`,
          `  profile   ${record.profile || "—"}`,
        ];

        if (state.artifacts.length > 0) {
          lines.push("", "  成果物:");
          for (const artifact of state.artifacts) {
            const mark = artifact.present ? "✓" : artifact.required ? "✗" : "·";
            const note = artifact.present ? "" : artifact.required ? "" : "（条件付き）";
            const cursor = artifact.path === state.resumeAt ? "  ← ここから再開" : "";
            lines.push(`    ${mark} ${artifact.path}${note}${cursor}`);
          }
        }

        if (builds.length > 0) {
          const done = builds.filter(isComplete).length;
          lines.push("", `  ビルド: ${done}/${builds.length} 完了`);
        }

        if (remote.unavailable !== undefined) {
          lines.push("", `  ! origin に到達できないため、着手中ブランチは不明です`);
        } else if (inProgress.length > 0) {
          lines.push("", "  着手中のブランチ:", ...inProgress.map((b) => `    ${b}`));
        }

        lines.push(
          "",
          `  再開: ${suggestCommand(state.phase, relative(config.repoRoot, config.hikyakuRoot), name)}`,
        );
        return lines.join("\n");
      },
    );
  },
});

function versionNote(version: string): string {
  const current = pluginVersion();
  if (version === "" || version === current) return "";
  const [major] = version.split(".");
  const [currentMajor] = current.split(".");
  if (major !== currentMajor) {
    return `\n  ⚠ このサイクルは ${version} で作成されています（現在: ${current}）。構造が異なる可能性があります`;
  }
  return `（作成時: ${version}）`;
}

register({
  name: "cycle close",
  summary: "サイクルを closed にし、完了日を記録する",
  usage: "hikyaku cycle close <id|slug> [--summary <text>] [--dry-run]",
  writes: true,
  details: [
    "永続ドキュメントへの昇格が済んだサイクルを closed にします。",
    "昇格そのものは /hikyaku:close-cycle が行い、このコマンドは cycles.md の",
    "status と完了日を更新するだけです。",
    "",
    "全ビルドが完了していない場合は警告しますが、中止（abandoned）にする場合も",
    "あるため実行は止めません。--status abandoned で中止として記録できます。",
  ].join("\n"),
  run: ({ args, operands }) => {
    const config = loadConfig({ root: flagString(args, "root") });
    const key = operands[0];
    if (key === undefined) throw new HikyakuError("サイクルを指定してください");

    const records = loadCycles(config.hikyakuRoot);
    const record = findCycle(records, key);
    const status = flagString(args, "status") ?? "closed";
    if (status !== "closed" && status !== "abandoned") {
      throw new HikyakuError(`--status は closed か abandoned を指定してください`);
    }

    const builds = loadTasklist(cycleDir(config.hikyakuRoot, record));
    const incomplete = builds.filter((build) => !isComplete(build));

    const updated: CycleRecord = {
      ...record,
      status,
      finished: today(),
      summary: flagString(args, "summary") ?? record.summary,
    };
    const dryRun = flagBoolean(args, "dry-run");

    emit({ cycle: updated, incomplete: incomplete.map((b) => b.id), dryRun }, () => {
      const lines = [`サイクル ${cycleDirName(record)} を ${status} にします`, `  完了日  ${updated.finished}`];
      if (updated.summary !== "") lines.push(`  要約    ${updated.summary}`);
      if (incomplete.length > 0 && status === "closed") {
        lines.push(
          "",
          `  ⚠ 未完了のビルドが ${incomplete.length} 件あります: ${incomplete.map((b) => `build-${b.id}`).join(", ")}`,
        );
      }
      if (dryRun) lines.push("", "(--dry-run のため書き込んでいません)");
      return lines.join("\n");
    });

    if (dryRun) return;

    const next = records.map((r) => (r.id === record.id ? updated : r));
    writeFileSync(cyclesPath(config.hikyakuRoot), renderCyclesFile(next), "utf8");
  },
});

/** 他コマンドから使う: 進行中サイクルの一覧 */
export function activeCycles(hikyakuRoot: string): CycleRecord[] {
  return loadCycles(hikyakuRoot).filter((record) => record.status === "active");
}
