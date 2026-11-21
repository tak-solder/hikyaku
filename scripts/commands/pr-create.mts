/** pr create / pr update-body — フェーズの PR を REST で作る・本文を差し替える */

import { existsSync, readFileSync } from "node:fs";
import { flagBoolean, flagString } from "../lib/args.mts";
import { branchName, defaultTitleFor, phaseTitleLabel, renderPrTitle } from "../lib/branch.mts";
import { HikyakuError } from "../lib/errors.mts";
import { currentBranch } from "../lib/git.mts";
import { ghRest, prRef } from "../lib/github.mts";
import { emit } from "../lib/output.mts";
import { register } from "../lib/registry.mts";
import { requirePhase, scopeFor } from "../lib/stack.mts";

/** gh の失敗の stderr（gh api は API のエラーの本文を stderr に出す） */
function errorText(error: unknown): string {
  const stderr = typeof error === "object" && error !== null ? (error as { stderr?: unknown }).stderr : undefined;
  return `${error instanceof Error ? error.message : String(error)}\n${typeof stderr === "string" ? stderr : ""}`;
}

function readBody(path: string | undefined): string {
  if (path === undefined) throw new HikyakuError("--body-file に PR の本文のファイルを指定してください");
  if (!existsSync(path)) throw new HikyakuError(`--body-file のファイルがありません: ${path}`);
  return readFileSync(path, "utf8");
}

register({
  name: "pr create",
  summary: "フェーズの Draft PR を作る（同じ向きで開いている PR があれば作らずに返す）",
  usage:
    "hikyaku pr create <phase> [<cycle>] --base <branch> --body-file <path> [--build-title <text>] [--dry-run] [--root <path>] [--json]",
  options: ["base", "body-file", "build-title"],
  maxOperands: 2,
  writes: true,
  details: [
    "head はいま居るブランチで、フェーズの命名規則のブランチ（branch verify の expected）でなければ止めます。",
    "push してから実行してください。base は pr base（conductor の最後の PR は branch verify conductor の",
    "baseBranch）の値を渡します。タイトルは pr title と同じ規則（--build-title は builder と patch）で決めます。",
    "",
    "GitHub の REST（gh api）で作るので、gh の GraphQL が使えない環境（Claude Code のクラウドのセッションなど）でも",
    "動きます。作る前に、同じ head と base で開いている PR を探し、あれば作らずにそれを返します（created: false）。",
    "Draft に対応していないリポジトリでは、Draft を外して作り直し、draft: false を返します。",
    "",
    "--dry-run は、作る PR（タイトル・base・head）と、開いている PR があればそれを返し、作りません。",
    "--dry-run では --body-file を省けます（作る前に、開いている PR があるかだけを確かめるとき）。",
    "作成に失敗したら終了コード 1 で止まります。",
  ].join("\n"),
  run: async ({ args, operands }) => {
    const phase = requirePhase(operands[0]);
    const { config, cycle, context } = scopeFor(args, phase, operands[1]);
    const base = flagString(args, "base");
    if (base === undefined || base.trim() === "") {
      throw new HikyakuError("--base に PR のマージ先を指定してください", "hikyaku pr base <phase> <cycle> の値を渡します。");
    }
    const dryRun = flagBoolean(args, "dry-run");
    // --dry-run は作らないので、本文のファイルが無くてもよい（作る前に、開いている PR を確かめるだけに使える）
    const bodyFile = flagString(args, "body-file");
    const body = dryRun && bodyFile === undefined ? "" : readBody(bodyFile);
    const head = currentBranch(config.repoRoot);
    const expected = branchName(config.branch, phase, cycle);
    if (head !== expected) {
      throw new HikyakuError(
        `いま居るブランチ（${head ?? "不明"}）が、${phase} のブランチ（${expected}）ではありません`,
        "フェーズのブランチに切り替えて push してから実行してください。",
      );
    }
    if (head === base) throw new HikyakuError(`head と base が同じブランチです: ${head}`);
    const title = renderPrTitle(config.pr.title, {
      cycle,
      phase: phaseTitleLabel(phase),
      buildId: /^build-(\d+)$/.exec(phase)?.[1],
      title: defaultTitleFor(phase, context?.record.summary, flagString(args, "build-title")),
    });
    const cwd = config.repoRoot;

    let open: any[];
    try {
      open = await ghRest(cwd, `repos/{owner}/{repo}/pulls?state=open&base=${encodeURIComponent(base)}&per_page=100`);
    } catch (error) {
      throw new HikyakuError("開いている PR を gh api で確かめられませんでした", errorText(error).trim());
    }
    const existing = (Array.isArray(open) ? open : []).find((pull) => pull?.head?.ref === head);
    if (existing !== undefined) {
      const found = { pr: existing.number, url: existing.html_url, base, head, title: existing.title, draft: existing.draft === true, created: false, dryRun };
      emit(found, () => `同じ向きの PR が開いています（作りません）: ${found.url}`);
      return;
    }
    if (dryRun) {
      emit({ pr: null, url: null, base, head, title, draft: true, created: false, dryRun }, () =>
        [`PR を作ります（--dry-run）: ${head} → ${base}`, `タイトル: ${title}`].join("\n"),
      );
      return;
    }

    const create = (draft: boolean) =>
      ghRest(cwd, "repos/{owner}/{repo}/pulls", { method: "POST", fields: { title, head, base, body }, typed: { draft } });
    let draft = true;
    let created: any;
    try {
      created = await create(true);
    } catch (error) {
      // Draft に対応していないリポジトリ（プランや公開範囲による）では、Draft を外して作り直す
      if (!/draft/i.test(errorText(error))) {
        throw new HikyakuError("PR を作れませんでした", `${errorText(error).trim()}\nブランチを push したか、認証と権限を確かめてください。`);
      }
      draft = false;
      try {
        created = await create(false);
      } catch (retry) {
        throw new HikyakuError("PR を作れませんでした", errorText(retry).trim());
      }
    }
    if (!Number.isInteger(created?.number) || typeof created?.html_url !== "string") {
      throw new HikyakuError("PR の作成の応答を読めません", "GitHub の PR の一覧で、作られたかを確かめてください。");
    }
    const result = { pr: created.number, url: created.html_url, base, head, title, draft, created: true, dryRun };
    emit(result, () =>
      [`PR を作りました: ${result.url}`, ...(draft ? [] : ["このリポジトリは Draft に対応していないので、通常の PR で作りました"])].join("\n"),
    );
  },
});

register({
  name: "pr update-body",
  summary: "PR の本文をファイルの内容に差し替える",
  usage: "hikyaku pr update-body --pr <number|url> --body-file <path> [--dry-run] [--json]",
  options: ["pr", "body-file"],
  maxOperands: 0,
  writes: true,
  details: [
    "GitHub の REST（gh api）で書くので、gh の GraphQL が使えない環境でも動きます。",
    "本文は丸ごと差し替えます（追記ではありません）。--dry-run は書き込みません。",
  ].join("\n"),
  run: async ({ args }) => {
    const pr = flagString(args, "pr");
    if (pr === undefined) throw new HikyakuError("--pr に PR の番号か URL を指定してください");
    const ref = prRef(pr);
    const body = readBody(flagString(args, "body-file"));
    const dryRun = flagBoolean(args, "dry-run");
    if (!dryRun) {
      try {
        await ghRest(process.cwd(), `repos/${ref.repo}/pulls/${ref.number}`, { method: "PATCH", fields: { body } });
      } catch (error) {
        throw new HikyakuError(`PR ${pr} の本文を更新できませんでした`, errorText(error).trim());
      }
    }
    emit({ pr: ref.number, updated: !dryRun, dryRun }, () =>
      dryRun ? `PR #${ref.number} の本文を差し替えます（--dry-run）` : `PR #${ref.number} の本文を差し替えました`,
    );
  },
});
