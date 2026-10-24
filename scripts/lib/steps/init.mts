/**
 * init（ワークスペースの初期化）のステップ。
 *
 * step に乗せるのは、雛形（hikyaku init）を生成したあとの手順だけ。それより前の
 * doctor・HIKYAKU_ROOT の決定・v1 の移行・雛形の生成は SKILL.md に置く。step は .hikyaku.config から
 * HIKYAKU_ROOT を解決するので、雛形ができるまでは設定を読めず、現在地を導出できない。
 *
 * 作業単位は HIKYAKU_ROOT 自身で、progress.jsonl はワークスペース直下に置く。
 * init は1リポジトリにつき1回なので、回ごとに分ける必要は無い。
 *
 * produces / evidence は置かない。document-guide.md も AGENTS.md も雛形の生成や init より前から
 * 存在しうるので、成果物として宣言すると「後ろのステップの成果物があるのに記録が無い」と
 * 読まれて止まる。完了の確認（docs validate など）は各ステップの指示で行う。
 */

import type { SkillSteps } from "./engine.mts";

export const INIT_STEPS: SkillSteps = {
  skill: "init",
  unit: (phase) => (phase === "init" ? "" : undefined),
  steps: [
    { id: "cleanup", kind: "run", title: "雛形の警告と旧名ファイルの後始末" },
    {
      id: "register",
      kind: "run",
      title: "既存ドキュメントの検出と document-guide.md への登録",
    },
    {
      id: "link-approval",
      kind: "gate",
      title: "AGENTS.md への索引の承認",
      binds: ["document-guide.md"],
    },
    { id: "link", kind: "run", title: "AGENTS.md への索引の書き込み" },
    { id: "pr", kind: "run", title: "ブランチ・コミット・PR" },
  ],
};
