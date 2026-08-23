import {
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import {
  bundleRevision,
  getMermaidBundle,
  MERMAID_VERSION,
  type MermaidBundleDeps,
  mermaidEntrySource,
  resolveCacheDir,
} from "./mermaid.ts";

/** テストで使う Deno バージョン。実行環境に依存させないため固定値にする。 */
const DENO_VERSION = "2.0.0";

Deno.test("mermaidEntrySource は pin 済みの npm:mermaid 指定子を含む", () => {
  const source = mermaidEntrySource(MERMAID_VERSION);
  assertStringIncludes(
    source,
    `import mermaid from "npm:mermaid@${MERMAID_VERSION}";`,
  );
});

Deno.test("mermaidEntrySource は ./mermaid-render.js の initMermaid を呼ぶ", () => {
  const source = mermaidEntrySource(MERMAID_VERSION);
  assertStringIncludes(
    source,
    'import { initMermaid } from "./mermaid-render.js";',
  );
  assertStringIncludes(source, "await initMermaid(mermaid);");
});

Deno.test("bundleRevision は 8 桁 hex を返す", () => {
  const revision = bundleRevision(MERMAID_VERSION, DENO_VERSION);
  assertEquals(/^[0-9a-f]{8}$/.test(revision), true);
});

Deno.test("bundleRevision は同じ入力なら同じ値を返す", () => {
  assertEquals(
    bundleRevision(MERMAID_VERSION, DENO_VERSION),
    bundleRevision(MERMAID_VERSION, DENO_VERSION),
  );
});

Deno.test("bundleRevision は mermaid のバージョンが変われば変わる", () => {
  assertNotEquals(
    bundleRevision(MERMAID_VERSION, DENO_VERSION),
    bundleRevision("0.0.0-test", DENO_VERSION),
  );
});

Deno.test("bundleRevision は Deno のバージョンが変われば変わる", () => {
  assertNotEquals(
    bundleRevision(MERMAID_VERSION, DENO_VERSION),
    bundleRevision(MERMAID_VERSION, "9.9.9"),
  );
});

Deno.test("resolveCacheDir は XDG_CACHE_HOME を優先する", () => {
  const env = new Map([["XDG_CACHE_HOME", "/xdg"], ["HOME", "/home/u"]]);
  assertEquals(resolveCacheDir((k) => env.get(k)), "/xdg/md2html");
});

Deno.test("resolveCacheDir は XDG 未設定なら HOME/.cache", () => {
  const env = new Map([["HOME", "/home/u"]]);
  assertEquals(resolveCacheDir((k) => env.get(k)), "/home/u/.cache/md2html");
});

Deno.test("resolveCacheDir は XDG_CACHE_HOME / HOME がどちらも未設定なら throw する", () => {
  assertThrows(
    () => resolveCacheDir(() => undefined),
    Error,
    "キャッシュディレクトリを決定できない",
  );
});

Deno.test("resolveCacheDir は空文字の環境変数を未設定として扱う", () => {
  const env = new Map([["XDG_CACHE_HOME", ""], ["HOME", "/home/u"]]);
  assertEquals(resolveCacheDir((k) => env.get(k)), "/home/u/.cache/md2html");
});

interface FakeFs {
  /** ファイルパス -> 内容。 */
  files: Map<string, string>;
  /** 削除されたパス (後始末の検証用)。 */
  removed: string[];
  /** bundle の呼び出し (entryPath, outPath)。 */
  bundleCalls: Array<[string, string]>;
}

/** テスト用の最小 MermaidBundleDeps。キャッシュファイルの有無を files で表現する。 */
function makeDeps(
  overrides: Partial<MermaidBundleDeps> = {},
): {
  deps: MermaidBundleDeps;
  fs: FakeFs;
  bundleCalls: Array<[string, string]>;
} {
  const files = new Map<string, string>();
  const removed: string[] = [];
  const bundleCalls: Array<[string, string]> = [];

  const deps: MermaidBundleDeps = {
    env: (key) => key === "HOME" ? "/home/u" : undefined,
    readTextFile: (path) => {
      const text = files.get(path);
      if (text === undefined) {
        return Promise.reject(new Deno.errors.NotFound(path));
      }
      return Promise.resolve(text);
    },
    writeTextFile: (path, text) => {
      files.set(path, text);
      return Promise.resolve();
    },
    mkdir: () => Promise.resolve(),
    makeTempDir: () => Promise.resolve("/tmp/md2html-test"),
    remove: (path, options) => {
      removed.push(path);
      if (options?.recursive) {
        for (const key of [...files.keys()]) {
          if (key === path || key.startsWith(`${path}/`)) {
            files.delete(key);
          }
        }
        return Promise.resolve();
      }
      if (!files.delete(path)) {
        return Promise.reject(new Deno.errors.NotFound(path));
      }
      return Promise.resolve();
    },
    rename: (from, to) => {
      const text = files.get(from);
      if (text === undefined) {
        return Promise.reject(new Deno.errors.NotFound(from));
      }
      files.delete(from);
      files.set(to, text);
      return Promise.resolve();
    },
    readDir: (path) => {
      const prefix = `${path}/`;
      const names = [...files.keys()]
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length))
        .filter((name) => !name.includes("/"));
      return (async function* () {
        for (const name of names) {
          yield { name, isFile: true };
        }
      })();
    },
    denoVersion: DENO_VERSION,
    bundle: (entryPath, outPath) => {
      bundleCalls.push([entryPath, outPath]);
      files.set(outPath, "/* bundled mermaid */");
      return Promise.resolve();
    },
    ...overrides,
  };

  return { deps, fs: { files, removed, bundleCalls }, bundleCalls };
}

Deno.test("getMermaidBundle: キャッシュがあれば bundle を呼ばずそれを返す", async () => {
  const { deps, bundleCalls } = makeDeps();
  const revision = bundleRevision(MERMAID_VERSION, DENO_VERSION);
  await deps.writeTextFile(
    `/home/u/.cache/md2html/mermaid-${MERMAID_VERSION}-${revision}.bundle.js`,
    "/* cached */",
  );

  const result = await getMermaidBundle(deps, MERMAID_VERSION);

  assertEquals(result, "/* cached */");
  assertEquals(bundleCalls.length, 0);
});

Deno.test("getMermaidBundle: version 省略時は MERMAID_VERSION のキャッシュを使う", async () => {
  const { deps, bundleCalls } = makeDeps();
  const revision = bundleRevision(MERMAID_VERSION, DENO_VERSION);
  await deps.writeTextFile(
    `/home/u/.cache/md2html/mermaid-${MERMAID_VERSION}-${revision}.bundle.js`,
    "/* cached default */",
  );

  const result = await getMermaidBundle(deps);

  assertEquals(result, "/* cached default */");
  assertEquals(bundleCalls.length, 0);
});

Deno.test("getMermaidBundle: version 省略時も bundle 先は MERMAID_VERSION のパス", async () => {
  const { deps, bundleCalls } = makeDeps();
  const revision = bundleRevision(MERMAID_VERSION, DENO_VERSION);

  const result = await getMermaidBundle(deps);

  assertEquals(result, "/* bundled mermaid */");
  assertEquals(bundleCalls.length, 1);
  assertStringIncludes(
    bundleCalls[0][1],
    `/home/u/.cache/md2html/mermaid-${MERMAID_VERSION}-${revision}.bundle.js`,
  );
});

Deno.test("getMermaidBundle: キャッシュが無ければ bundle して保存する", async () => {
  const { deps, fs, bundleCalls } = makeDeps();
  const revision = bundleRevision(MERMAID_VERSION, DENO_VERSION);
  const cachePath =
    `/home/u/.cache/md2html/mermaid-${MERMAID_VERSION}-${revision}.bundle.js`;

  const result = await getMermaidBundle(deps, MERMAID_VERSION);

  assertEquals(result, "/* bundled mermaid */");
  assertEquals(bundleCalls.length, 1);
  const [entryPath, outPath] = bundleCalls[0];
  // bundle は一時ファイルへ書き、rename でキャッシュパスへ差し替える。
  assertStringIncludes(outPath, `${cachePath}.tmp-`);
  assertNotEquals(outPath, cachePath);
  assertStringIncludes(entryPath, "/tmp/md2html-test");
  assertEquals(fs.files.get(cachePath), "/* bundled mermaid */");
  // 一時ファイルは rename で消えている。
  assertEquals(fs.files.has(outPath), false);
});

Deno.test("getMermaidBundle: 一時ディレクトリへ mermaid-render.js を書き出す (zoom.js は書かない)", async () => {
  const { deps } = makeDeps();
  const written: Record<string, string> = {};
  const writeTextFile = deps.writeTextFile;
  deps.writeTextFile = (path, text) => {
    written[path] = text;
    return writeTextFile(path, text);
  };

  await getMermaidBundle(deps, MERMAID_VERSION);

  assertStringIncludes(
    written["/tmp/md2html-test/mermaid-render.js"] ?? "",
    "initMermaid",
  );
  assertEquals("/tmp/md2html-test/zoom.js" in written, false);
});

Deno.test("getMermaidBundle: 一時ディレクトリを後始末で削除する", async () => {
  const { deps, fs } = makeDeps();

  await getMermaidBundle(deps, MERMAID_VERSION);

  assertEquals(fs.removed.includes("/tmp/md2html-test"), true);
  assertEquals(fs.files.has("/tmp/md2html-test/mermaid-entry.ts"), false);
});

Deno.test("getMermaidBundle: bundle の失敗は throw で伝播し一時ディレクトリも消す", async () => {
  const { deps, fs } = makeDeps({
    bundle: () => Promise.reject(new Error("deno bundle 失敗")),
  });

  await assertRejects(
    () => getMermaidBundle(deps, MERMAID_VERSION),
    Error,
    "deno bundle 失敗",
  );

  assertEquals(fs.removed.includes("/tmp/md2html-test"), true);
});

Deno.test("getMermaidBundle: 旧 revision の bundle を削除する", async () => {
  const { deps, fs } = makeDeps();
  const revision = bundleRevision(MERMAID_VERSION, DENO_VERSION);
  const cachePath =
    `/home/u/.cache/md2html/mermaid-${MERMAID_VERSION}-${revision}.bundle.js`;
  const stalePaths = [
    "/home/u/.cache/md2html/mermaid-11.0.0-deadbeef.bundle.js",
    // 旧命名 (revision 無し) も対象。
    "/home/u/.cache/md2html/mermaid-11.0.0.bundle.js",
  ];
  for (const path of stalePaths) {
    await deps.writeTextFile(path, "/* stale */");
  }
  await deps.writeTextFile("/home/u/.cache/md2html/keep.txt", "/* keep */");

  await getMermaidBundle(deps, MERMAID_VERSION);

  for (const path of stalePaths) {
    assertEquals(fs.files.has(path), false);
  }
  assertEquals(fs.files.get(cachePath), "/* bundled mermaid */");
  assertEquals(fs.files.has("/home/u/.cache/md2html/keep.txt"), true);
});

Deno.test("getMermaidBundle: 他プロセスの書きかけ一時ファイルは削除しない", async () => {
  const { deps, fs } = makeDeps();
  const other =
    "/home/u/.cache/md2html/mermaid-11.99.0-cafebabe.bundle.js.tmp-other";
  await deps.writeTextFile(other, "/* writing */");

  await getMermaidBundle(deps, MERMAID_VERSION);

  assertEquals(fs.files.has(other), true);
});

Deno.test("getMermaidBundle: 旧 bundle の削除に失敗しても結果を返す", async () => {
  const { deps } = makeDeps({
    remove: (path) => {
      if (path.endsWith(".bundle.js")) {
        return Promise.reject(new Error("削除できない"));
      }
      return Promise.resolve();
    },
  });
  await deps.writeTextFile(
    "/home/u/.cache/md2html/mermaid-11.0.0-deadbeef.bundle.js",
    "/* stale */",
  );

  const result = await getMermaidBundle(deps, MERMAID_VERSION);

  assertEquals(result, "/* bundled mermaid */");
});

Deno.test("getMermaidBundle: rename 後にキャッシュが消えても bundle 内容を返す", async () => {
  // revision の異なる別プロセスが pruneOldBundles でキャッシュを消した状況。
  // rename 前に読んだ内容を返すので、読み直しの NotFound で落ちない。
  const { deps } = makeDeps();
  const readTextFile = deps.readTextFile;
  deps.readTextFile = (path) => {
    if (path.includes(".bundle.js.tmp-")) {
      return readTextFile(path);
    }
    return Promise.reject(new Deno.errors.NotFound(path));
  };

  const result = await getMermaidBundle(deps, MERMAID_VERSION);

  assertEquals(result, "/* bundled mermaid */");
});

Deno.test("getMermaidBundle: キャッシュディレクトリを決められなければ throw する", async () => {
  const { deps } = makeDeps({ env: () => undefined });

  await assertRejects(
    () => getMermaidBundle(deps, MERMAID_VERSION),
    Error,
    "キャッシュディレクトリを決定できない",
  );
});
