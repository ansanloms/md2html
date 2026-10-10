import { expect, test } from "bun:test";
import {
  getMermaidBundle,
  isValidMermaidVersion,
  MERMAID_VERSION,
  type MermaidFetchDeps,
  resolveCacheDir,
} from "./mermaid.ts";

test("resolveCacheDir は XDG_CACHE_HOME を優先する", () => {
  const env = new Map([
    ["XDG_CACHE_HOME", "/xdg"],
    ["HOME", "/home/u"],
  ]);
  expect(resolveCacheDir((k) => env.get(k))).toEqual("/xdg/md2html");
});

test("resolveCacheDir は XDG 未設定なら HOME/.cache", () => {
  const env = new Map([["HOME", "/home/u"]]);
  expect(resolveCacheDir((k) => env.get(k))).toEqual("/home/u/.cache/md2html");
});

test("resolveCacheDir は XDG_CACHE_HOME / HOME がどちらも未設定なら throw する", () => {
  expect(() => resolveCacheDir(() => undefined)).toThrow(
    "キャッシュディレクトリを決定できない",
  );
});

test("resolveCacheDir は空文字の環境変数を未設定として扱う", () => {
  const env = new Map([
    ["XDG_CACHE_HOME", ""],
    ["HOME", "/home/u"],
  ]);
  expect(resolveCacheDir((k) => env.get(k))).toEqual("/home/u/.cache/md2html");
});

interface FakeFs {
  /** ファイルパス -> 内容。 */
  files: Map<string, string>;
  /** 削除されたパス (後始末の検証用)。 */
  removed: string[];
  /** rename の呼び出し (from, to)。 */
  renames: Array<[string, string]>;
  /** fetch の呼び出し URL。 */
  fetchCalls: string[];
  /** fetch に渡された signal。 */
  fetchSignals: Array<AbortSignal | undefined>;
}

const CACHE_PATH = `/home/u/.cache/md2html/mermaid-${MERMAID_VERSION}.min.js`;

/** テスト用の最小 MermaidFetchDeps。キャッシュファイルの有無を files で表現する。 */
function makeDeps(overrides: Partial<MermaidFetchDeps> = {}): {
  deps: MermaidFetchDeps;
  fs: FakeFs;
} {
  const fs: FakeFs = {
    files: new Map(),
    removed: [],
    renames: [],
    fetchCalls: [],
    fetchSignals: [],
  };
  const notFound = () =>
    Object.assign(new Error("not found"), { code: "ENOENT" });

  const deps: MermaidFetchDeps = {
    env: (key) => (key === "HOME" ? "/home/u" : undefined),
    readTextFile: (path) => {
      const text = fs.files.get(path);
      return text === undefined
        ? Promise.reject(notFound())
        : Promise.resolve(text);
    },
    writeTextFile: (path, text) => {
      fs.files.set(path, text);
      return Promise.resolve();
    },
    mkdir: () => Promise.resolve(),
    rename: (from, to) => {
      const text = fs.files.get(from);
      if (text === undefined) {
        return Promise.reject(notFound());
      }
      fs.files.delete(from);
      fs.files.set(to, text);
      fs.renames.push([from, to]);
      return Promise.resolve();
    },
    remove: (path) => {
      fs.files.delete(path);
      fs.removed.push(path);
      return Promise.resolve();
    },
    fetch: (url, init) => {
      fs.fetchCalls.push(url);
      fs.fetchSignals.push(init?.signal);
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve("/* fetched mermaid */"),
      });
    },
    ...overrides,
  };
  return { deps, fs };
}

test("getMermaidBundle: キャッシュがあれば fetch せずそれを返す", async () => {
  const { deps, fs } = makeDeps();
  fs.files.set(CACHE_PATH, "/* cached */");

  const result = await getMermaidBundle(deps, MERMAID_VERSION);

  expect(result).toEqual("/* cached */");
  expect(fs.fetchCalls.length).toEqual(0);
});

test("getMermaidBundle: version 省略時は MERMAID_VERSION を使う", async () => {
  const { deps, fs } = makeDeps();

  await getMermaidBundle(deps);

  expect(fs.fetchCalls).toEqual([
    `https://cdn.jsdelivr.net/npm/mermaid@${MERMAID_VERSION}/dist/mermaid.min.js`,
  ]);
  expect(fs.files.has(CACHE_PATH)).toEqual(true);
});

test("getMermaidBundle: fetch にタイムアウト用の signal を渡す", async () => {
  const { deps, fs } = makeDeps();

  await getMermaidBundle(deps);

  expect(fs.fetchSignals.length).toEqual(1);
  expect(fs.fetchSignals[0]).toBeInstanceOf(AbortSignal);
});

test("getMermaidBundle: version を指定するとその版の URL とキャッシュパスを使う", async () => {
  const { deps, fs } = makeDeps();

  await getMermaidBundle(deps, "11.0.0");

  expect(fs.fetchCalls).toEqual([
    "https://cdn.jsdelivr.net/npm/mermaid@11.0.0/dist/mermaid.min.js",
  ]);
  expect(fs.files.has("/home/u/.cache/md2html/mermaid-11.0.0.min.js")).toEqual(
    true,
  );
});

test("getMermaidBundle: キャッシュが無ければ fetch して tmp に書き rename で保存し本文を返す", async () => {
  const { deps, fs } = makeDeps();

  const result = await getMermaidBundle(deps, MERMAID_VERSION);

  expect(result).toEqual("/* fetched mermaid */");
  expect(fs.files.get(CACHE_PATH)).toEqual("/* fetched mermaid */");
  expect(fs.renames.length).toEqual(1);
  const [from, to] = fs.renames[0];
  expect(from.startsWith(`${CACHE_PATH}.tmp-`)).toEqual(true);
  expect(to).toEqual(CACHE_PATH);
  expect(fs.files.size).toEqual(1);
});

test("getMermaidBundle: 非 2xx は throw しキャッシュを作らない", async () => {
  const { deps, fs } = makeDeps({
    fetch: () =>
      Promise.resolve({
        ok: false,
        status: 404,
        text: () => Promise.resolve("not found"),
      }),
  });

  await expect(getMermaidBundle(deps, MERMAID_VERSION)).rejects.toThrow(
    `mermaid@${MERMAID_VERSION} を取得できない (HTTP 404)`,
  );
  expect(fs.files.size).toEqual(0);
});

test("getMermaidBundle: rename に失敗したら tmp を消して throw する", async () => {
  const { deps, fs } = makeDeps({
    rename: () => Promise.reject(new Error("rename 失敗")),
  });

  await expect(getMermaidBundle(deps, MERMAID_VERSION)).rejects.toThrow(
    "rename 失敗",
  );
  expect(fs.removed.length).toEqual(1);
  expect(fs.removed[0].startsWith(`${CACHE_PATH}.tmp-`)).toEqual(true);
  expect(fs.files.size).toEqual(0);
});

test("getMermaidBundle: rename 後にキャッシュが消えても取得した本文を返す", async () => {
  // 別プロセスがキャッシュを消した状況。rename 後に読み直さないので落ちない。
  const { deps } = makeDeps();
  const readTextFile = deps.readTextFile;
  let renamed = false;
  const rename = deps.rename;
  deps.rename = async (from, to) => {
    await rename(from, to);
    renamed = true;
  };
  deps.readTextFile = (path) => {
    if (renamed) {
      return Promise.reject(Object.assign(new Error(), { code: "ENOENT" }));
    }
    return readTextFile(path);
  };

  const result = await getMermaidBundle(deps, MERMAID_VERSION);

  expect(result).toEqual("/* fetched mermaid */");
});

test("getMermaidBundle: キャッシュディレクトリを決められなければ throw する", async () => {
  const { deps } = makeDeps({ env: () => undefined });

  await expect(getMermaidBundle(deps, MERMAID_VERSION)).rejects.toThrow(
    "キャッシュディレクトリを決定できない",
  );
});

test("isValidMermaidVersion は完全一致の版・プレリリース・dist-tag を許しレンジ・空文字・パス文字を弾く", () => {
  for (const version of ["11.16.0", "11.0.0-alpha.1", "latest", "11"]) {
    expect(isValidMermaidVersion(version)).toEqual(true);
  }
  for (const version of [
    "",
    "^11",
    "~11.1",
    ">=11",
    "11 12",
    "../x",
    '11"',
    ".11",
  ]) {
    expect(isValidMermaidVersion(version)).toEqual(false);
  }
});

test("getMermaidBundle: 不正な形式の version はキャッシュ解決も fetch もせず throw する", async () => {
  const { deps, fs } = makeDeps();

  await expect(getMermaidBundle(deps, "../x")).rejects.toThrow('"../x"');
  expect(fs.fetchCalls.length).toEqual(0);
  expect(fs.files.size).toEqual(0);

  await expect(getMermaidBundle(deps, "11 || 12")).rejects.toThrow(
    '"11 || 12"',
  );
  expect(fs.fetchCalls.length).toEqual(0);
  expect(fs.files.size).toEqual(0);
});
