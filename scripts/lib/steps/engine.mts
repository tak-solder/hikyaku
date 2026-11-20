/**
 * ステップエンジン — フェーズの中の手順を、設定と状態から決める（#50）。
 *
 * 手順の並び・実行条件・完了を確かめる成果物は、スキルごとの定義（steps/<skill>.mts）が
 * 唯一の正。SKILL.md は「step next を呼び、返った1手を行い、step report で返す」転送ループと、
 * 全体に関わる原則だけを持つ。各ステップで何をするかは skills/<skill>/steps/<id>.md にあり、
 * モデルは実行するステップの指示だけを読む。
 *
 * 現在地は保存しない。progress.jsonl のイベントと成果物から、毎回頭から導出する。
 *
 *   - ステップを順に見て、最初に完了していないものが現在地
 *   - 完了の印は、そのステップの完了イベントが「前のステップの完了より後」にあること。
 *     前のステップをやり直したら、後ろのステップもやり直しになる（差し戻しで plan.md が
 *     作り直されたあと、古い test-spec のレビューを完了と読まないため）
 *   - 成果物が要るステップは、成果物が無ければ完了イベントがあっても未完了
 *   - 完了したステップを報告し直すと（成果物を作り直したとき）、そこから後ろはやり直しになる
 *   - step restart の区切りより前の記録は使わない（同じ作業単位で手順を回し直すとき）
 *   - ゲートの承認は、差し戻すか前のステップを報告し直すまで有効。承認したあとの成果物の
 *     変更は Git の履歴で追い、取り直すかは変更のレビューで決める（成果物のハッシュで自動的に
 *     無効にすると、plan.md のチェックボックスの更新のような通常の作業でも巻き戻るため）
 *
 * 判定はすべてここで行い、LLM には結果（directive）だけを渡す。条件の分岐を SKILL.md の
 * 文章で書くと、省略や取り違えが起きるため。
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Phase } from "../branch.mts";
import type { ResolvedConfig } from "../config.mts";
import type { CheckpointKey } from "./checkpoints.mts";
import { RESTART, type ProgressEvent, type StepResult } from "../progress.mts";
import type { CycleContext } from "../workspace.mts";

export type StepKind = "run" | "gate" | "call";

/**
 * 同意の時機。now はその場で取る同意で、どの設定でも手順から外さない。deferred は同意の部分を
 * マージの前の同意ゲートへ遅らせる回で、その回のゲート自体は確認として enabled で決まる
 */
export type ConsentTiming = "now" | "deferred";

/** その回の同意の判定。false は確認（プロファイルで省ける） */
export type ConsentJudgement = { timing: ConsentTiming; reason: string } | false;

/** 定義の条件・成果物を評価するときに渡すもの */
export interface StepContext {
  config: ResolvedConfig;
  /** 対象サイクル。サイクルの無いフェーズ（init / token-guide）では undefined */
  cycle: CycleContext | undefined;
  /** 作業単位のフェーズ（build-03 など） */
  unit: string;
  unitDirectory: string;
  events: ProgressEvent[];
  /**
   * 手順の位置だけを読む経路（Stop フック・step where・conductor parse）。重い args（git を読む宣言の変更など）は
   * これを見て組み立てを省く
   */
  positionOnly?: boolean;
}

/** 事後同意で積む、上限を超えるリスクの受け入れ（step report が risk の事項にする） */
export interface DeferredRisk {
  /** 同意を遅らせるゲート（G3・G4）。事項の ask に入る */
  gate: string;
  /** 事項の step（戻り先。G3 は options、G4 は design-delta） */
  step: string;
  summary: string;
  /** 前提の参照（app.<axis>・area:<name>）。ゲートの consent は、これがいまの判定の理由を覆うかを見る */
  premises: string[];
  harm?: "高" | "中";
}

export interface StepDefinition {
  id: string;
  kind: StepKind;
  /** step status に出す短い説明 */
  title: string;
  /**
   * 構造の条件（options をスキップした、追加設計の回、など）。false なら手順に含めない。
   * プロファイルや個別キーによるゲートのオン・オフは enabled に書く（同意の回に外さないため）
   */
  when?: (ctx: StepContext) => boolean;
  /**
   * gate の承認の種類（原則11）。gate は必ず持つ（step lint が検査する）。false は常に確認。
   * 関数なら回ごとに判定する（差し戻しからの再設計の回の G3・G4 など）
   */
  consent?: false | ((ctx: StepContext) => ConsentJudgement);
  /** gate の確認のオン・オフ（プロファイル・個別キー）。省略は有効。同意（now）の回には効かない */
  enabled?: (ctx: StepContext) => boolean;
  /**
   * 割り込みのゲート。きっかけの出来事の時刻（ISO 8601）を返す回だけ手順に入り、その時刻より後に承認の
   * 記録が無ければ、並びの位置に関わらず現在地になる。並びの完了の判定（前のステップの完了より後か）には
   * 加わらないので、承認しても後ろのステップはやり直しにならない。どのステップの最中にも起きうる出来事
   * （builder の design-conflict）のあとに尋ねるゲートに使う。gate だけが持てる
   */
  interrupt?: (ctx: StepContext) => string | undefined;
  /** 完了に要る成果物（作業単位のディレクトリからの相対パス） */
  produces?: string[];
  /** 成果物で判定できない完了の条件（architect の分割の記録など）。成果物と同じ扱い */
  evidence?: (ctx: StepContext) => boolean;
  /**
   * 完了に要る条件のうち、記録の欠けの判定には使わないもの。前から存在しうるファイルの
   * 検査（document-guide.md が検証を通るか、など）に使う。produces / evidence は、後ろの
   * ステップにあれば記録の欠けとみなすので、前からあるファイルには使えない。
   * 満たさないなら、何が足りないかを返す
   */
  requires?: (ctx: StepContext) => string | undefined;
  /**
   * done（gate は approved）を報告するときだけ確かめる条件。完了したあとは見直さない（後の作業で崩れてよい
   * 条件に使う。追加設計で「未完了のビルドが足された」は、そのビルドが PR まで進めば崩れる。承認のあとに
   * 見直す条件は reopens に書く）。満たさないなら理由を返す
   */
  accepts?: (ctx: StepContext) => string | undefined;
  /**
   * 承認の記録があっても、その承認では足りないときに理由を返す（gate だけ）。理由を返せば、承認は
   * 無かったものとして現在地に戻る。G10 は、確認として受けた承認のあとに同意が要る変更が出たときに使う
   */
  reopens?: (ctx: StepContext, approval: ProgressEvent) => string | undefined;
  /**
   * ゲートで記録した事項を同意ゲートで退けたときの戻り先（そのゲートが承認した成果物を作る run ステップ）。
   * ゲートは done で報告し直せないため。省略したゲートは、それより前で最も近い run へ戻す（steps/consent.mts）。
   * gate だけが持てる
   */
  reworks?: string;
  /** ゲートの問いの ID（conductor の ASKS） */
  ask?: string;
  /** call で呼ぶ内部スキル */
  call?: string;
  /** call を呼ぶ理由 */
  reason?: (ctx: StepContext) => string;
  /** 理由を添えればスキップできるか。省略を記録に残すため、既定ではできない */
  skippable?: boolean;
  /**
   * 行き詰まりでユーザーに上げるステップ（リトライの上限で止まる implement / verify）。failed の --reason が
   * 行き詰まりの報告の形式（escalation.mts）を満たさなければ受け付けない。gate は持てない
   */
  escalates?: boolean;
  /** このステップに入るときに、完了までの見込みを [context] limit と比べる区切り（#68・forecast.mts） */
  checkpoint?: CheckpointKey;
  /**
   * このステップに入る前に、セッションを切り替えられるか（handover を報告できる）。切り替えたら完了にせず、
   * 新しいセッションが同じステップから続ける。run だけが持てる
   */
  handover?: boolean;
  /** 報告で予測ピークを添えるか。required なら done に --peak が必須、optional なら任意 */
  peak?: "required" | "optional";
  /**
   * done に --pr（作った PR の URL か番号）が必須か。記録に PR が無い done は完了とみなさない。
   * optional は --pr を受け付けるが必須にしない（作ったときだけ記録する PR）
   */
  recordsPr?: boolean | "optional";
  /** recordsPr が optional のとき、報告の案内に出す --pr の説明（どの PR を添えるか） */
  prHint?: string;
  /**
   * done の報告で害の重さとパスの申告（--harm / --paths）を受け付けるか（architect の options）。
   * 欠けていても報告は受け付け、判定する側（G3・G4 の consent）が同意に倒す。gate は持てない
   */
  declaresRisk?: boolean;
  /**
   * done の報告で、上限を超えるリスクの受け入れを事後同意の事項として積むか（architect の options が G3、
   * design-delta が G4 の分）。報告を足した後の記録で評価し、値を返せば step report が --loses を必須にして
   * risk の事項（who=user、when=merge@<単位>）を書く。gate は持てない
   */
  defers?: (ctx: StepContext) => DeferredRisk | undefined;
  /**
   * done の報告に、中間レビューの指摘の件数と反映した件数（--findings / --adopted）を求めるか。
   * プロファイルで外せるレビューを残すかを、採用率の実績で決めるための記録（review findings が集計する）。
   * gate は持てない
   */
  countsFindings?: boolean;
  /** 設定から解決して指示に添える値 */
  args?: (ctx: StepContext) => Record<string, unknown>;
  /**
   * directive の notices に足す行（G3・G4 が基準の宣言を読めなかったこと）。手順の位置だけを読む経路では呼ばない
   */
  notices?: (ctx: StepContext) => string[];
}

export interface SkillSteps {
  skill: string;
  /**
   * そのフェーズを担うときの、作業単位のディレクトリ（progress.jsonl を置く場所）。
   * サイクルのあるフェーズはサイクルのディレクトリから、サイクルの無いフェーズ（init / token-guide）は
   * HIKYAKU_ROOT からの相対パス。担わないフェーズなら undefined。内部スキルは持たない
   */
  unit?: (phase: Phase) => string | undefined;
  /**
   * 呼び出し元のフェーズの作業単位で動く内部スキル（build-manager / retrospective）。
   * step の --skill で指定し、記録は呼び出し元と同じ progress.jsonl に書く
   */
  internal?: boolean;
  /**
   * 手順に入る前に止まる理由（builder の差し戻し中など）。止まらないなら undefined。
   * スキルごとに意味が違うので、エンジンでは一律に判定しない
   */
  stop?: (ctx: StepContext) => string | undefined;
  /** step restart --round で指定できる回の種類。定義は currentRound で読む */
  rounds?: string[];
  steps: StepDefinition[];
}

export type StepStatus = "complete" | "skipped" | "pending" | "off";

export interface EvaluatedStep {
  definition: StepDefinition;
  status: StepStatus;
  /** 完了とみなしたイベント */
  event: ProgressEvent | undefined;
  /** 未完了の理由の補足（差し戻し・承認後の変更・失敗など） */
  note: string | undefined;
  /** 差し戻されたゲートの、ユーザーの答え */
  revise: string | undefined;
}

export interface Evaluation {
  steps: EvaluatedStep[];
  current: EvaluatedStep | undefined;
  /**
   * 並びの現在地（割り込みのゲートを除く）。期限の判定のように、手順の中の位置を見るものはこれを使う。
   * 割り込みのゲートが現在地のときも、並びの位置は変わらないため
   */
  sequential: EvaluatedStep | undefined;
  /**
   * 現在地より後ろなのに成果物があるステップ。ログが欠けている（手で進めた）ので、
   * 推測で補わずに止まる
   */
  orphans: EvaluatedStep[];
}

const COMPLETING: Record<StepKind, ProgressEvent["result"][]> = {
  run: ["done", "skipped"],
  call: ["done", "skipped"],
  gate: ["approved"],
};

/** ステップに報告できる結果 */
export function allowedResults(definition: StepDefinition): StepResult[] {
  if (definition.kind === "gate") return ["approved", "rejected"];
  const results: StepResult[] = definition.skippable === true ? ["done", "skipped", "failed"] : ["done", "failed"];
  return definition.handover === true ? [...results, "handover"] : results;
}

/** その回の同意の判定。consent が無い・false なら確認（false） */
export function consentOf(definition: StepDefinition, ctx: StepContext): ConsentJudgement {
  return typeof definition.consent === "function" ? definition.consent(ctx) : false;
}

/**
 * 手順に含めるか。when（構造）を満たし、その場の同意の回か、確認として有効なとき。
 * 同意（now）の回はどのプロファイル・個別キーでも外さない（原則11）
 */
export function isOn(definition: StepDefinition, ctx: StepContext, trigger = definition.interrupt?.(ctx)): boolean {
  if (definition.when !== undefined && !definition.when(ctx)) return false;
  if (definition.interrupt !== undefined && trigger === undefined) return false;
  const consent = consentOf(definition, ctx);
  if (consent !== false && consent.timing === "now") return true;
  return definition.enabled === undefined || definition.enabled(ctx);
}

/**
 * 承認の種類の検査（step lint）。gate は consent を必ず持ち（確認なら false を明示する）、
 * gate でないステップは consent / enabled を持たない。書き忘れた gate が黙って確認になり、
 * 同意の回にプロファイルで外れるのを防ぐ
 */
export function lintApproval(skill: Pick<SkillSteps, "skill" | "steps">): string[] {
  const problems: string[] = [];
  for (const definition of skill.steps) {
    if (definition.kind === "gate") {
      if (definition.consent === undefined) {
        problems.push(`${skill.skill}: ゲート ${definition.id} が承認の種類（consent）を持っていません。確認なら consent: false を明示してください`);
      }
      // ゲートは failed を報告できないので、行き詰まりの報告の検査が働かない
      if (definition.escalates !== undefined) {
        problems.push(`${skill.skill}: ゲート ${definition.id} は escalates を持てません（failed を報告しないため）`);
      }
      // ゲートは done を報告しないので、申告を受け付けても記録されない
      if (definition.countsFindings !== undefined) {
        problems.push(`${skill.skill}: ゲート ${definition.id} は countsFindings を持てません（done を報告しないため）`);
      }
      if (definition.declaresRisk !== undefined) {
        problems.push(`${skill.skill}: ゲート ${definition.id} は declaresRisk を持てません（done を報告しないため）`);
      }
      if (definition.defers !== undefined) {
        problems.push(`${skill.skill}: ゲート ${definition.id} は defers を持てません（done を報告しないため）`);
      }
      // 戻り先は、そのゲートより前の run（名前を変えたときに黙って古くならないように）
      if (definition.reworks !== undefined) {
        const index = skill.steps.indexOf(definition);
        const target = skill.steps.findIndex((step) => step.id === definition.reworks);
        if (target === -1 || target >= index || skill.steps[target]?.kind !== "run") {
          problems.push(`${skill.skill}: ゲート ${definition.id} の reworks（${definition.reworks}）が、それより前の run ステップではありません`);
        }
      }
      continue;
    }
    for (const key of ["consent", "enabled", "interrupt", "reopens", "reworks"] as const) {
      if (definition[key] !== undefined) {
        problems.push(`${skill.skill}: ${definition.id} は gate でないのに ${key} を持っています（条件は when に書きます）`);
      }
    }
  }
  return problems;
}

export function hasEvidence(definition: StepDefinition, ctx: StepContext): boolean {
  if (definition.produces !== undefined) {
    if (!definition.produces.every((path) => existsSync(join(ctx.unitDirectory, path)))) return false;
  }
  if (definition.evidence !== undefined && !definition.evidence(ctx)) return false;
  return missingRequirement(definition, ctx) === undefined;
}

/** requires を満たさないときの理由 */
export function missingRequirement(definition: StepDefinition, ctx: StepContext): string | undefined {
  return definition.requires?.(ctx);
}

function hasAnyArtifact(definition: StepDefinition, ctx: StepContext): boolean {
  const produced = (definition.produces ?? []).some((path) => existsSync(join(ctx.unitDirectory, path)));
  return produced || (definition.evidence !== undefined && definition.evidence(ctx));
}

export function evaluate(skill: SkillSteps, ctx: StepContext): Evaluation {
  const steps: EvaluatedStep[] = [];
  // 前のステップを完了とみなしたイベントの位置。これより後のイベントだけが有効。
  // step restart より前の記録も使わない
  const start = startOf(skill, ctx.events);
  let floor = start;
  let current: EvaluatedStep | undefined;
  let interrupted: EvaluatedStep | undefined;

  const indexed = ctx.events.map((event, index) => ({ event, index }));

  for (const definition of skill.steps) {
    // 割り込みのきっかけは1回の評価で1度だけ求める（記録のファイルを読むため）
    const trigger = definition.interrupt?.(ctx);
    if (!isOn(definition, ctx, trigger)) {
      steps.push({ definition, status: "off", event: undefined, note: undefined, revise: undefined });
      continue;
    }
    if (definition.interrupt !== undefined) {
      // 承認は step restart より前のものも数える。きっかけの出来事は区切りで消えないので、その出来事への答えも消さない
      const evaluated = evaluateInterrupt(definition, trigger ?? "", indexed, skill.skill);
      steps.push(evaluated);
      if (evaluated.status === "pending") interrupted ??= evaluated;
      continue;
    }
    if (current !== undefined) {
      steps.push({ definition, status: "pending", event: undefined, note: undefined, revise: undefined });
      continue;
    }

    const own = indexed.filter(
      ({ event, index }) => index > floor && event.skill === skill.skill && event.step === definition.id,
    );
    const latest = own[own.length - 1];
    let evaluated: EvaluatedStep;

    if (latest === undefined) {
      evaluated = { definition, status: "pending", event: undefined, note: undefined, revise: undefined };
    } else if (definition.kind === "gate") {
      if (latest.event.result === "rejected") {
        evaluated = {
          definition, status: "pending", event: latest.event,
          note: "差し戻されています。答えに沿って直してから、提示し直してください", revise: latest.event.input ?? "",
        };
      } else if (latest.event.result === "approved") {
        const reopened = definition.reopens?.(ctx, latest.event);
        if (reopened !== undefined) {
          evaluated = { definition, status: "pending", event: latest.event, note: reopened, revise: undefined };
        } else {
          evaluated = { definition, status: "complete", event: latest.event, note: undefined, revise: undefined };
          floor = latest.index;
        }
      } else {
        evaluated = { definition, status: "pending", event: latest.event, note: undefined, revise: undefined };
      }
    } else if (COMPLETING[definition.kind].includes(latest.event.result)) {
      if (latest.event.result === "skipped") {
        evaluated = { definition, status: "skipped", event: latest.event, note: undefined, revise: undefined };
        floor = latest.index;
      } else if (definition.recordsPr === true && latest.event.pr === undefined) {
        evaluated = {
          definition, status: "pending", event: latest.event,
          note: "完了の記録に PR がありません。--pr に PR の URL を添えて報告し直してください", revise: undefined,
        };
      } else if (!hasEvidence(definition, ctx)) {
        evaluated = {
          definition, status: "pending", event: latest.event,
          note: "完了の記録はありますが、成果物がありません。作り直してください", revise: undefined,
        };
      } else {
        evaluated = { definition, status: "complete", event: latest.event, note: undefined, revise: undefined };
        floor = latest.index;
      }
    } else {
      evaluated = {
        definition, status: "pending", event: latest.event,
        note:
          latest.event.result === "failed"
            ? `前回は失敗しました: ${latest.event.reason ?? "理由なし"}`
            : latest.event.result === "handover"
              ? `前のセッションが、このステップの前でセッションを切り替えました（${latest.event.reason ?? "理由なし"}）。このステップから続けます`
              : undefined,
        revise: undefined,
      };
    }

    steps.push(evaluated);
    if (evaluated.status === "pending") current = evaluated;
  }

  // 記録の欠けは並びの現在地から判定する（割り込みのゲートが現在地でも、並びの位置は変わらない）
  const currentIndex = current === undefined ? steps.length : steps.indexOf(current);
  // 後ろのステップに成果物があっても、一度でも記録があれば「やり直しで前に戻った」のであって
  // 記録の欠けではない（G4 の差し戻しで questions から報告し直したときなど）
  const recorded = new Set(ctx.events.filter((event) => event.skill === skill.skill).map((event) => event.step));
  const orphans = steps
    .slice(currentIndex + 1)
    .filter((step) => step.status !== "off" && step.definition.interrupt === undefined && !recorded.has(step.definition.id) && hasAnyArtifact(step.definition, ctx));

  return { steps, current: interrupted ?? current, sequential: current, orphans };
}

/**
 * 割り込みのゲートの評価。きっかけの時刻より後の、今回の回の記録だけを見る。承認で完了し、
 * 差し戻しなら答えを返して提示し直す。完了しても floor は動かさない
 */
function evaluateInterrupt(
  definition: StepDefinition,
  trigger: string,
  indexed: { event: ProgressEvent; index: number }[],
  skill: string,
): EvaluatedStep {
  const own = indexed.filter(({ event }) => event.skill === skill && event.step === definition.id && event.at > trigger);
  const latest = own[own.length - 1]?.event;
  if (latest?.result === "approved") {
    return { definition, status: "complete", event: latest, note: undefined, revise: undefined };
  }
  if (latest?.result === "rejected") {
    return {
      definition, status: "pending", event: latest,
      note: "差し戻されています。答えに沿って直してから、提示し直してください", revise: latest.input ?? "",
    };
  }
  return { definition, status: "pending", event: latest, note: undefined, revise: undefined };
}

/**
 * そのスキルの今回の手順が始まる位置（この位置より後の記録が有効）。
 * step restart の区切りがあればそこから。内部スキルは何度も呼ばれるので、呼び出し元が
 * 最後に報告したあとも今回の分とする（呼び出し元は、内部スキルが戻ってから call を報告する）。
 * 呼び出し元が報告しないまま呼び直すときは、内部スキルの側で step restart する
 */
export function startOf(skill: Pick<SkillSteps, "skill" | "internal">, events: ProgressEvent[]): number {
  const restart = lastIndexOf(events, (event) => event.skill === skill.skill && event.result === RESTART);
  const caller = skill.internal === true ? lastIndexOf(events, (event) => event.skill !== skill.skill) : -1;
  return Math.max(restart, caller);
}

function lastIndexOf(events: ProgressEvent[], matches: (event: ProgressEvent) => boolean): number {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (matches(events[i] as ProgressEvent)) return i;
  }
  return -1;
}

/** 今回の回で有効な記録（そのスキルの手順が始まった位置より後） */
export function currentEvents(skill: Pick<SkillSteps, "skill" | "internal">, events: ProgressEvent[]): ProgressEvent[] {
  return events.slice(startOf(skill, events) + 1);
}

/** 今回の回の種類。step restart --round で始めた回ならその値、それ以外は undefined */
export function currentRound(skill: SkillSteps, events: ProgressEvent[]): string | undefined {
  const index = lastIndexOf(events, (event) => event.skill === skill.skill && event.result === RESTART);
  return index === -1 ? undefined : events[index]?.round;
}

/** 報告で添えた予測ピークのうち、最後のもの */
export function latestPeak(events: ProgressEvent[]): number | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i]?.result === RESTART) return undefined;
    const peak = events[i]?.peak;
    if (peak !== undefined) return peak;
  }
  return undefined;
}
