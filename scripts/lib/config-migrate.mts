/**
 * v2 の [conductor] の設定（プロバイダごとのモデル）を、v3 の形へ移す。
 *
 * v2: [conductor] provider / [conductor.claude] model / [conductor.claude.models] /
 *     [conductor.codex] model / [conductor.codex.models]
 * v3: [conductor] model / [conductor.models]
 *
 * ユーザーの設定ファイルなので、書き換えは最小にする。TOML を組み直さず、行を扱う:
 * 廃止したテーブルと行を消し、移す値だけを生成した行として足す（他のテーブルとコメントには触らない）。
 * 値は構文解析の結果から取るので、移す値の書き方（ドット記法など）には依存しない。
 * 書き換えたあとの内容を解析し直して、廃止キーが残っていないことと、移した値が合っていることを確かめてから返す。
 */

import { CONDUCTOR_PHASES } from "./conductor.mts";
import { retiredConductorKeys } from "./config.mts";
import { HikyakuError } from "./errors.mts";
import { parseToml, type TomlTable, type TomlValue } from "./toml.mts";

export interface MigrationChange {
  action: "move" | "remove";
  /** 移す・消す前のキー（`[conductor.claude] model` のように表示用） */
  from: string;
  /** 移し先（remove では無い） */
  to?: string;
  /** 移す値（TOML の書式） */
  value?: string;
}

export interface MigrationResult {
  /** 変換する内容が無ければ false（書き込む必要が無い） */
  changed: boolean;
  changes: MigrationChange[];
  /** 変換の前に知らせること（自動では直さない） */
  notes: string[];
  /** 書き換えたあとの内容 */
  content: string;
}

export interface MigrationOptions {
  /** true なら、取り込まずに旧キーを消すだけにする */
  drop: boolean;
}

interface Block {
  /** 正規化したテーブル名（`conductor.claude`）。ファイルの先頭（最初のテーブルより前）は undefined */
  path: string | undefined;
  lines: string[];
}

const HEADER = /^\s*\[\[?\s*([A-Za-z0-9_.\- ]+?)\s*\]\]?\s*(#.*)?$/;
const CONDUCTOR_ROOT_LINE = /^\s*conductor\s*\.\s*(provider|claude|codex)\b/;
const CONDUCTOR_BODY_LINE = /^\s*(provider|claude|codex)\b\s*[.=]/;

function normalize(path: string): string {
  return path.split(".").map((part) => part.trim()).join(".");
}

/** 複数行文字列の中の `[...]` を見出しと読まないよう、開閉を数えながらテーブルごとに分ける */
function splitBlocks(content: string): Block[] {
  const blocks: Block[] = [{ path: undefined, lines: [] }];
  let multiline: string | undefined;
  for (const line of content.split("\n")) {
    const header = multiline === undefined ? HEADER.exec(line) : null;
    if (header) blocks.push({ path: normalize(header[1] as string), lines: [line] });
    else (blocks[blocks.length - 1] as Block).lines.push(line);
    for (const quote of ['"""', "'''"]) {
      const count = line.split(quote).length - 1;
      if (count % 2 === 1) multiline = multiline === quote ? undefined : multiline ?? quote;
    }
  }
  return blocks;
}

function isContent(line: string): boolean {
  const trimmed = line.trim();
  return trimmed !== "" && !trimmed.startsWith("#");
}

/** テーブルの本文のうち、最後の内容の行の次（足した行をコメントや空行の後ろに置かないため） */
function insertionIndex(block: Block): number {
  for (let index = block.lines.length - 1; index >= 0; index -= 1) {
    if (isContent(block.lines[index] as string)) return index + 1;
  }
  return 1;
}

/** 内容の最後の行より後ろの、空行とコメントの続き（次のテーブルの前置きかもしれないので残す） */
function trailing(block: Block): string[] {
  return block.lines.slice(insertionIndex(block));
}

function isTable(value: TomlValue | undefined): value is TomlTable {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: TomlValue | undefined, where: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new HikyakuError(`${where} は空でない文字列で指定されていないので、自動では移せません`, "値を直すか、--drop で取り込まずに消してください。");
  }
  return value;
}

export function migrateConductor(content: string, options: MigrationOptions): MigrationResult {
  const table = parseToml(content);
  if (retiredConductorKeys(table).length === 0) return { changed: false, changes: [], notes: [], content };

  const conductor = (isTable(table["conductor"]) ? table["conductor"] : {}) as TomlTable;
  const claude = isTable(conductor["claude"]) ? conductor["claude"] : undefined;
  const codex = isTable(conductor["codex"]) ? conductor["codex"] : undefined;
  const changes: MigrationChange[] = [];
  const notes: string[] = [];
  const conflicts: string[] = [];

  // 移す値
  let model: string | undefined;
  const models: Array<[string, string]> = [];
  if (!options.drop && claude !== undefined) {
    model = stringValue(claude["model"], "[conductor.claude] model");
    const claudeModels = claude["models"];
    if (claudeModels !== undefined && !isTable(claudeModels)) {
      throw new HikyakuError("[conductor.claude] models はテーブルで指定されていないので、自動では移せません", "値を直すか、--drop で取り込まずに消してください。");
    }
    for (const [phase, value] of Object.entries(claudeModels ?? {})) {
      if (!(CONDUCTOR_PHASES as readonly string[]).includes(phase)) {
        throw new HikyakuError(
          `[conductor.claude.models] に指定できないキーです: ${phase}`,
          `使用できるキー: ${CONDUCTOR_PHASES.join(" | ")}。直すか、--drop で取り込まずに消してください。`,
        );
      }
      const phaseModel = stringValue(value, `[conductor.claude.models] ${phase}`);
      if (phaseModel !== undefined) models.push([phase, phaseModel]);
    }
  }

  // 移し先に別の値があれば上書きせずに止める
  const existingModel = conductor["model"];
  const existingModels = isTable(conductor["models"]) ? conductor["models"] : {};
  if (model !== undefined && existingModel !== undefined && existingModel !== model) {
    conflicts.push(`[conductor] model = ${JSON.stringify(existingModel)} が既にあり、[conductor.claude] model = ${JSON.stringify(model)} と異なります`);
  }
  for (const [phase, value] of models) {
    const existing = existingModels[phase];
    if (existing !== undefined && existing !== value) {
      conflicts.push(`[conductor.models] ${phase} = ${JSON.stringify(existing)} が既にあり、[conductor.claude.models] ${phase} = ${JSON.stringify(value)} と異なります`);
    }
  }
  if (conflicts.length > 0) {
    throw new HikyakuError(
      `移し先に別の値があるので、移行を止めました（何も書き換えていません）:\n${conflicts.map((line) => `  - ${line}`).join("\n")}`,
      "どちらを残すか決めて、片方を手で消してから実行し直してください。claude の分を取り込まずに旧キーだけ消すなら --drop です。",
    );
  }
  const provider = conductor["provider"];
  if (provider === "codex" && !options.drop && (existingModel !== undefined || Object.keys(existingModels).length > 0)) {
    notes.push(
      "provider = \"codex\" だった v2 の [conductor] model / [conductor.models] は Codex のモデルを指していましたが、v3 では子のセッション（Claude Code）のモデルとして読まれます。値が Claude Code で使えるか確かめてください。",
    );
  }

  // 書き換える
  const blocks = splitBlocks(content);
  let firstRemoved: number | undefined;
  const merged: Block[] = [];
  /** 消したテーブルの後ろに残した空行・コメントは、直前のテーブルの末尾へ寄せる */
  const add = (block: Block): void => {
    const last = merged[merged.length - 1];
    if (block.path === undefined && last !== undefined) last.lines.push(...block.lines);
    else merged.push(block);
  };
  for (const block of blocks) {
    const path = block.path;
    if (path === "conductor.claude" || path === "conductor.claude.models" || path === "conductor.codex" || path === "conductor.codex.models") {
      firstRemoved ??= merged.length;
      // 消すテーブルの見出しの直前にあるコメント（空行を挟まない）は、そのテーブルの説明なので一緒に消す
      const above = merged[merged.length - 1];
      while (above !== undefined && above.lines.length > 1 && (above.lines[above.lines.length - 1] as string).trim().startsWith("#")) above.lines.pop();
      // 内容の後ろの空行とコメントは次のテーブルの前置きかもしれないので残す
      const rest = trailing(block);
      if (rest.length > 0) add({ path: undefined, lines: rest });
      continue;
    }
    add({
      path,
      lines: block.lines.filter((line, lineIndex) => {
        if (path === undefined) return !CONDUCTOR_ROOT_LINE.test(line);
        if (path === "conductor") return lineIndex === 0 || !CONDUCTOR_BODY_LINE.test(line);
        return true;
      }),
    });
  }

  const modelLine = model === undefined || existingModel === model ? undefined : `model = ${JSON.stringify(model)}`;
  const modelLines = models.filter(([phase, value]) => existingModels[phase] !== value).map(([phase, value]) => `${phase} = ${JSON.stringify(value)}`);

  const insertInto = (path: string, lines: string[]): boolean => {
    if (lines.length === 0) return true;
    const block = merged.find((candidate) => candidate.path === path);
    if (block === undefined) return false;
    block.lines.splice(insertionIndex(block), 0, ...lines);
    return true;
  };
  const created: Block[] = [];
  if (modelLine !== undefined && !insertInto("conductor", [modelLine])) created.push({ path: "conductor", lines: ["[conductor]", modelLine] });
  if (modelLines.length > 0 && !insertInto("conductor.models", modelLines)) created.push({ path: "conductor.models", lines: ["[conductor.models]", ...modelLines] });
  if (created.length > 0) {
    // 新しいテーブルは、既存の [conductor] の本文の直後に置く。無ければ、消したテーブルのあった場所（行だけ消した場合は末尾）
    const conductorIndex = merged.findIndex((candidate) => candidate.path === "conductor");
    const position = conductorIndex >= 0 ? conductorIndex + 1 : Math.min(firstRemoved ?? merged.length, merged.length);
    const spaced = created.map((block, index) => ({ ...block, lines: [...(index === 0 && position > 0 ? [""] : []), ...block.lines, ""] }));
    merged.splice(position, 0, ...spaced);
  }

  const next = tidy(merged.map((block) => block.lines.join("\n")).join("\n"), content);

  // 説明用の変更の一覧（構文解析の結果から作る）
  if (provider !== undefined) changes.push({ action: "remove", from: "[conductor] provider" });
  if (claude !== undefined) {
    if (model !== undefined) {
      changes.push(existingModel === model
        ? { action: "remove", from: "[conductor.claude] model", value: JSON.stringify(model) }
        : { action: "move", from: "[conductor.claude] model", to: "[conductor] model", value: JSON.stringify(model) });
    } else if (claude["model"] !== undefined) {
      changes.push({ action: "remove", from: "[conductor.claude] model", value: JSON.stringify(claude["model"]) });
    }
    const claudeModels = isTable(claude["models"]) ? claude["models"] : {};
    for (const [phase, value] of Object.entries(claudeModels)) {
      const same = existingModels[phase] === value;
      changes.push(!options.drop && !same
        ? { action: "move", from: `[conductor.claude.models] ${phase}`, to: `[conductor.models] ${phase}`, value: JSON.stringify(value) }
        : { action: "remove", from: `[conductor.claude.models] ${phase}`, value: JSON.stringify(value) });
    }
  }
  if (codex !== undefined) {
    if (codex["model"] !== undefined) changes.push({ action: "remove", from: "[conductor.codex] model", value: JSON.stringify(codex["model"]) });
    const codexModels = isTable(codex["models"]) ? codex["models"] : {};
    for (const [phase, value] of Object.entries(codexModels)) {
      changes.push({ action: "remove", from: `[conductor.codex.models] ${phase}`, value: JSON.stringify(value) });
    }
  }

  // 書き換えた結果の検証。残ったり、値が食い違ったりしていれば、書かずに止める
  const after = parseToml(next);
  const afterConductor = (isTable(after["conductor"]) ? after["conductor"] : {}) as TomlTable;
  const afterModels = isTable(afterConductor["models"]) ? afterConductor["models"] : {};
  const mismatch =
    retiredConductorKeys(after).length > 0 ||
    (model !== undefined && afterConductor["model"] !== model) ||
    models.some(([phase, value]) => afterModels[phase] !== value);
  if (mismatch) {
    throw new HikyakuError(
      "設定の書き換えを自動では安全にできませんでした（何も書き換えていません）",
      "[conductor] の設定を手で書き換えてください: claude の model は [conductor] model に、models は [conductor.models] に移し、provider と codex は削除します。",
    );
  }

  return { changed: true, changes, notes, content: next };
}

/** 消したあとに空行が3行以上続いたら詰める。元のファイルの末尾の改行の有無は保つ */
function tidy(content: string, original: string): string {
  let result = content.replace(/\n{3,}/g, "\n\n");
  if (original.endsWith("\n")) result = `${result.replace(/\n+$/, "")}\n`;
  else result = result.replace(/\n+$/, "");
  return result;
}
