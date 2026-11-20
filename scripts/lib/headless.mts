/**
 * conductor の子に渡す非対話規約（skills/conductor/references/headless-protocol.md）を、起動ごとに組み立てる。
 *
 * 規約は子の system prompt に毎回足されるので、その起動で起こりえない場面の節まで渡すと、子のセッションごとに
 * 読む量が増える。節（`## ` の見出し）のうち、場面が限られるものはその場面の起動にだけ入れる。
 * 見出しを変えたら CONDITIONAL_SECTIONS も直す（tests/headless.test.mts が食い違いを検出する）。
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** この起動で起こりうる場面 */
export interface ProtocolScene {
  /** builder の子（implement の区切りでセッションを切り替えうる） */
  builder: boolean;
  /** ユーザーに上げる問いを記録させる再開（--escalate） */
  escalate: boolean;
  /** 答えの出どころ（--from） */
  from: "user" | "supervisor" | undefined;
  /** 事後同意が有効なサイクル */
  deferredConsent: boolean;
}

/** 場面が限られる節の見出しと、入れる条件 */
export const CONDITIONAL_SECTIONS: Record<string, (scene: ProtocolScene) => boolean> = {
  "セッションを切り替える": (scene) => scene.builder,
  "ユーザーに上げる問い": (scene) => scene.escalate,
  "ユーザーの答えを記録する": (scene) => scene.from === "user",
  "事後同意（同意ゲートは最後のビルドだけ）": (scene) => scene.deferredConsent,
  "監督から委任された判断を記録する": (scene) => scene.from === "supervisor",
};

interface Section {
  heading: string | undefined;
  text: string;
}

/** `## ` の見出しで節に分ける。コードブロックの中の `## ` は見出しにしない（blocked の例が `## 試したこと` を含む） */
export function protocolSections(markdown: string): Section[] {
  const sections: Section[] = [{ heading: undefined, text: "" }];
  let fence = false;
  for (const line of markdown.split("\n")) {
    if (/^```/.test(line)) fence = !fence;
    const match = fence ? null : /^## (.+)$/.exec(line);
    if (match !== null) sections.push({ heading: (match[1] as string).trim(), text: "" });
    const current = sections[sections.length - 1] as Section;
    current.text += `${line}\n`;
  }
  return sections;
}

/** 場面に要る節だけを残した規約 */
export function composeProtocol(markdown: string, scene: ProtocolScene): string {
  return protocolSections(markdown)
    .filter((section) => {
      const condition = section.heading === undefined ? undefined : CONDITIONAL_SECTIONS[section.heading];
      return condition === undefined || condition(scene);
    })
    .map((section) => section.text)
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()
    .concat("\n");
}

/**
 * 組み立てた規約を一時ディレクトリに書き、そのパスを返す。名前は中身のハッシュなので、同じ規約は同じファイルを使い回す
 * （ワークスペースには書かない）
 */
export function writeProtocol(source: string, scene: ProtocolScene): string {
  const text = composeProtocol(readFileSync(source, "utf8"), scene);
  const path = join(tmpdir(), `hikyaku-protocol-${createHash("sha1").update(text).digest("hex").slice(0, 12)}.md`);
  if (!existsSync(path)) writeFileSync(path, text, "utf8");
  return path;
}
