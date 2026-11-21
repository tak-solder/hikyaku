import assert from "node:assert/strict";
import { test } from "node:test";
import { HikyakuError } from "../scripts/lib/errors.mts";
import { ghFailure } from "../scripts/lib/gh-failure.mts";

test("ghFailure: execFile の ENOENT と、包んだエラーの spawn gh ENOENT を gh-unavailable にする", () => {
  const spawn = Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" });
  assert.deepEqual(ghFailure("gh pr view", spawn), { reason: "gh-unavailable", stage: "gh pr view", error: "spawn gh ENOENT" });
  const wrapped = new HikyakuError("PR #7 のレビューの依頼とスレッドを gh api graphql で取得できませんでした", "spawn gh ENOENT");
  assert.equal(ghFailure("gh api graphql", wrapped).reason, "gh-unavailable");
});

test("ghFailure: gh の設定ファイルの ENOENT などは gh-failed（gh 自体はある）", () => {
  const config = Object.assign(new Error("Command failed: gh pr view 7\nopen /home/u/.config/gh/hosts.yml: ENOENT"), { code: 1 });
  const failure = ghFailure("gh pr view", config);
  assert.equal(failure.reason, "gh-failed");
  assert.equal(failure.error, "open /home/u/.config/gh/hosts.yml: ENOENT");
});

test("ghFailure: 理由は stderr の1行目から取る（gh auth login を促す文面がユーザーに届く）", () => {
  const auth = Object.assign(new Error("Command failed: gh pr view 7 --json number"), {
    code: 4, stderr: "To get started with GitHub CLI, please run:  gh auth login\n",
  });
  assert.equal(ghFailure("gh pr view", auth).error, "To get started with GitHub CLI, please run:  gh auth login");
});
