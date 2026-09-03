/** doctor — 実行環境とワークスペースの健全性を確認する */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { flagString } from "../lib/args.mts";
import { loadConfig } from "../lib/config.mts";
import { ValidationError } from "../lib/errors.mts";
import { displayWidth, emit, padDisplay } from "../lib/output.mts";
import { pluginVersion } from "../lib/paths.mts";
import { register } from "../lib/registry.mts";

const run = promisify(execFile);

/** 型剥がしがフラグ無しで有効になる最小バージョン */
const MIN_NODE = [22, 18, 0];

interface Check {
  name: string;
  status: "ok" | "warn" | "error";
  detail: string;
}

function compareVersion(actual: number[], required: number[]): number {
  for (let i = 0; i < required.length; i += 1) {
    const a = actual[i] ?? 0;
    const b = required[i] ?? 0;
    if (a !== b) return a - b;
  }
  return 0;
}

function checkNode(): Check {
  const raw = process.versions.node;
  const parts = raw.split(".").map((n) => Number.parseInt(n, 10));
  if (compareVersion(parts, MIN_NODE) >= 0) {
    return { name: "Node.js", status: "ok", detail: `v${raw} (>= v22.18.0)` };
  }
  return {
    name: "Node.js",
    status: "error",
    detail:
      `v${raw} は要件を満たしません。v22.18.0 以上が必要です。\n` +
      "    v22.6.0〜v22.17.x の場合は --experimental-strip-types を付けて実行できますが、\n" +
      "    Node 本体の更新を推奨します。",
  };
}

async function checkGit(): Promise<Check> {
  try {
    await run("git", ["ls-remote", "--heads", "origin", "HEAD"], { timeout: 15_000 });
    return { name: "git ls-remote", status: "ok", detail: "origin に到達できます" };
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    return {
      name: "git ls-remote",
      status: "warn",
      detail:
        `origin に到達できません: ${message}\n` +
        "    着手中ブランチの検出ができなくなりますが、着手可能・待機の判定には影響しません。",
    };
  }
}

register({
  name: "doctor",
  summary: "Node のバージョン・設定・ワークスペースの健全性を確認する",
  usage: "hikyaku doctor [--root <path>] [--json]",
  details: [
    "確認する項目:",
    "  - Node.js が v22.18.0 以上か（型剥がしがフラグ無しで動くか）",
    "  - .hikyaku.config が解析できるか、廃止キーが残っていないか",
    "  - HIKYAKU_ROOT が解決でき、必須ファイルが揃っているか",
    "  - origin に到達できるか（着手中ブランチの検出に使う）",
    "",
    "問題が見つかった場合は終了コード 2 で終了します。",
  ].join("\n"),
  run: async ({ args }) => {
    const checks: Check[] = [
      { name: "hikyaku", status: "ok", detail: `v${pluginVersion()}` },
      checkNode(),
    ];

    let hikyakuRoot: string | undefined;
    try {
      const config = loadConfig({ root: flagString(args, "root"), allowMissingRoot: true });
      hikyakuRoot = config.hikyakuRoot === "" ? undefined : config.hikyakuRoot;
      checks.push({
        name: "設定",
        status: "ok",
        detail:
          config.sources.length > 0
            ? `${config.sources.join(", ")}（profile: ${config.profile}）`
            : `設定ファイルなし・既定値のみ（profile: ${config.profile}）`,
      });
    } catch (error) {
      checks.push({
        name: "設定",
        status: "error",
        detail: error instanceof Error ? error.message : String(error),
      });
    }

    if (hikyakuRoot === undefined) {
      checks.push({
        name: "HIKYAKU_ROOT",
        status: "warn",
        detail:
          "解決できません。/hikyaku:init で初期化するか、--root で指定してください。",
      });
    } else if (!existsSync(hikyakuRoot)) {
      checks.push({
        name: "HIKYAKU_ROOT",
        status: "error",
        detail: `${hikyakuRoot} が存在しません`,
      });
    } else {
      checks.push({ name: "HIKYAKU_ROOT", status: "ok", detail: hikyakuRoot });
      for (const required of ["document-guide.md", "cycles.md"]) {
        const path = join(hikyakuRoot, required);
        checks.push(
          existsSync(path)
            ? { name: required, status: "ok", detail: "あり" }
            : {
                name: required,
                status: "warn",
                detail: "未作成。/hikyaku:init で生成してください",
              },
        );
      }
    }

    checks.push(await checkGit());

    const failures = checks.filter((c) => c.status === "error");
    const nameWidth = Math.max(...checks.map((c) => displayWidth(c.name)));
    emit({ checks, ok: failures.length === 0 }, () =>
      checks
        .map((c) => `${symbol(c.status)} ${padDisplay(c.name, nameWidth)}  ${c.detail}`)
        .join("\n"),
    );

    if (failures.length > 0) {
      throw new ValidationError(failures.map((c) => `${c.name}: ${c.detail}`));
    }
  },
});

function symbol(status: Check["status"]): string {
  if (status === "ok") return "✓";
  if (status === "warn") return "!";
  return "✗";
}
