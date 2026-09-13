/**
 * 終了コードの定義とエラー型。
 *
 *   0 成功
 *   1 エラー（引数不正・ファイル不在など、実行できなかった）
 *   2 検証失敗（実行したが問題が見つかった）
 *
 * 呼び出し元のスキルが「実行できなかった」と「実行したが問題が見つかった」を
 * 区別できるようにするため、2 を独立させている。
 */

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_VALIDATION = 2;

/** 実行できなかった（終了コード 1） */
export class HikyakuError extends Error {
  /** 対処方法の提示（あれば） */
  hint: string | undefined;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = "HikyakuError";
    this.hint = hint;
  }
}

/** 実行したが問題が見つかった（終了コード 2） */
export class ValidationError extends Error {
  problems: string[];

  constructor(problems: string[]) {
    super(problems.join("\n"));
    this.name = "ValidationError";
    this.problems = problems;
  }
}
