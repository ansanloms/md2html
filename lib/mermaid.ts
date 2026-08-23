// mermaid の browser 向け bundle 供給の純粋ロジック。
// 副作用 (ファイル読み書き・一時ディレクトリ作成・deno bundle の実行) は
// MermaidBundleDeps 経由で呼び出し側から注入する。

import { MERMAID_RENDER_JS } from "./assets.ts";

/**
 * mermaid のキャッシュ・bundle 対象に使う固定バージョン。
 *
 * この pin は import map (deno.json の imports) ではなく文字列定数として持つため、
 * dependabot の更新対象外になる。mermaid の更新はこの定数を手動で書き換えて行う。
 */
export const MERMAID_VERSION = "11.16.0";

/** キャッシュディレクトリに置く bundle ファイル名の前後。 */
const BUNDLE_PREFIX = "mermaid-";
const BUNDLE_SUFFIX = ".bundle.js";

/**
 * `deno bundle` に渡す browser 向けエントリ TS のソースを生成する。
 * npm:mermaid と ./mermaid-render.js を import し、mermaid インスタンスの
 * render・テーマ切替・figure.mermaid-fig の構築は initMermaid へ委譲する。
 */
export function mermaidEntrySource(version: string): string {
  return `import mermaid from "npm:mermaid@${version}";
import { initMermaid } from "./mermaid-render.js";

await initMermaid(mermaid);
`;
}

/** FNV-1a (32bit) ハッシュ。依存を増やさずキャッシュキーを作るための自前実装。 */
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * mermaid entry (mermaidEntrySource) + mermaid-render.js + bundle に使う
 * Deno のバージョンから、bundle のキャッシュキーに使う 8 桁 hex を作る。
 * これらが変わったら (このライブラリの更新や Deno の更新で) 古いキャッシュを
 * 再利用してしまわないようにする。
 */
export function bundleRevision(version: string, denoVersion: string): string {
  const content = mermaidEntrySource(version) + MERMAID_RENDER_JS +
    `\ndeno@${denoVersion}\n`;
  return fnv1a32(content).toString(16).padStart(8, "0");
}

/**
 * XDG_CACHE_HOME > HOME/.cache の順で解決し `<cache>/md2html` を返す。
 * どちらも未設定ならキャッシュ位置を決められないため throw する。
 */
export function resolveCacheDir(
  env: (key: string) => string | undefined,
): string {
  const xdgCacheHome = env("XDG_CACHE_HOME");
  if (xdgCacheHome) {
    return `${xdgCacheHome}/md2html`;
  }

  const home = env("HOME");
  if (home) {
    return `${home}/.cache/md2html`;
  }

  throw new Error(
    "キャッシュディレクトリを決定できない (XDG_CACHE_HOME / HOME が未設定)",
  );
}

export interface MermaidBundleDeps {
  env: (key: string) => string | undefined;
  readTextFile: (path: string) => Promise<string>;
  writeTextFile: (path: string, text: string) => Promise<void>;
  mkdir: (path: string) => Promise<void>;
  makeTempDir: () => Promise<string>;
  remove: (path: string, options?: { recursive?: boolean }) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  readDir: (path: string) => AsyncIterable<{ name: string; isFile: boolean }>;
  /** bundle 内容のキャッシュキーに混ぜる Deno のバージョン (Deno.version.deno)。 */
  denoVersion: string;
  /** entryPath を bundle し outPath へ書き出す。失敗時は throw する。 */
  bundle: (entryPath: string, outPath: string) => Promise<void>;
}

/** 失敗しても処理を止めたくない後始末。エラーは握りつぶす。 */
async function removeQuietly(
  deps: MermaidBundleDeps,
  path: string,
  options?: { recursive?: boolean },
): Promise<void> {
  try {
    await deps.remove(path, options);
  } catch {
    // 後始末なので失敗は無視する。
  }
}

/**
 * キャッシュディレクトリに残っている古い bundle を削除する。今回のキャッシュ
 * パス以外の `mermaid-*.bundle.js` すべて (旧 revision に限らず、別バージョンの
 * mermaid の bundle も含む) が対象。1 つの bundle が数 MB あるため、使うのは
 * 常に 1 本という前提で溜め込まない。
 *
 * 書き込み途中の一時ファイル (`*.bundle.js.tmp-*`) は、他プロセスが今まさに
 * 書いている可能性があるため接尾辞で除外する。その代わり bundle 中にプロセスが
 * 死ぬと一時ファイルが残り、この掃除では回収されない (手動削除が必要)。
 */
async function pruneOldBundles(
  deps: MermaidBundleDeps,
  cacheDir: string,
  keepPath: string,
): Promise<void> {
  try {
    for await (const entry of deps.readDir(cacheDir)) {
      if (!entry.isFile) {
        continue;
      }
      if (
        !entry.name.startsWith(BUNDLE_PREFIX) ||
        !entry.name.endsWith(BUNDLE_SUFFIX)
      ) {
        continue;
      }

      const path = `${cacheDir}/${entry.name}`;
      if (path === keepPath) {
        continue;
      }

      await removeQuietly(deps, path);
    }
  } catch {
    // 掃除できなくても bundle の取得自体は成功しているので無視する。
  }
}

/**
 * mermaid の browser 向け bundle を取得する。キャッシュ
 * (`<cacheDir>/mermaid-<version>-<revision>.bundle.js`) が在ればそれを返し、
 * 無ければ一時ディレクトリにエントリ TS と mermaid-render.js を書いて
 * bundle し、キャッシュへ保存してから返す。revision はエントリ・
 * mermaid-render.js・Deno のバージョンから作るため、これらが変わると別
 * キャッシュになる。bundle は一時ファイルへ書いてから rename で差し替える
 * ため、同時実行時に書きかけの bundle を読むことはない。一時ディレクトリと
 * 旧 revision の bundle は後始末で削除する。bundle の失敗はそのまま throw
 * する (握りつぶさない)。
 */
export async function getMermaidBundle(
  deps: MermaidBundleDeps,
  version: string = MERMAID_VERSION,
): Promise<string> {
  const cacheDir = resolveCacheDir(deps.env);
  const revision = bundleRevision(version, deps.denoVersion);
  const cachePath =
    `${cacheDir}/${BUNDLE_PREFIX}${version}-${revision}${BUNDLE_SUFFIX}`;

  try {
    return await deps.readTextFile(cachePath);
  } catch {
    // キャッシュが無ければ bundle する。
  }

  const tempDir = await deps.makeTempDir();
  let bundled: string;
  try {
    const entryPath = `${tempDir}/mermaid-entry.ts`;
    await deps.writeTextFile(entryPath, mermaidEntrySource(version));
    await deps.writeTextFile(`${tempDir}/mermaid-render.js`, MERMAID_RENDER_JS);

    await deps.mkdir(cacheDir);

    // 同時実行しても書きかけの bundle が読まれないよう、一時ファイルへ
    // 書き出してから rename (同一ディレクトリ内なので原子的) で差し替える。
    const tempBundlePath = `${cachePath}.tmp-${crypto.randomUUID()}`;
    try {
      await deps.bundle(entryPath, tempBundlePath);
      // 内容は rename の前に読む。rename 後のキャッシュファイルは、revision の
      // 異なる別プロセスの掃除 (pruneOldBundles) で消えている可能性があるため、
      // 読み直すと NotFound になり得る。
      bundled = await deps.readTextFile(tempBundlePath);
      await deps.rename(tempBundlePath, cachePath);
    } catch (error) {
      await removeQuietly(deps, tempBundlePath);
      throw error;
    }
  } finally {
    await removeQuietly(deps, tempDir, { recursive: true });
  }

  await pruneOldBundles(deps, cacheDir, cachePath);

  return bundled;
}
