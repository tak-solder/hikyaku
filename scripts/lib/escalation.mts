/**
 * 行き詰まりの報告の形式の検査（US-3・原則3）。
 *
 * 行き詰まってユーザーに上げる報告（差し戻しの return.md・retry-limit の failed --reason・
 * conductor の子の <hikyaku-blocked>）に、試したこと・問題を変える選択肢とそれぞれで失うもの・推奨が
 * そろっているかだけを判定する。選択肢が本当に問題を変えるものかは判定しない（LLM とユーザーが読む）。
 *
 * 節の名前を変えるときは、テンプレート（skills/builder/references/templates.md の return.md・
 * retry-policy.md・skills/conductor/references/headless-protocol.md）を同じ変更で直す。
 */

export const ESCALATION_SECTIONS = { tried: "試したこと", options: "選択肢", recommendation: "推奨" } as const;

type SectionKey = keyof typeof ESCALATION_SECTIONS;

export interface EscalationCheck {
  ok: boolean;
  /** 欠けの説明（1件1行） */
  problems: string[];
}

/** 見出し（# 〜 ######）。名前を含む見出しを節の始まりと読む（「問題を変える選択肢」も選択肢） */
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
/**
 * 行頭のラベル（`試したこと:` / `**推奨**：`）。コロンの後の同じ行の本文も中身。リストの項目（`- 推奨: …`）は
 * ほかの節の中身として読み、節を切り替えない
 */
const LABEL = /^\*{0,2}((?:問題を変える)?選択肢|試したこと|推奨)\*{0,2}\s*[:：]\s*(.*)$/;
/** リストの項目の行。字下げが2未満のものを項目の始まりと読み、深い字下げは続きの行 */
const ITEM = /^\s{0,1}(?:(?:[-*+]|\d+[.)])\s+|・\s*)(.*)$/;
const LOSS = /失うもの\s*[:：]/;
/** テンプレートの置き場所の印（（…））。埋めずに出した報告を通さない */
const PLACEHOLDER_GROUP = /（[^（）]*）/g;
/** リストの印と、テンプレートの項目のラベル（`A:`） */
const MARKER = /^\s*(?:[-*+・]|\d+[.)])?\s*(?:[A-Za-z][:：]\s*)?/;

/** 置き場所の印とリストの印を除いた本文が空か */
function blank(text: string): boolean {
  return text.replace(PLACEHOLDER_GROUP, "").replace(MARKER, "").trim() === "";
}

/** 見出しは節の名前で終わるものだけを節と読む（「問題を変える選択肢」は選択肢。「推奨しない理由」は読まない） */
function sectionOfHeading(title: string): SectionKey | undefined {
  const plain = title.replace(/\*/g, "").trim();
  if (plain.endsWith(ESCALATION_SECTIONS.tried)) return "tried";
  if (plain.endsWith(ESCALATION_SECTIONS.options)) return "options";
  if (plain.endsWith(ESCALATION_SECTIONS.recommendation)) return "recommendation";
  return undefined;
}

function sectionOfLabel(name: string): SectionKey {
  if (name === ESCALATION_SECTIONS.tried) return "tried";
  if (name.endsWith(ESCALATION_SECTIONS.options)) return "options";
  return "recommendation";
}

/** 節ごとの中身の行。同じ節が2回現れたら後ろに足す。節が無ければ undefined */
function splitSections(text: string): Map<SectionKey, string[]> {
  const sections = new Map<SectionKey, string[]>();
  let current: string[] | undefined;
  // 節を開いた見出しの深さ。ラベルで開いた節は 0（どの見出しでも閉じる）
  let level = 0;
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const heading = HEADING.exec(line);
    if (heading !== null) {
      const depth = (heading[1] ?? "#").length;
      const key = sectionOfHeading(heading[2] ?? "");
      // 節の中の小見出し（`### A: スコープを削る`）は、その節の項目として読む
      if (key === undefined && current !== undefined && level > 0 && depth > level) {
        current.push(`- ${heading[2] ?? ""}`);
        continue;
      }
      current = key === undefined ? undefined : sections.get(key) ?? [];
      if (key !== undefined && current !== undefined) sections.set(key, current);
      level = depth;
      continue;
    }
    const label = LABEL.exec(line);
    if (label !== null) {
      const key = sectionOfLabel(label[1] ?? "");
      current = sections.get(key) ?? [];
      level = 0;
      sections.set(key, current);
      if ((label[2] ?? "").trim() !== "") current.push(label[2] ?? "");
      continue;
    }
    current?.push(line);
  }
  return sections;
}

function meaningful(lines: string[]): string[] {
  return lines.filter((line) => !blank(line));
}

/** 選択肢の項目（項目の行と、その続きの行をつなげたもの）。リストが無ければ本文全体を1項目とする */
function itemsOf(lines: string[]): string[] {
  const items: string[] = [];
  let open = false;
  for (const line of lines) {
    if (ITEM.test(line)) {
      items.push(line);
      open = true;
    } else if (open && items.length > 0) {
      items[items.length - 1] += `\n${line}`;
    }
  }
  if (items.length > 0) return items;
  return lines.length === 0 ? [] : [lines.join("\n")];
}

/** 形式だけを判定する */
export function checkEscalation(text: string): EscalationCheck {
  const sections = splitSections(text);
  const problems: string[] = [];

  const tried = sections.get("tried");
  if (tried === undefined) problems.push(`「${ESCALATION_SECTIONS.tried}」の節がありません`);
  else if (meaningful(tried).length === 0) problems.push(`「${ESCALATION_SECTIONS.tried}」に項目がありません`);

  const options = sections.get("options");
  if (options === undefined) {
    problems.push(`「${ESCALATION_SECTIONS.options}」の節がありません`);
  } else {
    const items = itemsOf(meaningful(options));
    if (items.length === 0) problems.push(`「${ESCALATION_SECTIONS.options}」に項目がありません`);
    items.forEach((item, index) => {
      const where = `「${ESCALATION_SECTIONS.options}」の${index + 1}件目`;
      const loss = LOSS.exec(item);
      if (loss === null) {
        problems.push(`${where}に「失うもの:」がありません`);
        return;
      }
      // テンプレートの「- （…） 失うもの: （…）」を埋めずに残した項目を通さない
      if (blank(item.slice(0, loss.index))) problems.push(`${where}の選択肢が空です`);
      if (blank(item.slice(loss.index + loss[0].length))) problems.push(`${where}の「失うもの:」が空です`);
    });
  }

  const recommendation = sections.get("recommendation");
  if (recommendation === undefined) problems.push(`「${ESCALATION_SECTIONS.recommendation}」の節がありません`);
  else if (meaningful(recommendation).length === 0) problems.push(`「${ESCALATION_SECTIONS.recommendation}」が空です`);

  return { ok: problems.length === 0, problems };
}

/** 欠けを、書き直しの案内つきの複数行にする（stop / restart / failed / violation で共有） */
export function describeEscalationProblems(problems: string[]): string {
  return [
    "行き詰まりの報告に欠けがあります:",
    ...problems.map((problem) => `  - ${problem}`),
    `「${ESCALATION_SECTIONS.tried}」（1項目以上）・「問題を変える${ESCALATION_SECTIONS.options}」（各項目に「失うもの:」）・「${ESCALATION_SECTIONS.recommendation}」をそろえてください（見出しでも、行頭の「${ESCALATION_SECTIONS.tried}:」のようなラベルでも読みます）。`,
  ].join("\n");
}
