/**
 * gh の失敗の分類（US-18）。PR を作ったあとに付随する処理（レビュアーの依頼・Ready への切り替え）は、
 * gh が使えなくても手順を止めず、何ができなかったかとユーザーが代わりに行うことを返す。
 * 出力の欄（applied / reason）は external sync にそろえる。
 */

export interface GhFailure {
  /** gh-unavailable: gh が無い / gh-failed: それ以外（認証・権限・ネットワーク・応答の不正） */
  reason: "gh-unavailable" | "gh-failed";
  /** 失敗した呼び出し（gh pr view など） */
  stage: string;
  /** エラーの1行目 */
  error: string;
}

export function ghFailure(stage: string, error: unknown): GhFailure {
  // execFile は gh が PATH に無いと code: ENOENT・「spawn gh ENOENT」で失敗する。fetchPrGraphql などが包んだエラーは
  // code を持たないので文面で見るが、gh の設定ファイルの ENOENT などを取り違えないよう spawn の失敗に限る
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  const hint = typeof error === "object" && error !== null ? (error as { hint?: unknown }).hint : undefined;
  const message = error instanceof Error ? error.message : String(error);
  // 包んだエラー（HikyakuError）は hint に gh の元のエラーを持つので、そちらを理由に出す
  const cause = typeof hint === "string" && hint.trim() !== "" ? hint : message;
  const unavailable = code === "ENOENT" || /\bspawn gh ENOENT\b/.test(`${message}\n${cause}`);
  return { reason: unavailable ? "gh-unavailable" : "gh-failed", stage, error: firstLine(cause) };
}

function firstLine(message: string): string {
  return message.split("\n").find((line) => line.trim() !== "")?.trim() ?? "（理由不明）";
}
