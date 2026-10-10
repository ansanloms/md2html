// mermaid の browser 向け bundle 供給の純粋ロジック。
// jsdelivr の mermaid.min.js (IIFE、単一ファイル) を取得してキャッシュする。
// 副作用 (ファイル読み書き・ネットワーク取得) は MermaidFetchDeps 経由で
// 呼び出し側から注入する。

/**
 * mermaid のキャッシュ・取得対象に使う固定バージョン。
 *
 * この pin は package.json の dependencies ではなく文字列定数として持つため、
 * dependabot の更新対象外になる。mermaid の更新はこの定数を手動で書き換えて行う。
 */
export const MERMAID_VERSION = "11.16.0";

/**
 * frontmatter / CLI から受け取る mermaid バージョン指定子に許す文字種。
 * 指定子はキャッシュのファイル名と取得 URL の `mermaid@<version>` に
 * そのまま埋め込むため、`../` や `/` を含む値を通すとパス逸脱・URL 改変になる。
 * 完全一致の版 (11.16.0)・プレリリース (11.0.0-alpha.1)・dist-tag (latest) は通し、
 * レンジ (^11 / ~11.1 / >=11) や空白は弾く。レンジや dist-tag はキャッシュキーが
 * その文字列のまま固定され更新されない点に注意 (README 参照)。
 */
export const MERMAID_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]*$/;

/** version が MERMAID_VERSION_PATTERN を満たすか。 */
export function isValidMermaidVersion(version: string): boolean {
  return MERMAID_VERSION_PATTERN.test(version);
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

export interface MermaidFetchDeps {
  env: (key: string) => string | undefined;
  readTextFile: (path: string) => Promise<string>;
  writeTextFile: (path: string, text: string) => Promise<void>;
  /** 再帰的にディレクトリを作る (既存でも失敗しない)。 */
  mkdir: (path: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  remove: (path: string) => Promise<void>;
  fetch: (
    url: string,
    init?: { signal?: AbortSignal },
  ) => Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
  }>;
}

/** mermaid 取得 (fetch) のタイムアウト (ミリ秒)。 */
const MERMAID_FETCH_TIMEOUT_MS = 30_000;

/** 失敗しても処理を止めたくない後始末。エラーは握りつぶす。 */
async function removeQuietly(
  deps: MermaidFetchDeps,
  path: string,
): Promise<void> {
  try {
    await deps.remove(path);
  } catch {
    // 後始末なので失敗は無視する。
  }
}

/**
 * mermaid の browser 向け bundle (jsdelivr の mermaid.min.js) を取得する。
 * キャッシュ (`<cacheDir>/mermaid-<version>.min.js`) が在ればそれを返し、
 * 無ければ fetch して一時ファイルへ書いてから rename (同一ディレクトリ内なので
 * 原子的) でキャッシュへ差し替え、取得した本文を返す。同時実行しても書きかけの
 * ファイルは読まれない。rename 後にキャッシュを読み直さず、取得済みの本文を返す。
 * 取得の失敗 (非 2xx・タイムアウトを含む) はそのまま throw する (握りつぶさない)。
 */
export async function getMermaidBundle(
  deps: MermaidFetchDeps,
  version: string = MERMAID_VERSION,
): Promise<string> {
  if (!isValidMermaidVersion(version)) {
    throw new Error(
      `mermaid のバージョン指定 "${version}" は使えない (先頭は英数字、以降は英数字・"."・"-"・"+" のみ)`,
    );
  }

  const cacheDir = resolveCacheDir(deps.env);
  const cachePath = `${cacheDir}/mermaid-${version}.min.js`;

  try {
    return await deps.readTextFile(cachePath);
  } catch {
    // キャッシュが無ければ取得する。
  }

  const response = await deps.fetch(
    `https://cdn.jsdelivr.net/npm/mermaid@${version}/dist/mermaid.min.js`,
    { signal: AbortSignal.timeout(MERMAID_FETCH_TIMEOUT_MS) },
  );
  if (!response.ok) {
    throw new Error(
      `mermaid@${version} を取得できない (HTTP ${response.status})`,
    );
  }
  const text = await response.text();

  await deps.mkdir(cacheDir);
  const tempPath = `${cachePath}.tmp-${crypto.randomUUID()}`;
  try {
    await deps.writeTextFile(tempPath, text);
    await deps.rename(tempPath, cachePath);
  } catch (error) {
    await removeQuietly(deps, tempPath);
    throw error;
  }

  return text;
}
