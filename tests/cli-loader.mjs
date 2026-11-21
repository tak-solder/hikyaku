// テストから起動する CLI の子プロセスに --import で読み込ませるローダー。
//
// CLI は起動のたびに scripts/ の .mts を Node の型剥がしにかけ、起動時間の半分ほどをそれに使う。
// 結合テストは CLI を千回以上起動するので、helpers.mts が剥がした結果を先に一時ディレクトリへ書き、
// ここでは中身のハッシュが一致するものだけを差し替える。見つからなければ Node の既定の読み込みに任せる。
// 剥がし方は Node の型剥がしと同じ（node:module の stripTypeScriptTypes）なので、行と列も変わらない。
//
// このファイル自身が型剥がしを起こさないよう、.mts ではなく .mjs で書く。

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { enableCompileCache, registerHooks } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = process.env["HIKYAKU_TEST_STRIPPED"];

if (directory !== undefined && directory !== "") {
  enableCompileCache(join(directory, "v8"));
  registerHooks({
    load(url, context, nextLoad) {
      if (!url.startsWith("file:") || !url.endsWith(".mts")) return nextLoad(url, context);
      const source = readFileSync(fileURLToPath(url), "utf8");
      let stripped;
      try {
        stripped = readFileSync(join(directory, `${createHash("sha1").update(source).digest("hex")}.mjs`), "utf8");
      } catch {
        return nextLoad(url, context);
      }
      return { format: "module", source: stripped, shortCircuit: true };
    },
  });
}
