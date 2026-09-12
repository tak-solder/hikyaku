/** cycle new / list / status / close — サイクルのライフサイクル操作 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { flagBoolean, flagList, flagString, type ParsedArgs } from "../lib/args.mts";
import { branchName } from "../lib/branch.mts";
import {
  loadConfig,
  PROFILE_NAMES,
  type AskKey,
  type ExternalTarget,
  type ProfileName,
  type ResolvedConfig,
} from "../lib/config.mts";
import {
  cycleDir,
  cycleDirName,
  cyclesPath,
  findCycleByKey,
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
import { formatRef } from "../lib/refs.mts";
import { buildDirName, isComplete, loadTasklist } from "../lib/tasklist.mts";
import { resolveViews, sectionNote } from "../lib/views.mts";
import { openCycle, type CycleContext } from "../lib/workspace.mts";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function findCycle(records: CycleRecord[], key: string): CycleRecord {
  const found = findCycleByKey(records, key);
  if (!found) {
    throw new HikyakuError(
      `サイクルが見つかりません: ${key}`,
      `hikyaku cycle list で一覧を確認してください。`,
    );
  }
  return found;
}

/** create-cycle 時に決めた値。サイクルの .hikyaku.config に書き出す */
interface Decided {
  baseBranch: string | undefined;
  branchPrefix: string | undefined;
  branchSeparator: string | undefined;
  prTitle: string | undefined;
  sessionTitle: string | undefined;
  externalTarget: ExternalTarget | undefined;
  externalGithubRepo: string | undefined;
  externalAsanaProjectGid: string | undefined;
}

/** どのキーも渡されていなければ何も書かない */
function hasAnyDecision(decided: Decided): boolean {
  return Object.values(decided).some((value) => value !== undefined);
}

function readDecided(args: ParsedArgs): Decided {
  const separator = flagString(args, "branch-separator");
  if (separator === "") {
    throw new HikyakuError(
      "--branch-separator に空文字は指定できません",
      "空文字にするとブランチ名からサイクルとフェーズを解析できなくなります。",
    );
  }

  const target = flagString(args, "external");
  if (target !== undefined && target !== "none" && target !== "github" && target !== "asana") {
    throw new HikyakuError(
      `--external の値が不正です: ${target}`,
      "使用できる値: none | github | asana",
    );
  }

  return {
    baseBranch: flagString(args, "base-branch"),
    branchPrefix: flagString(args, "branch-prefix"),
    branchSeparator: separator,
    prTitle: flagString(args, "pr-title"),
    sessionTitle: flagString(args, "session-title"),
    externalTarget: target,
    externalGithubRepo: flagString(args, "external-repo"),
    externalAsanaProjectGid: flagString(args, "external-project"),
  };
}

/** TOML の基本文字列。テンプレートに引用符が入りうるのでエスケープする */
function tomlString(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
  return `"${escaped}"`;
}

function renderCycleConfig(cycleName: string, decided: Decided): string {
  const lines = [
    `# ${cycleName} の設定（作成時に決めた分）`,
    "#",
    "# リポジトリルートの .hikyaku.config にキー単位で重なります。",
    "# ここに書かなかったキーはルートの値のままです。",
    "",
  ];
  if (decided.baseBranch !== undefined) {
    lines.push(`base_branch = ${tomlString(decided.baseBranch)}`, "");
  }
  if (decided.branchPrefix !== undefined || decided.branchSeparator !== undefined) {
    lines.push("[branch]");
    if (decided.branchPrefix !== undefined) {
      lines.push(`prefix = ${tomlString(decided.branchPrefix)}`);
    }
    if (decided.branchSeparator !== undefined) {
      lines.push(`separator = ${tomlString(decided.branchSeparator)}`);
    }
    lines.push("");
  }
  if (decided.prTitle !== undefined) {
    lines.push("[pr]", `title = ${tomlString(decided.prTitle)}`, "");
  }
  if (decided.sessionTitle !== undefined) {
    lines.push("[session]", `title = ${tomlString(decided.sessionTitle)}`, "");
  }
  if (
    decided.externalTarget !== undefined ||
    decided.externalGithubRepo !== undefined ||
    decided.externalAsanaProjectGid !== undefined
  ) {
    lines.push("[external]");
    if (decided.externalTarget !== undefined) {
      lines.push(`target = ${tomlString(decided.externalTarget)}`);
    }
    if (decided.externalGithubRepo !== undefined) {
      lines.push(`github_repo = ${tomlString(decided.externalGithubRepo)}`);
    }
    if (decided.externalAsanaProjectGid !== undefined) {
      lines.push(`asana_project_gid = ${tomlString(decided.externalAsanaProjectGid)}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** まだ答えていないキーを、スキルが尋ねられる形で並べる */
function describeAsk(keys: AskKey[], config: ResolvedConfig): string[] {
  if (keys.length === 0) return [];
  const lines = ["", "作成時に決めるキー（ルート設定の ask）:"];
  for (const key of keys) {
    lines.push(`  ${key.padEnd(17)} ${ASK_FLAGS[key]}`, `${" ".repeat(19)} 既定: ${ASK_DEFAULT[key](config)}`);
  }
  lines.push(
    "",
    "ユーザーに尋ねてから、上のオプションを付けて実行し直してください。",
    "既定のままで良ければ渡さなくて構いません（既定値で作成されます）。",
  );
  return lines;
}

/** 尋ねるときに提示する既定。ルート設定の値、無ければ組み込みの既定 */
const ASK_DEFAULT: Record<AskKey, (config: ResolvedConfig) => string> = {
  base_branch: (c) => c.baseBranch ?? "(自動検出)",
  "branch.prefix": (c) => c.branch.prefix,
  "branch.separator": (c) => c.branch.separator,
  "pr.title": (c) => c.pr.title,
  "session.title": (c) => (c.session.title === "" ? "(セッション名を変更しない)" : c.session.title),
  "external.target": (c) => c.external.target,
};

/** ask のキーごとに「もう決まったか」を見る */
const ANSWERED: Record<AskKey, (decided: Decided) => boolean> = {
  base_branch: (d) => d.baseBranch !== undefined,
  "branch.prefix": (d) => d.branchPrefix !== undefined,
  "branch.separator": (d) => d.branchSeparator !== undefined,
  "pr.title": (d) => d.prTitle !== undefined,
  "session.title": (d) => d.sessionTitle !== undefined,
  "external.target": (d) => d.externalTarget !== undefined,
};

const ASK_FLAGS: Record<AskKey, string> = {
  base_branch: "--base-branch <name>",
  "branch.prefix": "--branch-prefix <text>",
  "branch.separator": "--branch-separator <text>",
  "pr.title": "--pr-title <template>",
  "session.title": "--session-title <template>",
  "external.target": "--external <none|github|asana> [--external-repo <owner/repo>]",
};

register({
  name: "cycle new",
  summary: "サイクルを採番してディレクトリを作り、cycles.md に追記する",
  usage:
    "hikyaku cycle new <slug> --profile <name> [--ticket <ref>] [--depends 001,002]\n" +
    "                           [--base-branch <name>] [--branch-prefix <text>] [--branch-separator <text>]\n" +
    "                           [--pr-title <template>] [--session-title <template>]\n" +
    "                           [--external <none|github|asana>] [--external-repo <owner/repo>]\n" +
    "                           [--external-project <gid>] [--dry-run]",
  writes: true,
  details: [
    "--profile は必須です。サイクルの進め方は作成時に明示的に選ぶ必要があります",
    `（${PROFILE_NAMES.join(" | ")}）。config の profile は推奨値の提示にすぎず、`,
    "無条件には採用しません。",
    "",
    "ルート設定の ask に並べたキーは「作成時に決める」という宣言です。--dry-run の",
    "出力に対象キー・既定値・対応するオプションが並ぶので、ユーザーに尋ねてから",
    "渡し直してください。渡された値は {サイクル}/.hikyaku.config に書き出します。",
    "",
    "渡さなくてもエラーにはしません。ルート設定の値（無ければ組み込みの既定）が",
    "そのまま使われます。スキルを通さず直接叩いた場合に壊れないためです。",
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
    // サイクルディレクトリはこのコマンドが作る。まだサイクル設定は存在しえないので
    // 表示するブランチ名はベースの規則で組み立てる
    const config = loadConfig({ root: flagString(args, "root") });
    const rawSlug = operands[0];
    if (rawSlug === undefined) {
      throw new HikyakuError("slug を指定してください", "例: hikyaku cycle new billing --profile express");
    }

    const profile = flagString(args, "profile");
    if (profile === undefined) {
      throw new HikyakuError(
        "--profile を指定してください",
        [
          "サイクルの進め方は作成時に明示的に選ぶ必要があります。",
          "",
          "  express   承認は要件と plan だけ・レビューは有効。人間の時間を節約する",
          "  economy   承認は残しレビューを落とす。AI 実行コストを節約する",
          "  standard  全レビュー有効・各フェーズで承認",
          "  thorough  codebase-survey の確認を追加、validate を各ステップで実行",
        ].join("\n"),
      );
    }
    if (!(PROFILE_NAMES as string[]).includes(profile)) {
      throw new HikyakuError(
        `profile の値が不正です: ${profile}`,
        `使用できる値: ${PROFILE_NAMES.join(" | ")}`,
      );
    }

    const decided = readDecided(args);
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
      external: "",
      dependsOn,
      started: today(),
      finished: "",
      summary: flagString(args, "summary") ?? "",
    };

    const name = cycleDirName(record);
    const directory = cycleDir(config.hikyakuRoot, record);
    const dryRun = flagBoolean(args, "dry-run");
    const active = records.filter((r) => r.status === "active");

    // 決めた値はまだファイルに無いので、表示するブランチ名にはここで重ねる
    const naming = {
      prefix: decided.branchPrefix ?? config.branch.prefix,
      separator: decided.branchSeparator ?? config.branch.separator,
    };
    const remaining = config.askAtCreate.filter((key) => !ANSWERED[key](decided));
    const cycleConfig = hasAnyDecision(decided) ? renderCycleConfig(name, decided) : undefined;
    const cycleConfigPath = join(directory, ".hikyaku.config");

    emit(
      {
        cycle: record,
        directory,
        dryRun,
        activeCycles: active.map((r) => cycleDirName(r)),
        askAtCreate: remaining,
        cycleConfig:
          cycleConfig === undefined
            ? null
            : { path: relative(config.repoRoot, cycleConfigPath), content: cycleConfig },
      },
      () => {
        const lines = [
          `サイクル ${name} を作成します`,
          "",
          `  profile   ${record.profile}`,
          `  hikyaku   ${record.hikyaku}`,
          `  チケット  ${record.ticket || "—"}`,
          `  依存      ${dependsOn.length > 0 ? dependsOn.join(", ") : "—"}`,
          `  ディレクトリ  ${relative(config.repoRoot, directory)}`,
          `  ブランチ  ${branchName(naming, "create", name)}`,
        ];
        if (cycleConfig !== undefined) {
          lines.push(
            "",
            `${relative(config.repoRoot, cycleConfigPath)} に書き出します:`,
            ...cycleConfig.split("\n").map((line) => `  ${line}`),
          );
        }
        lines.push(...describeAsk(remaining, config));
        if (active.length > 0) {
          lines.push(
            "",
            "他に進行中のサイクルがあります。設計の重複に注意してください:",
            ...active.map((r) => `  - ${cycleDirName(r)}（${r.summary || "要約なし"}）`),
          );
        }
        if (dryRun) lines.push("", "(--dry-run のため書き込んでいません)");
        return lines.join("\n");
      },
    );

    if (dryRun) return;

    mkdirSync(join(directory, "planning"), { recursive: true });
    mkdirSync(join(directory, "design"), { recursive: true });
    if (cycleConfig !== undefined) writeFileSync(cycleConfigPath, cycleConfig, "utf8");
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
  name: "cycle link",
  summary: "外部システムへ投影した親 issue / 親タスクの参照を記録する",
  usage: "hikyaku cycle link [<cycle>] --external <url> [--dry-run]",
  writes: true,
  details: [
    "cycles.md の外部列を埋めます。gh CLI が使える場合は external sync が自動で",
    "記録するので、このコマンドを直接使うのは GitHub MCP や Asana MCP で",
    "スキル側が投影した場合です。",
    "",
    "参照は `[#12](URL)` に整えて記録します。表記が揃っていないと表が横に伸びて",
    "読めなくなるためで、判定に使う値ではありません（完了判定は常に PR 列）。",
    "",
    "外部システムはあくまで可視化のためのビューです。ここに記録された参照を",
    "読み取りや完了判定に使うことはありません。",
  ].join("\n"),
  run: ({ args, operands }) => {
    const { config, context: ctx } = openCycle(args, operands[0]);
    const external = flagString(args, "external");
    if (external === undefined) {
      throw new HikyakuError("--external に親 issue / 親タスクの URL を指定してください");
    }

    const records = loadCycles(config.hikyakuRoot);
    const formatted = formatRef(external, "親issue");
    const next = records.map((record) =>
      record.id === ctx.record.id ? { ...record, external: formatted } : record,
    );
    const dryRun = flagBoolean(args, "dry-run");

    emit({ cycle: ctx.name, external: formatted, previous: ctx.record.external, dryRun }, () => {
      const lines = [`${ctx.name} の外部列を ${formatted} にします`];
      if (ctx.record.external !== "") lines.push(`（前の値: ${ctx.record.external}）`);
      if (dryRun) lines.push("", "(--dry-run のため書き込んでいません)");
      return lines.join("\n");
    });

    if (!dryRun) writeFileSync(cyclesPath(config.hikyakuRoot), renderCyclesFile(next), "utf8");
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
    "  completed     **全ビルドがデフォルトブランチにマージ済み**。だが昇格がまだ",
    "  closed        cycles.md に記録された status",
    "",
    "ビルド列は「マージ済み / 全体」です。このツリーでは完了しているがまだ",
    "マージされていないビルドがあれば (+n) が付きます（スタック中など）。",
    "デフォルトブランチを読めない場合は ?/全体 になります。",
    "",
    "**ネットワークへは行きません。** リモート追跡参照をそのまま読むため、",
    "最後に fetch した時点より後のマージは反映されません。1つのサイクルを",
    "詳しく見るときは cycle status を使ってください。",
  ].join("\n"),
  run: async ({ args }) => {
    const root = flagString(args, "root");
    const config = loadConfig({ root });
    const records = loadCycles(config.hikyakuRoot);
    const onlyActive = flagBoolean(args, "active");

    const rows = await Promise.all(
      records
        .filter((record) => !onlyActive || record.status === "active")
        .map(async (record) => {
          const directory = cycleDir(config.hikyakuRoot, record);
          // base_branch はサイクル側で上書きできるので、そのサイクルの設定で読む
          const cycleConfig = loadConfig({ root, cycleDir: directory });
          const ctx: CycleContext = {
            record,
            name: cycleDirName(record),
            directory,
            builds: loadTasklist(directory),
            source: "explicit",
          };
          const views = await resolveViews(cycleConfig, ctx, { fetch: false });
          const state = deriveState(directory, record, views.builds, views.mergedIds);
          const total = views.builds.length;
          const merged =
            views.mergedIds === undefined
              ? "?"
              : String(views.builds.filter((b) => views.mergedIds?.has(b.id)).length);
          const pending = state.mergePending.length > 0 ? ` (+${state.mergePending.length})` : "";
          return {
            record,
            phase: state.phase,
            progress: total > 0 ? `${merged}/${total}${pending}` : "—",
          };
        }),
    );

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
  usage: "hikyaku cycle status <id|slug> [--no-fetch] [--root <path>] [--json]",
  details: [
    "ブランチ上の成果物の有無から「どこまで進んだか」を割り出します。",
    "成果物が1つできるごとにコミット & push されていることが前提です",
    "（コミットされていなければ他セッションからは見えません）。",
    "",
    "必須成果物と条件付き成果物を区別します。条件付きが無くても未完了とは限りません。",
    "",
    "着手中のブランチは origin から取得します。到達できない場合は表示が落ちるだけで、",
    "着手可能・待機の判定には影響しません。",
    "",
    "中断点は **HEAD の tasklist.md** で未完了のビルドから割り出します。",
    "デフォルトブランチ基準にすると、マージ待ちで完了済みの先行ビルドが未完了に",
    "混ざり、スタック中に中断点が古いビルドへ戻ります。",
    "completed かどうかだけはリポジトリ全体の問いなので、デフォルトブランチを見ます。",
  ].join("\n"),
  run: async ({ args, operands }) => {
    const root = flagString(args, "root");
    const base = loadConfig({ root });
    const key = operands[0];
    if (key === undefined) throw new HikyakuError("サイクルを指定してください");

    const records = loadCycles(base.hikyakuRoot);
    const record = findCycle(records, key);
    const name = cycleDirName(record);
    const directory = cycleDir(base.hikyakuRoot, record);
    // [branch] はサイクル側で上書きできるので、着手中ブランチの絞り込みには
    // そのサイクルの設定を使う。ベースの規則で絞ると1件も当たらない
    const config = loadConfig({ root, cycleDir: directory });

    const remote = await listRemoteBranches(config.repoRoot);
    const ctx: CycleContext = {
      record,
      name,
      directory,
      builds: loadTasklist(directory),
      source: "explicit",
    };
    const views = await resolveViews(config, ctx, {
      remoteTips: remote.tips,
      fetch: !flagBoolean(args, "no-fetch"),
    });
    const builds = views.builds;
    const state = deriveState(directory, record, builds, views.mergedIds);

    const prefix = branchName(config.branch, "plan", name).replace(/plan$/, "");
    const inProgress = remote.names.filter((branchRef) => branchRef.startsWith(prefix));

    emit(
      {
        cycle: record,
        phase: state.phase,
        resumeAt: state.resumeAt,
        artifacts: state.artifacts,
        branches: inProgress,
        mergePending: state.mergePending,
        readiness: { source: views.head.source, ref: views.head.ref ?? null, sha: views.head.sha ?? null },
        merged: {
          source: views.base.source,
          ref: views.base.ref ?? null,
          sha: views.base.sha ?? null,
          ids: views.mergedIds === undefined ? null : [...views.mergedIds],
        },
        remoteUnavailable: remote.unavailable,
        suggestion: suggestCommand(state.phase, name),
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
          const merged =
            views.mergedIds === undefined
              ? "?"
              : String(builds.filter((b) => views.mergedIds?.has(b.id)).length);
          lines.push("", `  ビルド: ${merged}/${builds.length} マージ済み`);
          if (state.mergePending.length > 0) {
            lines.push(
              `    このツリーでは完了・マージ待ち: ${state.mergePending.map(buildDirName).join(", ")}`,
            );
          }
        }

        if (remote.unavailable !== undefined) {
          lines.push("", `  ! origin に到達できないため、着手中ブランチは不明です`);
        } else if (inProgress.length > 0) {
          lines.push("", "  着手中のブランチ:", ...inProgress.map((b) => `    ${b}`));
        }

        lines.push(
          "",
          `  ${sectionNote("判定", views.head, " の PR 列（未コミットの変更は数えません）")}`,
          `  ${sectionNote("マージ状況", views.base, " の PR 列")}`,
        );
        if (views.fetched) lines.push(`    origin/${views.baseBranch} を更新しました`);

        lines.push(
          "",
          `  再開: ${suggestCommand(state.phase, name)}`,
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
