/** config — 解決済みの設定を出力する */

import { flagBoolean, flagString } from "../lib/args.mts";
import { describeProvider, loadConfig, type AppDeclaration, type ResolvedConfig } from "../lib/config.mts";
import { ceilingOf, effectiveDeclaration } from "../lib/risk.mts";
import { deferredConsent } from "../lib/deferred-consent.mts";
import { DEFAULT_BRANCH_MARK, resolveUnsafeSplit } from "../lib/integrity.mts";
import { HikyakuError } from "../lib/errors.mts";
import { emit, warn } from "../lib/output.mts";
import { register } from "../lib/registry.mts";
import { describeSource, openCycle, openCycleIfAny } from "../lib/workspace.mts";

register({
  name: "config",
  summary: "設定をマージし、対象サイクルの profile を展開して表示する",
  usage: "hikyaku config [<cycle>] [--root <path>] [--profile <name>] [--require-cycle | --no-cycle] [--json]",
  details: [
    "設定は次の順にキー単位でマージされます:",
    "  1. リポジトリルート/.hikyaku.config（必須）",
    "  2. {HIKYAKU_ROOT}/cycles/{NNN}-{slug}/.hikyaku.config（任意）",
    "",
    "サイクル側で上書きできないのは hikyaku_root・profile・data_integrity.release_branches・[app]・[boundaries] です",
    "（理由は docs/configuration/config-file.md の「サイクル側で上書きできないキー」）。",
    "",
    "サイクルを省略した場合は、現在のブランチ → .hikyaku.local の順で選択済みのサイクルを使い、",
    "未選択ならリポジトリルートの設定を返します。進行中サイクルの件数からは選びません。",
    "サイクルを省略して --profile を指定すると、選択済みのサイクルも参照せず、",
    "ルート設定に profile を当てた結果を返します（新しいサイクルの profile 確認用）。",
    "既存サイクルでの what-if は config <cycle> --profile <name> と明示してください。",
    "--require-cycle は作業開始用です。引数 → ブランチ → 栞 → 唯一の active の順で対象を必須解決し、",
    "未作成や未選択で複数候補があればエラーにします。--profile は解決したサイクルに適用します。",
    "--no-cycle はサイクルに属さない patch 用です。選択済みのサイクルも参照せず、ルート設定を返します。",
    "",
    "profile は承認ゲートとレビューの既定値をまとめて与えます。",
    "個別キー（architecture_gate, plan_review, test_spec_review など）で上書きできます。",
    "--profile は what-if の確認用で、cycles.md の値より優先されます。",
    "",
    "ルート設定の ask に並べたキーは create-cycle が尋ねます。答えはそのサイクルの",
    ".hikyaku.config に記録されるので、答えていなければルート設定の値のままです。",
    "",
    "unsafeSplit は、マージ時点で本番データの安全を保てないビルド分割を許すかの判定です。",
    "[data_integrity] allow_unsafe_split が true で、base_branch がリリースされるブランチ",
    "（release_branches とデフォルトブランチ）に一致しないときだけ allowed: true になります。",
    "デフォルトブランチ（origin/HEAD）が分からなければ allowed: false に倒します。",
    "",
    "[app]・[[app.areas]]・[boundaries] はアプリケーションの状況と境界の宣言で、ルート設定でのみ書けます。",
    "上限は、作業ツリーの宣言からのものと、base_branch・デフォルトブランチとの merge-base にある宣言",
    "（ユーザーがマージした宣言）と比べた最も厳しいものを並べます。この版では宣言は検査と表示だけで、",
    "ゲートの判定にはまだ使いません。",
  ].join("\n"),
  run: ({ args, operands }) => {
    if (flagBoolean(args, "require-cycle") && flagBoolean(args, "no-cycle")) {
      throw new HikyakuError("--require-cycle と --no-cycle は同時に指定できません");
    }
    const opened = flagBoolean(args, "require-cycle")
      ? openCycle(args, operands[0])
      : openCycleIfAny(args, operands[0]);
    const config = opened
      ? opened.config
      : loadConfig({
          root: flagString(args, "root"),
          profileOverride: flagString(args, "profile"),
        });

    const unsafeSplit = resolveUnsafeSplit(config);
    // 事後同意の有効の判定（git を読むので loadConfig では計算しない）。サイクルが決まらなければ有効にならない
    const deferred = deferredConsent(config, opened?.context.directory);

    const retired = config.retired.map((error) => error.message);
    for (const error of config.retired) warn(`${error.message}（v3 の作業では止まります）`);

    emit({ ...config, retired, cycle: opened?.context.name, cycleSource: opened?.context.source, unsafeSplit, deferredConsent: deferred }, () => {
      const lines: string[] = [];
      if (opened) {
        lines.push(
          `cycle        ${opened.context.name}（${describeSource(opened.context.source)}）`,
        );
      }
      lines.push(
        `repoRoot     ${config.repoRoot}`,
        `hikyakuRoot  ${config.hikyakuRoot}`,
        `profile      ${config.profile}`,
        `baseBranch   ${config.baseBranch ?? "(自動検出)"}`,
        "",
        "承認ゲート（profile 管轄）:",
        "  G1 user-stories      常に有効（同意）",
        `  G2 codebase-survey   ${onOff(config.gates.codebaseSurvey)}`,
        `  G3 設計案の選択      ${onOff(config.gates.designChoice)}（差し戻しからの再設計の回と、options の申告が上限を超える・重い領域に当たる・欠けている回は同意で常に有効）`,
        `  G4 architecture      ${onOff(config.gates.architecture)}（差し戻しからの再設計の回と、設計が G3 の申告に無い重い領域・外との境界に触れる回は同意で常に有効）`,
        `  G7 plan（単独）      ${onOff(config.gates.plan)}`,
        `  G10 昇格             ${onOff(config.gates.promotion)}（decisions・constraints の変更を含む回は同意で常に有効）`,
        "  ※ G6 tasklist・issue 変更 / G8 plan+test-spec は profile の管轄外で常に有効",
        "",
        "レビュー:",
        `  user_stories_review  ${onOff(config.reviews.userStories)}`,
        `  architecture_review  ${onOff(config.reviews.architecture)}`,
        `  tasklist_review      ${onOff(config.reviews.tasklist)}`,
        `  plan_review          ${onOff(config.reviews.plan)}`,
        `  test_spec_review     ${onOff(config.reviews.testSpec)}`,
        `  code_review          ${onOff(config.reviews.code)}`,
        `  security_review      ${config.reviews.security}`,
        `  retrospective        ${config.reviews.retrospective}`,
        `  validate             ${config.reviews.validate}`,
        "",
        `[review]（timeout ${config.review.timeoutMinutes} 分）:`,
        ...(["code", "security", "doc"] as const).map((kind) => {
          const settings = config.review[kind];
          const rounds = kind === "doc" ? "" : `  回数 ${settings.maxRounds === 0 ? "無制限" : settings.maxRounds}${settings.autoFix ? "（auto_fix）" : ""}`;
          const models = (["claude", "codex"] as const)
            .map((provider) => {
              const { model, effort } = settings.models[provider];
              return model === undefined && effort === undefined ? "" : `  ${provider}: ${[model, effort].filter(Boolean).join(" / ")}`;
            })
            .join("");
          return `  ${kind.padEnd(9)}${describeProvider(settings.provider)}${rounds}${models}`;
        }),
        "",
        `branch       ${config.branch.prefix}${config.branch.separator}{cycle}${config.branch.separator}{phase}`,
        `pr.title     ${config.pr.title}`,
        `pr.reviewers ${config.pr.reviewers.length === 0 ? "(アサインしない)" : config.pr.reviewers.join(", ")}`,
        `session      ${config.session.title === "" ? "(変更しない)" : config.session.title}`,
        `external     ${config.external.target}`,
        "",
        "[data_integrity]:",
        `  release_branches    ${[unsafeSplit.defaultBranch === null ? `${DEFAULT_BRANCH_MARK}不明` : `${unsafeSplit.defaultBranch}${DEFAULT_BRANCH_MARK}`, ...config.dataIntegrity.releaseBranches].join(", ")}`,
        `  allow_unsafe_split  ${config.dataIntegrity.allowUnsafeSplit}`,
        `  安全でない分割      ${unsafeSplit.allowed ? "許す" : "許さない"}（${unsafeSplit.message}）`,
        "",
        `[consent] deferred    ${deferred.requested ? (deferred.effective ? "有効" : "選んでいるが有効でない") : "選んでいない"}（${deferred.reason}）`,
        "",
        ...describeDeclaration(config),
        "",
        "[diff]（tokens history build-NN の差分の集計）:",
        `  exclude  ${config.diff.exclude.join(", ")}`,
        `  tests    ${config.diff.tests.join(", ")}`,
        "",
        "[context]（メインセッションのコンテキストの上限）:",
        `  limit           ${config.context.limit.toLocaleString("en-US")}`,
        `  estimate_ratio  ${Math.round(config.context.estimateRatio * 100)}%（見積もりの上限 ${config.peakBands.estimateLimit.toLocaleString("en-US")}）`,
        `  merge_ratio     ${Math.round(config.context.mergeRatio * 100)}%（統合の目安 ${config.peakBands.mergeHint.toLocaleString("en-US")}）`,
      );
      if (config.external.githubRepo) lines.push(`  github_repo  ${config.external.githubRepo}`);
      if (config.askAtCreate.length > 0) {
        lines.push(
          "",
          opened
            ? `作成時に決めるキー（このサイクルは未回答・上の値のまま）: ${config.askAtCreate.join(", ")}`
            : `作成時に決めるキー: ${config.askAtCreate.join(", ")}`,
        );
      }
      lines.push(
        "",
        "security_review の判定基準:",
        ...config.security.triggers.split("\n").map((line) => `  ${line}`),
        "",
        `読み込んだ設定: ${config.sources.length > 0 ? config.sources.join(", ") : "(なし・既定値のみ)"}`,
      );
      return lines.join("\n");
    });
  },
});

function onOff(value: boolean): string {
  return value ? "on" : "off";
}

function describeCeiling(declaration: AppDeclaration | undefined): string {
  if (declaration === undefined) return "上限を設けない（宣言なし）";
  const ceiling = ceilingOf(declaration.axes);
  return ceiling === "なし" ? "なし（何も任せない）" : `害「${ceiling}」まで`;
}

/**
 * [app]・[[app.areas]]・[boundaries] の表示。宣言は作業ツリーのもの。上限は、作業ツリーの宣言からのものと、
 * 基準（ユーザーがマージした宣言）と比べた最も厳しい宣言からのものを並べる
 */
function describeDeclaration(config: ResolvedConfig): string[] {
  const { app, boundaries } = config;
  const effective = effectiveDeclaration(config);
  const lines = ["[app]（アプリケーションの状況。この版では検査と表示だけで、ゲートの判定にはまだ使わない）:"];
  if (app === undefined) {
    lines.push(effective.declaration === undefined ? "  宣言なし（上限を設けない）" : "  作業ツリーには宣言なし（基準の宣言で上限が決まる）");
  } else {
    lines.push(
      `  exposure / data / impact  ${app.axes.exposure} / ${app.axes.data} / ${app.axes.impact}`,
      `  merge_gate                ${app.mergeGate ?? "(未宣言)"}`,
      `  上限（作業ツリーの宣言）  ${describeCeiling(app)}`,
    );
    for (const area of app.areas) {
      const axes = (["exposure", "data", "impact"] as const).flatMap((axis) => (area[axis] === undefined ? [] : [`${axis}=${area[axis]}`]));
      lines.push(`  重い領域 ${area.name}  ${area.paths.join(", ")}${axes.length > 0 ? `（${axes.join(" ")}）` : ""}`);
    }
  }
  if (app !== undefined || effective.declaration !== undefined) {
    lines.push(`  上限（基準と比べた最も厳しい宣言）  ${describeCeiling(effective.declaration)}${effective.incomplete ? "（読めない基準があるので、判定では同意に倒す）" : ""}`);
  }
  for (const notice of effective.notices) lines.push(`  注意: ${notice}`);
  lines.push(
    "[boundaries]:",
    `  external  ${boundaries.external.length === 0 ? "(なし)" : boundaries.external.join(", ")}`,
    `  internal  ${boundaries.internal.length === 0 ? "(なし)" : boundaries.internal.join(", ")}`,
  );
  return lines;
}
