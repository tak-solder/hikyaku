/** config — 解決済みの設定を出力する */

import { flagBoolean, flagString } from "../lib/args.mts";
import { describeProvider, loadConfig } from "../lib/config.mts";
import { DEFAULT_BRANCH_MARK, resolveUnsafeSplit } from "../lib/integrity.mts";
import { emit, warn } from "../lib/output.mts";
import { register } from "../lib/registry.mts";
import { describeSource, openCycle, openCycleIfAny } from "../lib/workspace.mts";

register({
  name: "config",
  summary: "設定をマージし、対象サイクルの profile を展開して表示する",
  usage: "hikyaku config [<cycle>] [--root <path>] [--profile <name>] [--require-cycle] [--json]",
  details: [
    "設定は次の順にキー単位でマージされます:",
    "  1. リポジトリルート/.hikyaku.config（必須）",
    "  2. {HIKYAKU_ROOT}/cycles/{NNN}-{slug}/.hikyaku.config（任意）",
    "",
    "サイクル側で上書きできないのは hikyaku_root と profile だけです",
    "（前者はワークスペースの所在そのもの、後者は cycles.md が唯一の正）。",
    "",
    "サイクルを省略した場合は、現在のブランチ → .hikyaku.local の順で選択済みのサイクルを使い、",
    "未選択ならリポジトリルートの設定を返します。進行中サイクルの件数からは選びません。",
    "サイクルを省略して --profile を指定すると、選択済みのサイクルも参照せず、",
    "ルート設定に profile を当てた結果を返します（新しいサイクルの profile 確認用）。",
    "既存サイクルでの what-if は config <cycle> --profile <name> と明示してください。",
    "--require-cycle は作業開始用です。引数 → ブランチ → 栞 → 唯一の active の順で対象を必須解決し、",
    "未作成や未選択で複数候補があればエラーにします。--profile は解決したサイクルに適用します。",
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
  ].join("\n"),
  run: ({ args, operands }) => {
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

    const retired = config.retired.map((error) => error.message);
    for (const error of config.retired) warn(`${error.message}（v3 の作業では止まります）`);

    emit({ ...config, retired, cycle: opened?.context.name, cycleSource: opened?.context.source, unsafeSplit }, () => {
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
        `  G1 user-stories      ${onOff(config.gates.userStories)}`,
        `  G2 codebase-survey   ${onOff(config.gates.codebaseSurvey)}`,
        `  G3 設計案の選択      ${onOff(config.gates.designChoice)}`,
        `  G4 architecture      ${onOff(config.gates.architecture)}`,
        `  G7 plan（単独）      ${onOff(config.gates.plan)}`,
        "  ※ G6 tasklist・issue 変更 / G8 plan+test-spec /",
        "     G10 永続ドキュメント昇格 は profile の管轄外で常に有効",
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
        "[diff]（tokens history build-NN の差分の集計）:",
        `  exclude  ${config.diff.exclude.join(", ")}`,
        `  tests    ${config.diff.tests.join(", ")}`,
        "",
        "[context]（区切りでのコンテキストの目安）:",
        `  approval   ${config.context.approval.toLocaleString("en-US")}`,
        `  implement  ${config.context.implement.toLocaleString("en-US")}`,
        `  review     ${config.context.review.toLocaleString("en-US")}`,
        "[context]（予測ピークの判定の帯）:",
        `  merge_below  ${config.peakBands.mergeBelow.toLocaleString("en-US")}`,
        `  split_above  ${config.peakBands.splitAbove.toLocaleString("en-US")}`,
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
