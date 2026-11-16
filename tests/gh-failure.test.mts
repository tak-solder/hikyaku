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
  assert.equal(failure.error, "Command failed: gh pr view 7");
});
