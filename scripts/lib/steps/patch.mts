/**
 * patch（サイクルを要しない小さな変更）のステップ（#93）。
 *
 * 依頼の受け取りから PR までを1セッションで進める。Step 0（対象の決定・ブランチ・セッション名）は
 * セッションごとにやり直す準備なので SKILL.md に置く。進捗は patch のブランチ上の progress.jsonl に
 * あるので、ブランチを決めるまでは現在地を導出できない。
 *
 * 作業単位は patches/{YYYYMM}/{slug}/。サイクルに属さなければ HIKYAKU_ROOT の下、進行中のサイクルに
 * 属せばそのサイクルのディレクトリの下に置く（どちらに属すかは lib/patch.mts が導く）。
 *
 *   - fit を理由付きで skipped にしたら、依頼をすべて通常のサイクルへ引き継いだということ。
 *     以後は手順に入らずに止まる（ブランチは PR にしない）
 *   - pr は合意の直後に置く。依頼と合意した挙動の置き場を PR の本文にするので、セッションが
 *     途中で落ちても合意が失われない。検証結果とドキュメントの更新は publish で本文に足す
 *   - 永続化の扱いは、サイクルに属すかで分かれる。属さなければ P2 の承認を得て、この PR で
 *     永続ドキュメントを直す（コードと一緒にマージされるので as-is が保たれる）。属せば書かずに
 *     handoff.md の「永続化すること」に残し、そのサイクルの close-cycle が昇格させる
 *   - persist を skipped にしたら、永続化するものが無い。P2 と write は手順に入らない
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { patchUnitDirectory } from "../patch.mts";
import { formatK } from "../tokens.mts";
import { publicationStep } from "./publication.mts";
import { currentEvents, latestPeak, type SkillSteps, type StepContext } from "./engine.mts";

export const PATCH_HANDOFF = "handoff.md";

function latestResult(ctx: StepContext, step: string): string | undefined {
  const events = currentEvents(PATCH_STEPS, ctx.events).filter((event) => event.skill === "patch" && event.step === step);
  return events[events.length - 1]?.result;
}

/** 依頼をすべて通常のサイクルへ引き継いだか（fit を skipped で報告した） */
function handedOver(ctx: StepContext): boolean {
  return latestResult(ctx, "fit") === "skipped";
}

/** サイクルに属さず、永続化するものがある（persist を done で報告した） */
function writesDocs(ctx: StepContext): boolean {
  return ctx.cycle === undefined && latestResult(ctx, "persist") === "done";
}

/** サイクルに属す patch は、永続化するものを handoff.md に残す */
function handoffWritten(ctx: StepContext): string | undefined {
  if (ctx.cycle === undefined) return undefined;
  return existsSync(join(ctx.unitDirectory, PATCH_HANDOFF))
    ? undefined
    : `${PATCH_HANDOFF} がありません（サイクルに属す patch は「永続化すること」を ${PATCH_HANDOFF} に書きます。無ければ skipped で報告してください）`;
}

export const PATCH_STEPS: SkillSteps = {
  skill: "patch",
  unit: (phase) => patchUnitDirectory(phase),
  stop: (ctx) =>
    handedOver(ctx)
      ? "この patch の依頼は、すべて通常のサイクルへ引き継ぎました。このブランチは PR にしません（不要なら削除してください）。"
      : undefined,
  steps: [
    // ブランチを決めた直後に記録を始める。サイクルに属す patch は、記録のディレクトリがあることで
    // 再開したときにサイクルを導けるので、最初の調査の前に作っておく
    { id: "start", kind: "run", title: "記録の開始" },
    { id: "survey", kind: "run", title: "依頼の整理と現状の確認" },
    { id: "scope", kind: "run", title: "対応方針の案と予測ピークの見積もり", peak: "required" },
    {
      id: "fit",
      kind: "run",
      title: "patch で進めるかの判定（通常のサイクルへの引き継ぎ）",
      skippable: true,
      args: (ctx) => {
        const peak = latestPeak(ctx.events.filter((event) => event.skill === "patch"));
        const splitAbove = ctx.config.peakBands.splitAbove;
        return {
          peak: formatK(peak),
          splitAbove: formatK(splitAbove),
          overSplit: peak !== undefined && peak > splitAbove,
        };
      },
    },
    { id: "P1", kind: "gate", title: "対応方針の合意" },
    { id: "pr", kind: "run", title: "Draft PR の作成（依頼と合意した挙動を本文に）", recordsPr: true },
    { id: "implement", kind: "run", title: "実装とテスト" },
    { id: "verify", kind: "run", title: "ローカル検証" },
    {
      id: "review",
      kind: "run",
      title: "コードレビュー",
      args: (ctx) => ({ codeReview: ctx.config.reviews.code, securityReview: ctx.config.reviews.security }),
    },
    {
      id: "persist",
      kind: "run",
      title: "知見と永続ドキュメントの仕分け",
      skippable: true,
      accepts: handoffWritten,
      args: (ctx) => ({ cycle: ctx.cycle?.name ?? null }),
    },
    { id: "P2", kind: "gate", title: "永続ドキュメントの更新の承認", when: writesDocs },
    { id: "write", kind: "run", title: "永続ドキュメントの書き込みと検証", when: writesDocs },
    publicationStep("patch"),
  ],
};
