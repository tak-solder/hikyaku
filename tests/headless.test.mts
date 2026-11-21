import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CONDITIONAL_SECTIONS, composeProtocol, protocolSections, type ProtocolScene } from "../scripts/lib/headless.mts";

// conductor の子に渡す非対話規約を、起動の場面ごとに組み立てる

const SOURCE = readFileSync(fileURLToPath(new URL("../skills/conductor/references/headless-protocol.md", import.meta.url)), "utf8");
const BASE: ProtocolScene = { builder: false, escalate: false, from: undefined, deferredConsent: false };

test("headless: 場面が限られる節の見出しは、規約にすべてある（見出しを変えたら CONDITIONAL_SECTIONS も直す）", () => {
  const headings = protocolSections(SOURCE).map((section) => section.heading);
  for (const heading of Object.keys(CONDITIONAL_SECTIONS)) assert.ok(headings.includes(heading), heading);
});

test("headless: コードブロックの中の ## は見出しにしない", () => {
  const headings = protocolSections(SOURCE).map((section) => section.heading);
  assert.ok(!headings.includes("試したこと"), "blocked の例の節は見出しではない");
});

test("headless: 初回の起動には場面の限られる節を入れず、ブロックの書式は必ず入れる", () => {
  const text = composeProtocol(SOURCE, BASE);
  for (const heading of Object.keys(CONDITIONAL_SECTIONS)) assert.doesNotMatch(text, new RegExp(`^## ${heading.replace(/[()（）]/g, ".")}$`, "m"), heading);
  for (const kept of ["## 非対話で動くときの制約", "## 問いの箇所に来たら止まる", "## 出力するブロック", "## 試したこと", "失うもの:"]) {
    assert.ok(text.includes(kept), kept);
  }
  assert.ok(text.length < SOURCE.length * 0.75, `${text.length} / ${SOURCE.length}`);
});

test("headless: 場面に応じた節だけを足す", () => {
  const has = (scene: Partial<ProtocolScene>, heading: string) => composeProtocol(SOURCE, { ...BASE, ...scene }).includes(`## ${heading}\n`);
  assert.equal(has({ builder: true }, "セッションを切り替える"), true);
  assert.equal(has({ escalate: true }, "ユーザーに上げる問い"), true);
  assert.equal(has({ from: "user" }, "ユーザーの答えを記録する"), true);
  assert.equal(has({ from: "user" }, "監督から委任された判断を記録する"), false);
  assert.equal(has({ from: "supervisor" }, "監督から委任された判断を記録する"), true);
  assert.equal(has({ deferredConsent: true }, "事後同意（同意ゲートは最後のビルドだけ）"), true);
});
