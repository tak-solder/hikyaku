/**
 * builder（BUILD フェーズ）のステップ。
 *
 * 並びは SKILL.md の Step 3〜9 と同じ。Step 0〜2（設定の解決・対象ビルドの決定・
 * コンテキスト復元・ブランチ）はセッションごとにやり直す準備なので、ここには含めず
 * SKILL.md に置く。進捗はビルドのブランチ上の progress.jsonl にあるので、
 * ブランチを決めるまでは現在地を導出できない。
 */

import { latestOpenAt, unitLedgerProblem } from "../ledger.mts";
import { publicationStep } from "./publication.mts";
import { consentProblem, consentStep } from "./consent.mts";
import { declarationArgs } from "../premises.mts";
import { describeEscalationProblems } from "../escalation.mts";
import { readReturn, RETURN_FILE } from "../phase.mts";
import { buildDirName, loadTasklist, normalizeBuildId } from "../tasklist.mts";
import { formatK } from "../tokens.mts";
import { currentEvents, latestPeak, type SkillSteps, type StepContext } from "./engine.mts";

function testSpecSkipped(ctx: StepContext): boolean {
  const events = currentEvents(BUILDER_STEPS, ctx.events).filter((event) => event.skill === "builder" && event.step === "test-spec");
  return events[events.length - 1]?.result === "skipped";
}

/** builder が最後に報告した予測ピーク（plan / plan-review） */
function reportedPeak(ctx: StepContext): number | undefined {
  return latestPeak(ctx.events.filter((event) => event.skill === "builder"));
}

/** 見積もり直した予測ピークが split_above を超えたら、分割を検討する（build-manager） */
function needsSplit(ctx: StepContext): boolean {
  const peak = reportedPeak(ctx);
  return peak !== undefined && peak > ctx.config.peakBands.splitAbove;
}

/** tasklist.md（作業ツリー）の PR 列が埋まっているか */
function prRecorded(ctx: StepContext): boolean {
  if (ctx.cycle === undefined) return false;
  const id = normalizeBuildId(ctx.unit);
  return loadTasklist(ctx.cycle.directory).some((build) => build.id === id && build.pr.trim() !== "");
}

/** このビルドで最後に記録した設計と要件の衝突（ask: design-conflict）の時刻 */
function designConflictAt(ctx: StepContext): string | undefined {
  // 衝突そのもの（question）だけを数える。監督の答えや異議の記録が同じ ask を持っても、新しい出来事ではない
  return latestOpenAt(ctx.unitDirectory, (record) => record.type === "question" && record.ask === "design-conflict" && record.unit === ctx.unit);
}

export const BUILDER_STEPS: SkillSteps = {
  skill: "builder",
  unit: (phase) => (phase.startsWith("build-") ? buildDirName(normalizeBuildId(phase)) : undefined),
  // 差し戻し中のブランチでは builder は進まない（再設計は architect がこのブランチで行う）
  stop: (ctx) => {
    // delegation のきっかけを記録から読めなければ、尋ねるべきゲートを見落とさないように止まる
    const problem = unitLedgerProblem(ctx.unitDirectory);
    if (problem !== undefined) {
      return [
        `このビルドの未決事項の記録を読めません: ${problem}`,
        "設計と要件の衝突のあとに委任を続けるかを尋ねるゲートを見落とさないよう、記録を直すまで止まります（hikyaku ledger list で確かめてください）。",
      ].join("\n");
    }
    const record = ctx.cycle === undefined ? undefined : readReturn(ctx.cycle.directory);
    if (ctx.cycle === undefined || record === undefined) return undefined;
    if (record.problems.length > 0) {
      // 欠けたままでは architect が再設計の回を始められない（step restart が受け付けない）
      return [
        `このブランチは architect に差し戻されていますが、差し戻しの記録が欠けています（${RETURN_FILE}）。`,
        describeEscalationProblems(record.problems),
        `${RETURN_FILE} を直してコミット & push してから、/hikyaku:architect ${ctx.cycle.name} ${ctx.unit} を案内してください。`,
      ].join("\n");
    }
    return [
      `このブランチは architect に差し戻されています（${RETURN_FILE}）。設計を見直している最中なので、作業を始めずに止まります。`,
      `再開のコマンド: /hikyaku:architect ${ctx.cycle.name} ${ctx.unit}`,
    ].join("\n");
  },
  steps: [
    {
      // 設計と要件の衝突（ask: design-conflict）を記録したら、どのステップの最中でも委任を続けるかを尋ねる（US-14.2）
      id: "delegation",
      kind: "gate",
      title: "委任を続けるかの確認（設計と要件の衝突のあと）",
      interrupt: designConflictAt,
      consent: () => ({ timing: "now", reason: "委任の前提が崩れた出来事（設計と要件の衝突）のあと" }),
      ask: "delegation",
    },
    { id: "plan", kind: "run", title: "plan.md の作成と予測ピークの見積もり直し", produces: ["plan.md"], peak: "required" },
    {
      id: "plan-review",
      kind: "run",
      title: "doc-reviewer による plan.md のレビュー",
      when: (ctx) => ctx.config.reviews.plan,
      peak: "optional",
    },
    {
      id: "split",
      kind: "call",
      title: "分割の検討（build-manager）",
      call: "build-manager",
      when: needsSplit,
      reason: (ctx) =>
        `見積もり直した予測ピークが ${formatK(reportedPeak(ctx))} で、split_above（${formatK(ctx.config.peakBands.splitAbove)}）を超えています`,
    },
    {
      id: "G7",
      kind: "gate",
      title: "plan.md 単独の承認",
      enabled: (ctx) => ctx.config.gates.plan,
      consent: false,
      ask: "G7",
    },
    {
      id: "test-spec",
      kind: "run",
      title: "test-spec.md の生成（Agent に委任）",
      produces: ["test-spec.md"],
      skippable: true,
    },
    {
      id: "test-spec-review",
      kind: "run",
      title: "doc-reviewer による test-spec.md のレビュー",
      when: (ctx) => ctx.config.reviews.testSpec && !testSpecSkipped(ctx),
    },
    {
      id: "G8",
      kind: "gate",
      title: "plan.md と test-spec.md の承認",
      consent: false,
      ask: "G8",
      checkpoint: "approval",
    },
    // リトライの上限で止まるときは、failed --reason に行き詰まりの報告を添える（retry-policy.md）
    { id: "implement", kind: "run", title: "実装とテストコードの生成", checkpoint: "implement", escalates: true },
    { id: "verify", kind: "run", title: "ローカル検証", escalates: true },
    {
      // 全プロファイル必須（when 無し）。builder 自身のスコープとデータ安全の確認はここへ移した（US-2.5）
      id: "agreement-review",
      kind: "run",
      title: "差分の事実と合意の突き合わせ（doc-reviewer の agreement）",
      produces: ["agreement.md"],
    },
    {
      id: "review",
      kind: "run",
      title: "コードレビュー",
      checkpoint: "review",
      args: (ctx) => ({ codeReview: ctx.config.reviews.code, securityReview: ctx.config.reviews.security }),
    },
    { id: "handoff", kind: "run", title: "handoff.md の作成", produces: ["handoff.md"] },
    {
      id: "retrospective",
      kind: "call",
      title: "振り返り",
      call: "retrospective",
      when: (ctx) => ctx.config.reviews.retrospective !== "skip",
      reason: () => "PR 作成前の振り返り",
    },
    consentStep("builder"),
    {
      id: "pr",
      kind: "run",
      title: "PR の作成と完了の記録",
      evidence: prRecorded,
      recordsPr: true,
      accepts: consentProblem("builder"),
      args: declarationArgs,
    },
    publicationStep("builder"),
  ],
};
