/** config — 解決済みの設定を出力する */

import { flagString } from "../lib/args.mts";
import { loadConfig } from "../lib/config.mts";
import { emit } from "../lib/output.mts";
import { register } from "../lib/registry.mts";
import { describeSource, openCycleIfAny } from "../lib/workspace.mts";

register({
  name: "config",
  summary: "設定をマージし、対象サイクルの profile を展開して表示する",
  usage: "hikyaku config [<cycle>] [--root <path>] [--profile <name>] [--json]",
  details: [
    "設定は次の順にキー単位でマージされます:",
    "  1. リポジトリルート/.hikyaku.config（必須）",
    "  2. {HIKYAKU_ROOT}/cycles/{NNN}-{slug}/.hikyaku.config（任意）",
    "",
    "サイクル側では hikyaku_root / base_branch / [branch] / [pr] / [external] と",
    "profile を上書きできません（いずれもリポジトリ全体の性質か、cycles.md が正）。",
    "",
    "サイクルを省略した場合は、現在のブランチ → .hikyaku.local → 唯一の進行中サイクル",
    "の順に対象を決めます。決められなければ候補を挙げてエラーにするので、",
    "ユーザーに尋ねてから指定し直してください。サイクルがまだ1つも無いときは",
    "リポジトリルートの設定だけを返します（init / create-cycle 用）。",
    "",
    "profile は承認ゲートとレビューの既定値をまとめて与えます。",
    "個別キー（architecture_gate, plan_review など）で上書きできます。",
    "--profile は what-if の確認用で、cycles.md の値より優先されます。",
  ].join("\n"),
  run: ({ args, operands }) => {
    const opened = openCycleIfAny(args, operands[0]);
    const config = opened
      ? opened.config
      : loadConfig({
          root: flagString(args, "root"),
          profileOverride: flagString(args, "profile"),
        });

    emit({ ...config, cycle: opened?.context.name, cycleSource: opened?.context.source }, () => {
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
        `bpMax        ${config.bpMax}`,
        "",
        "承認ゲート（profile 管轄）:",
        `  G1 user-stories      ${onOff(config.gates.userStories)}`,
        `  G2 codebase-survey   ${onOff(config.gates.codebaseSurvey)}`,
        `  G4 architecture      ${onOff(config.gates.architecture)}`,
        `  G7 plan（単独）      ${onOff(config.gates.plan)}`,
        "  ※ G3 設計案の選択 / G6 tasklist・issue 変更 / G8 plan+test-spec /",
        "     G10 永続ドキュメント昇格 は profile の管轄外で常に有効",
        "",
        "レビュー:",
        `  user_stories_review  ${onOff(config.reviews.userStories)}`,
        `  architecture_review  ${onOff(config.reviews.architecture)}`,
        `  plan_review          ${onOff(config.reviews.plan)}`,
        `  code_review          ${onOff(config.reviews.code)}`,
        `  security_review      ${config.reviews.security}`,
        `  retrospective        ${config.reviews.retrospective}`,
        `  validate             ${config.reviews.validate}`,
        "",
        `branch       ${config.branch.prefix}${config.branch.separator}{cycle}${config.branch.separator}{phase}`,
        `pr.title     ${config.pr.title}`,
        `external     ${config.external.target}`,
      );
      if (config.external.githubRepo) lines.push(`  github_repo  ${config.external.githubRepo}`);
      if (config.external.asanaProjectGid) {
        lines.push(`  asana_project_gid  ${config.external.asanaProjectGid}`);
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
