/** patch resolve / patch prune — サイクルを要しない小さな変更（/hikyaku:patch）の対象と記録 */

import { existsSync, readdirSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { flagBoolean, flagString } from "../lib/args.mts";
import { branchName, isPatchPhase, patchPhase, type Phase } from "../lib/branch.mts";
import { loadConfig } from "../lib/config.mts";
import { cycleDir, cyclesPath, loadCycles, normalizeSlug } from "../lib/cycles.mts";
import { HikyakuError } from "../lib/errors.mts";
import { defaultBranch, listKnownBranches, listRemoteBranches } from "../lib/git.mts";
import { emit, table } from "../lib/output.mts";
import { currentMonth, currentPatchPhase, PATCHES_DIR, patchRecordExists, patchUnitDirectory } from "../lib/patch.mts";
import { readProgress } from "../lib/progress.mts";
import { register } from "../lib/registry.mts";
import { integrationBranch, resolvableRef, scopeFor } from "../lib/stack.mts";
import { currentEvents } from "../lib/steps/engine.mts";
import { buildDirName } from "../lib/tasklist.mts";
import { PATCH_STEPS } from "../lib/steps/patch.mts";

register({
  name: "patch resolve",
  summary: "patch の作業単位（patch-YYYYMM-slug）・ブランチ・切る元・関連サイクルの状態を返す",
  usage: "hikyaku patch resolve [<slug>] [--cycle <cycle>] [--root <path>] [--json]",
  options: ["cycle"],
  maxOperands: 1,
  details: [
    "/hikyaku:patch が最初に呼びます。書き込みはしません。",
    "",
    "現在のブランチが patch のブランチ（{prefix}/patch/YYYYMM/slug）なら、その patch の再開として",
    "扱います（resume: true）。slug は無視します。そうでなければ <slug> から、今月の",
    "patch-YYYYMM-slug を作ります。ブランチ名は、ルートとサイクルの [branch] のどちらで名付けられていても読みます。",
    "",
    "サイクルは推測しません。--cycle を渡したときだけ、そのサイクル（進行中のものだけ）に属します。",
    "再開では記録の場所が正で、--cycle を渡さなければ記録のあるサイクルから導き、食い違えばエラーにします。",
    "再開なのに記録がどこにも無ければ（start を記録する前に中断した）recordMissing: true を返します。",
    "サイクルに属すかは記録からは決まらないので、呼び出し元が確かめて --cycle を付け直してください。",
    "",
    "  branch          期待するブランチ名（branch verify の expected と同じ）",
    "  startPoint      ブランチを切る元。サイクルに属すなら統合ブランチ（未マージの conductor",
    "                  ブランチ、無ければサイクルの base_branch）、属さなければ base_branch",
    "  startPointRef   切る元の、ローカルで解決できる ref（追跡参照しか無ければ origin/<name>）",
    "  unitDirectory   記録（progress.jsonl）を置くディレクトリ（リポジトリルートからの相対）",
    "  pendingBuilds   サイクルに属すとき、作業ツリーの tasklist.md で PR 列が空のビルド",
    "  conflict        新しく始めるとき、同じ名前の記録かブランチ（ローカル・追跡参照・origin）があればその説明",
    "  remoteUnavailable  origin のブランチを確かめられなかったときの理由（重複の確認が不完全）",
  ].join("\n"),
  run: async ({ args, operands }) => {
    const root = loadConfig({ root: flagString(args, "root") });
    const current = currentPatchPhase(root);
    let phase: Phase;
    if (current !== undefined) {
      phase = current;
    } else {
      const raw = operands[0];
      if (raw === undefined) {
        throw new HikyakuError(
          "slug を指定してください",
          "依頼の内容を表す英小文字・数字・ハイフンの名前です（例: list-sort-order）。",
        );
      }
      phase = patchPhase({ month: currentMonth(), slug: normalizeSlug(raw) });
    }

    const scope = scopeFor(args, phase, flagString(args, "cycle"));
    const { config, context } = scope;
    const base = config.baseBranch ?? defaultBranch(config.repoRoot);
    const start =
      context === undefined
        ? { name: base, ref: base === undefined ? undefined : await resolvableRef(config.repoRoot, base) }
        : await integrationBranch(config, context, base, { fetch: false });
    const branch = branchName(config.branch, phase, context?.name);
    const unit = join(context?.directory ?? config.hikyakuRoot, patchUnitDirectory(phase) as string);
    const recordMissing = current !== undefined && !patchRecordExists(config.hikyakuRoot, phase);

    // 新しく始めるときだけ、同じ名前の記録とブランチが無いかを見る
    let conflict: string | null = null;
    let remoteUnavailable: string | null = null;
    if (current === undefined) {
      const roots = [config.hikyakuRoot];
      if (existsSync(cyclesPath(config.hikyakuRoot))) {
        for (const record of loadCycles(config.hikyakuRoot)) roots.push(cycleDir(config.hikyakuRoot, record));
      }
      const existing = roots.map((dir) => join(dir, patchUnitDirectory(phase) as string)).find((path) => existsSync(path));
      const known = (await listKnownBranches(config.repoRoot)).some((entry) => entry.name === branch);
      const remote = await listRemoteBranches(config.repoRoot);
      remoteUnavailable = remote.unavailable ?? null;
      if (existing !== undefined) conflict = `同じ名前の patch の記録があります: ${relative(config.repoRoot, existing)}`;
      else if (known) conflict = `同じ名前のブランチがあります（ローカルか追跡参照）: ${branch}`;
      else if (remote.names.includes(branch)) conflict = `同じ名前のブランチが origin にあります: ${branch}`;
    }

    const pendingBuilds =
      context === undefined ? [] : context.builds.filter((build) => build.pr.trim() === "").map((build) => buildDirName(build.id));

    emit(
      {
        phase,
        resume: current !== undefined,
        recordMissing,
        cycle: context?.name ?? null,
        branch,
        startPoint: start.name ?? null,
        startPointRef: start.ref ?? null,
        baseBranch: base ?? null,
        unitDirectory: relative(config.repoRoot, unit),
        pendingBuilds,
        conflict,
        remoteUnavailable,
      },
      () => {
        const lines = [
          `patch      ${phase}${current === undefined ? "" : "（現在のブランチから再開）"}`,
          `サイクル   ${context?.name ?? "（属さない）"}`,
          `ブランチ   ${branch}`,
          `切る元     ${start.name ?? "(特定できません)"}${start.ref !== undefined && start.ref !== start.name ? `（${start.ref}）` : ""}`,
          `記録       ${relative(config.repoRoot, unit)}`,
        ];
        if (recordMissing) {
          lines.push("", "! 記録がまだありません（start を記録する前に中断した）。サイクルに属すかを確かめ、属すなら --cycle を付けてください。");
        }
        if (pendingBuilds.length > 0) lines.push("", `PR 列が空のビルドがあります: ${pendingBuilds.join(", ")}`);
        if (conflict !== null) lines.push("", `! ${conflict}`, "  別の slug を指定してください。");
        if (remoteUnavailable !== null) lines.push("", `! origin のブランチを確かめられませんでした: ${remoteUnavailable}`);
        return lines.join("\n");
      },
    );
  },
});

register({
  name: "patch prune",
  summary: "サイクルに属さない patch のうち、PR を作った古い月の記録を削除する",
  usage: "hikyaku patch prune --before <YYYYMM> [--root <path>] [--dry-run] [--json]",
  options: ["before"],
  writes: true,
  details: [
    `{HIKYAKU_ROOT}/${PATCHES_DIR}/{YYYYMM}/{slug}/ のうち、YYYYMM が --before より前で、`,
    "PR を作った記録（pr ステップの done）があるものと、通常のサイクルへすべて引き継いだものを削除します。",
    "PR の記録が無いものと、いま居るブランチの patch は残して一覧に出します。",
    "",
    "patch の記録は手順の現在地を導くためのもので、PR がマージされたあとは使いません。",
    "デフォルトブランチの作業ツリーにある記録は、PR がマージされた patch のものだけです。",
    "公開（publish）の記録を push する前にマージされた patch も、PR の記録があれば消せます。",
    "サイクルに属さない patch はマージのたびに増えるので、ときどき古い月をまとめて消してください。",
    "削除はこのブランチの作業ツリーだけで、コミットと PR は自分で行います。",
    "サイクルに属す patch の記録はサイクルの中にあるので、対象にしません。",
  ].join("\n"),
  run: ({ args }) => {
    const before = flagString(args, "before");
    if (before === undefined || !/^\d{4}(0[1-9]|1[0-2])$/.test(before)) {
      throw new HikyakuError("--before に YYYYMM を指定してください（例: 202605）");
    }
    const config = loadConfig({ root: flagString(args, "root") });
    const working = currentPatchPhase(config);
    const root = join(config.hikyakuRoot, PATCHES_DIR);
    const removed: string[] = [];
    const kept: { path: string; reason: string }[] = [];

    const months = existsSync(root)
      ? readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && /^\d{6}$/.test(entry.name) && entry.name < before)
      : [];
    for (const month of months) {
      const monthDir = join(root, month.name);
      for (const entry of readdirSync(monthDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const directory = join(monthDir, entry.name);
        const path = relative(config.repoRoot, directory);
        const phase = patchPhase({ month: month.name, slug: entry.name });
        if (!isPatchPhase(phase)) {
          kept.push({ path, reason: "patch の名前ではありません" });
          continue;
        }
        if (phase === working) {
          kept.push({ path, reason: "いま居るブランチの patch です" });
          continue;
        }
        const events = currentEvents(PATCH_STEPS, readProgress(directory));
        const prRecorded = events.some((event) => event.skill === "patch" && event.step === "pr" && event.result === "done" && event.pr !== undefined);
        const handedOver = PATCH_STEPS.stop?.({ config, cycle: undefined, unit: phase, unitDirectory: directory, events }) !== undefined;
        if (!prRecorded && !handedOver) {
          kept.push({ path, reason: "PR を作った記録がありません" });
          continue;
        }
        removed.push(path);
        if (!flagBoolean(args, "dry-run")) rmSync(directory, { recursive: true, force: true });
      }
      if (!flagBoolean(args, "dry-run") && readdirSync(monthDir).length === 0) rmSync(monthDir, { recursive: true, force: true });
    }

    const dryRun = flagBoolean(args, "dry-run");
    emit({ before, dryRun, removed, kept }, () => {
      const lines = [
        removed.length === 0
          ? `${before} より前に、削除できる patch の記録はありません。`
          : `${dryRun ? "（dry-run）次を削除します" : "削除しました"}: ${removed.length} 件`,
      ];
      if (removed.length > 0) lines.push(...removed.map((path) => `  ${path}`));
      if (kept.length > 0) lines.push("", "残したもの", table(kept.map((entry) => [entry.path, entry.reason])));
      return lines.join("\n");
    });
  },
});
