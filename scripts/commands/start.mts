/** start — フェーズの冒頭の準備（作業サイクルの記録・ブランチ・状態・セッション名）をまとめて行う */

import { flagBoolean, flagString } from "../lib/args.mts";
import { renderSessionTitle, type Phase } from "../lib/branch.mts";
import { HikyakuError, ValidationError } from "../lib/errors.mts";
import { gitSync, listRemoteBranches } from "../lib/git.mts";
import { resolveUnsafeSplit } from "../lib/integrity.mts";
import { writeLocalState } from "../lib/local.mts";
import { emit } from "../lib/output.mts";
import { deriveState, phaseLabel, readReturn, suggestFor, type CycleState } from "../lib/phase.mts";
import { register } from "../lib/registry.mts";
import { requirePhase, verifyBranch, type BranchCheck } from "../lib/stack.mts";
import { buildDirName, isComplete, normalizeBuildId, readyBuilds, type BuildRecord } from "../lib/tasklist.mts";
import { resolveViews } from "../lib/views.mts";
import { describeSource, openCycle } from "../lib/workspace.mts";

/** ブランチの扱い。ask はユーザーに尋ねる（切る元ではない作業ブランチに居る）。skipped は止まるので作らなかった */
type BranchStatus = "ok" | "created" | "kept" | "ask" | "skipped";

/** 準備のあとにすること。continue は step next へ、ask はユーザーに尋ねる、stop は止まる、return は差し戻しからの再設計へ */
interface Outcome {
  kind: "continue" | "ask" | "stop" | "return";
  ask?: "branch" | "abandon";
  message?: string;
}

function isStartPhase(phase: Phase): boolean {
  return phase === "plan" || phase === "architect" || phase === "close" || /^build-\d+$/.test(phase);
}

register({
  name: "start",
  summary: "フェーズの冒頭の準備（作業サイクルの記録・ブランチ・状態・セッション名）をまとめて行う",
  usage:
    "hikyaku start <plan|architect|build-NN|close> [<cycle>] [--keep-branch] [--build-title <text>] [--no-fetch] [--dry-run] [--root <path>] [--json]",
  writes: true,
  details: [
    "planner / architect / builder / close-cycle の冒頭で、次を順に行います。",
    "",
    "  1. 対象サイクルを解決し、.hikyaku.local に記録する（cycle use）",
    "  2. ブランチを命名規則と突き合わせる（branch verify）。切る元のブランチ（デフォルトブランチ）に",
    "     居れば、期待する名前のブランチを作って切り替える",
    "  3. ブランチを決めたあとの状態を読む（cycle status / next）",
    "  4. セッション名を作る（session title）",
    "",
    "結果の outcome が、次にすることです。",
    "",
    "  continue  そのまま step next へ進む",
    "  ask       ユーザーに尋ねる（branch: 切る元ではない作業ブランチに居る / abandon: close でサイクルが completed でない）",
    "  stop      止まる（差し戻し中のビルド・待機中のビルド・企画が無い architect・終了したサイクル）。message を伝える",
    "  return    architect を差し戻し元のビルドのブランチで起動した。ブランチに触らずに返す（差し戻しからの再設計へ）",
    "",
    "ask: branch は終了コード 2 で、ブランチの切り替えも状態の読み込みもしません。ユーザーが",
    "「いまのブランチで作業する」を選んだら --keep-branch を付けて、別のブランチへ切り替えたら",
    "付けずに実行し直してください。実行環境が割り当てたブランチと、別の作業のブランチに紛れ込んだ",
    "状態は外から区別できないので、スクリプトは決めません。",
    "",
    "build-NN では、tasklist.md のタイトルをセッション名に入れます（--build-title で上書き）。",
    "どのビルドを選ぶかは決めません。省略されたら、先に next で着手可能なビルドを選んでください。",
    "",
    "サイクルを決められないとき（候補が複数・未初期化・サイクルが未作成）は、config と同じエラーで終わります。",
    "--dry-run では、記録とブランチの作成をせずに、何をするかだけを返します。",
  ].join("\n"),
  run: async ({ args, operands }) => {
    const phase = requirePhase(operands[0]);
    if (!isStartPhase(phase)) {
      throw new HikyakuError(`start が扱うのは plan / architect / build-NN / close です（指定: ${phase}）`);
    }
    const { config, context } = openCycle(args, operands[1]);
    const cycle = context.name;
    const dryRun = flagBoolean(args, "dry-run");

    if (!dryRun) writeLocalState(config.hikyakuRoot, cycle);

    // 差し戻し元のビルドのブランチで architect を起動したら、architect のブランチは切らない。
    // 再設計はそのブランチの上で行い、準備は architect の return.md の手順が持つ
    const returned = phase === "architect" ? readReturn(context.directory) : undefined;
    if (returned !== undefined) {
      const target = returned.buildId === undefined ? "build-NN" : buildDirName(returned.buildId);
      const outcome: Outcome = {
        kind: "return",
        message: `このブランチは ${target} から差し戻されています。差し戻しからの再設計（${target}）として準備する`,
      };
      emit({ phase, cycle, cycleSource: context.source, dryRun, returned: { buildId: returned.buildId ?? null }, outcome }, () =>
        [`サイクル: ${cycle}（${describeSource(context.source)}）`, "", `次: ${outcome.message}`].join("\n"),
      );
      return;
    }

    const check = await verifyBranch(config, phase, cycle, context);
    let branch = settleBranch(check, flagBoolean(args, "keep-branch"));

    const describe = () => ({
      phase,
      cycle,
      cycleSource: context.source,
      dryRun,
      branch: {
        status: branch,
        expected: check.expected,
        actual: check.actual ?? null,
        startPoint: check.startPoint ?? null,
        stackedOn: check.stacked?.name ?? null,
        prBase: check.prBase ?? null,
      },
    });
    const header = () => [`サイクル: ${cycle}（${describeSource(context.source)}）`, branchLine(check, branch, dryRun)];

    if (branch === "ask") {
      const outcome: Outcome = {
        kind: "ask",
        ask: "branch",
        message: "切る元ではない作業ブランチに居ます。どのブランチで作業するかをユーザーに尋ねてください",
      };
      emit({ ...describe(), outcome }, () => [...header(), "", `次: ${outcome.message}`].join("\n"));
      throw new ValidationError([`ブランチが一致しません（期待: ${check.expected} / 現在: ${check.actual ?? "detached HEAD"}）`]);
    }

    // ブランチを作るのは切る元に居るときだけなので、作る前と後で HEAD は同じ。状態は先に読み、
    // 止まるとき（待機中のビルドなど）は作らない（残ったブランチが着手中の印に見えるため）
    const remote = await listRemoteBranches(config.repoRoot);
    const views = await resolveViews(config, context, { remoteTips: remote.tips, fetch: !flagBoolean(args, "no-fetch") });
    const state = deriveState(context.directory, context.record, views.builds, views.mergedIds);
    const build = /^build-\d+$/.test(phase) ? findBuild(views.builds, phase) : undefined;
    const outcome = outcomeFor(phase, state, cycle, views.builds, build);
    if (branch === "created" && outcome.kind === "stop") branch = "skipped";
    if (branch === "created" && !dryRun && gitSync(config.repoRoot, ["switch", "-c", check.expected]) === undefined) {
      throw new HikyakuError(
        `ブランチ ${check.expected} を作れませんでした`,
        `同じ名前のブランチが既にあるなら切り替えてください: git switch ${check.expected}`,
      );
    }

    const sessionTitle = renderSessionTitle(config.session.title, phase, cycle, flagString(args, "build-title") ?? build?.title);
    const unsafeSplit = phase === "architect" ? resolveUnsafeSplit(config) : undefined;

    emit(
      {
        ...describe(),
        state: { phase: state.phase, returned: state.returned ?? null, resumeAt: state.resumeAt ?? null },
        ...(build === undefined ? {} : { build: { id: build.id, title: build.title } }),
        sessionTitle: sessionTitle ?? null,
        ...(unsafeSplit === undefined ? {} : { unsafeSplit }),
        outcome,
        next: outcome.kind === "continue" ? `step next ${phase} ${cycle}` : null,
      },
      () => {
        const lines = [...header(), `状態: ${phaseLabel(state)}${state.resumeAt === undefined ? "" : `（次に作る成果物: ${state.resumeAt}）`}`];
        if (unsafeSplit?.allowed) lines.push(`安全でない分割: ${unsafeSplit.message}`);
        lines.push(
          sessionTitle === undefined ? "セッション名: 変更しない（[session] title が空）" : `セッション名: ${sessionTitle}`,
          "",
          outcome.kind === "continue" ? `次: step next ${phase} ${cycle}` : `次: ${outcome.message}`,
        );
        return lines.join("\n");
      },
    );
  },
});

function settleBranch(check: BranchCheck, keep: boolean): BranchStatus {
  if (check.ok) return "ok";
  if (check.onBaseBranch === true) return "created";
  return keep ? "kept" : "ask";
}

function branchLine(check: BranchCheck, status: BranchStatus, dryRun: boolean): string {
  const stacked = check.stacked === undefined ? "" : `。スタック元 ${check.stacked.name}（PR の base はこのブランチ）`;
  switch (status) {
    case "ok":
      return `ブランチ: ${check.expected}${stacked}`;
    case "created":
      return dryRun
        ? `ブランチ: ${check.expected} を作って切り替える（--dry-run のため作っていません）`
        : `ブランチ: ${check.expected} を作って切り替えました。早めに push する（ブランチの存在が着手中の印になる）`;
    case "kept":
      return `ブランチ: ${check.actual ?? "(detached HEAD)"} で作業する（期待: ${check.expected}。next の着手中の検出と pr base のスタック元の導出は効かない）`;
    case "skipped":
      return `ブランチ: ${check.expected} は作らなかった（止まるため）`;
    case "ask":
      return `ブランチ: 期待 ${check.expected} / 現在 ${check.actual ?? "(detached HEAD)"}`;
  }
}

function findBuild(builds: BuildRecord[], phase: Phase): BuildRecord | undefined {
  const id = normalizeBuildId(phase);
  return builds.find((build) => build.id === id);
}

function outcomeFor(phase: Phase, state: CycleState, cycle: string, builds: BuildRecord[], build: BuildRecord | undefined): Outcome {
  if (state.phase === "closed" || state.phase === "abandoned") {
    return { kind: "stop", message: `このサイクルは ${state.phase} です` };
  }
  if (phase === "close") {
    return state.phase === "completed"
      ? { kind: "continue" }
      : { kind: "ask", ask: "abandon", message: `サイクルは ${phaseLabel(state)} で、completed ではありません。中止（abandoned）して締めるかをユーザーに尋ねてください` };
  }
  if (phase === "architect" && state.phase === "planning") {
    return { kind: "stop", message: `企画成果物（${state.resumeAt}）がありません。/hikyaku:planner ${cycle} を先に実行するよう案内して終了する` };
  }
  if (!/^build-\d+$/.test(phase)) return { kind: "continue" };

  if (state.phase === "planning" || state.phase === "architecting") {
    return { kind: "stop", message: `このサイクルはまだビルド段階ではありません（${state.phase}）。案内して終了する: ${suggestFor(state, cycle)}` };
  }
  // 差し戻し中のブランチでは builder は進まない（再設計は architect がこのブランチで行う）
  if (state.returned !== undefined) {
    return { kind: "stop", message: `architect に差し戻されて再設計中です。再開のコマンドを案内して終了する: ${suggestFor(state, cycle)}` };
  }
  if (build === undefined) {
    return { kind: "stop", message: `${phase} は tasklist.md にありません。next で着手可能なビルドを確かめる` };
  }
  if (isComplete(build)) {
    return { kind: "stop", message: `${buildDirName(build.id)} は完了しています（PR: ${build.pr}）` };
  }
  if (!readyBuilds(builds).some((ready) => ready.id === build.id)) {
    const waiting = build.dependsOn.filter((dep) => !builds.some((other) => other.id === dep && isComplete(other)));
    return {
      kind: "stop",
      message: `${buildDirName(build.id)} は待機中です（未完了の依存: ${waiting.map(buildDirName).join(", ")}）。このブランチの履歴に依存の成果が無いので着手しない`,
    };
  }
  return { kind: "continue" };
}

