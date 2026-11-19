import assert from "node:assert/strict";
import { test } from "node:test";
import type { OpenRecord } from "../scripts/lib/ledger.mts";
import { cli, succeeds, workspace, write } from "./helpers.mts";

// pr body: PR 本文に貼る事実の節をまとめて出し、同意の決定が足りなければ止める
delete process.env["HIKYAKU_CONDUCTOR_CHILD"];

function openItem(directory: string, type: string, summary: string): string {
  const output = succeeds(
    directory, "ledger", "open", "plan", "001", "--type", type, "--when", "merge", "--who", "user",
    "--summary", summary, ...(type === "risk" ? ["--premises", "app.data", "--loses", "古いデータを返さない"] : []), "--json",
  );
  return (JSON.parse(output) as { record: OpenRecord }).record.id;
}

test("pr body: 記録が無ければ空の本文を返す", (t) => {
  const directory = workspace(t, true);
  const result = cli(directory, "pr", "body", "plan", "001", "--json");
  assert.equal(result.status, 0, result.stderr);
  assert.equal((JSON.parse(result.stdout) as { body: string }).body, "");
});

test("pr body: 同意の決定が足りなければ本文を出さずに止め、決定のあとは未決事項の節を出す", (t) => {
  const directory = workspace(t, true);
  const risk = openItem(directory, "risk", "キャッシュの無効化を遅らせる");
  openItem(directory, "question", "表示の文言");

  const refused = cli(directory, "pr", "body", "plan", "001");
  assert.equal(refused.status, 2);
  assert.match(refused.stdout, new RegExp(`ユーザーの決定がありません（${risk.replace(".", "\\.")}）`));
  assert.doesNotMatch(refused.stdout, /## 受け入れたリスク/);

  succeeds(directory, "ledger", "decide", "plan", risk, "001", "--decision", "consented", "--by", "user", "--input", "同意する");
  const body = succeeds(directory, "pr", "body", "plan", "001");
  assert.match(body, /## 受け入れたリスク（事後同意）/);
  assert.match(body, /## マージの前に決める事項\n\n- .*表示の文言/);
  // ledger pr-section と同じ中身
  assert.ok(body.includes(succeeds(directory, "ledger", "pr-section", "plan", "001").trim()));
});

test("pr body: issue への参照を本文の末尾に置く", (t) => {
  const directory = workspace(t, true);
  write(directory, ".hikyaku.config", 'hikyaku_root = "docs/hikyaku"\n\n[external]\ntarget = "github"\n');
  succeeds(directory, "cycle", "link", "001", "--external", "https://github.com/o/r/issues/12");
  openItem(directory, "question", "表示の文言");
  assert.match(succeeds(directory, "pr", "body", "plan", "001").trim(), /表示の文言[^]*\n\nRefs #12$/);
  assert.equal(succeeds(directory, "pr", "body", "close", "001").trim(), "Closes #12");
});
