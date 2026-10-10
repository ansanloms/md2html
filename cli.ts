// markdown ファイルを自己完結 HTML (シンタックスハイライト + mermaid 内蔵) へ変換する CLI。
//
// 使い方は USAGE 定数を参照 (--help でも表示する)。
//
// 入力 markdown 先頭の YAML frontmatter (lib/frontmatter.ts) を解釈し、title・
// description・lang を出力 HTML のメタ情報へ、md2html.zoomTargets をモーダル拡大表示の
// 対象へ反映する (未指定なら既定で画像が対象)。frontmatter ブロックは本文から除く。
// md2html 名前空間の指定が不正なら警告を stderr へ出したうえで無視する。
//
// mermaid は jsdelivr の mermaid.min.js (IIFE) を初回のみ取得し、
// ~/.cache/md2html/ (または $XDG_CACHE_HOME/md2html/) へキャッシュする。
// 以降はキャッシュを読むだけでネットワークを必要としない。
//
// ローカル画像は入力ファイルのディレクトリを基準に解決し (lib/image.ts)、見つからなければ
// cwd 基準へフォールバックする。
//
// 変換ロジックは lib/convert.ts の convert() に分離し、副作用 (ファイル読み書き・
// mermaid 取得・キャッシュ) はここで組み立てて注入する。
//
// ライブラリとして import する場合は mod.ts を使う。

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { parseArgs } from "node:util";
import { convert } from "./lib/convert.ts";
import { type Frontmatter, parseFrontmatter } from "./lib/frontmatter.ts";
import { createImageResolver } from "./lib/image.ts";
import {
  getMermaidBundle,
  isValidMermaidVersion,
  MERMAID_VERSION,
  type MermaidFetchDeps,
} from "./lib/mermaid.ts";
import pkg from "./package.json";

/**
 * --help および引数エラー時に出す使い方。
 * ファイル冒頭コメント・README・エラー出力で文面を分散させないため、ここに一本化する。
 */
const USAGE = `使い方: md2html [<input.md>] [--output <path>] [--css <path>] [--title <title>] [--lang <lang>] [--mermaid-version <version>]
  <input.md>  入力 markdown ファイル。省略するか "-" を指定すると stdin から読む。
  --output    出力先パス。省略時は stdout。
  --css       追記するユーザ CSS ファイルのパス。
  --title     HTML の <title>。省略時は frontmatter の title、それも無ければ
              入力ファイル名 (stdin から読む場合は "md2html")。
  --lang      HTML の <html lang>。省略時は frontmatter の lang、それも無ければ "ja"。
  --mermaid-version
              mermaid の npm バージョン。省略時は frontmatter の md2html.mermaid.version、
              それも無ければ ${MERMAID_VERSION}。
  --help      この使い方を表示する。
  --version   バージョンを表示する。`;

const mermaidFetchDeps: MermaidFetchDeps = {
  env: (key) => process.env[key],
  readTextFile: (path) => readFile(path, "utf8"),
  writeTextFile: (path, text) => writeFile(path, text),
  mkdir: async (path) => {
    await mkdir(path, { recursive: true });
  },
  rename: (from, to) => rename(from, to),
  remove: (path) => rm(path, { recursive: true, force: true }),
  fetch: (url, init) => globalThis.fetch(url, init),
};

/** CLI の副作用をまとめた依存。テストでは差し替える。 */
export interface CliDeps {
  /** stdin が端末 (パイプでもリダイレクトでもない) かどうか。 */
  stdinIsTerminal: () => boolean;
  /** stdin を最後まで読んで文字列で返す。 */
  readStdin: () => Promise<string>;
  readTextFile: (path: string) => Promise<string>;
  readFile: (path: string) => Promise<Uint8Array>;
  writeTextFile: (path: string, text: string) => Promise<void>;
  /** 指定した npm バージョンの mermaid.min.js (globalThis.mermaid を定義する classic script) の本文を返す。 */
  getMermaidJs: (version: string) => Promise<string>;
  /** stdout へ 1 行書く (console.log 相当)。 */
  log: (text: string) => void;
  /** stderr へ 1 行書く (console.error 相当)。 */
  error: (text: string) => void;
}

/** Bun / Node API をそのまま使う CliDeps の実装。 */
export const bunDeps: CliDeps = {
  stdinIsTerminal: () => Boolean(process.stdin.isTTY),
  readStdin: () => Bun.stdin.text(),
  readTextFile: (path) => readFile(path, "utf8"),
  readFile: (path) => readFile(path),
  writeTextFile: (path, text) => writeFile(path, text),
  getMermaidJs: (version) => getMermaidBundle(mermaidFetchDeps, version),
  log: (text) => {
    process.stdout.write(text + "\n");
  },
  error: (text) => {
    process.stderr.write(text + "\n");
  },
};

/** エラーメッセージ本文を取り出す。 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** エラーと使い方を stderr へ出す。 */
function usageError(deps: CliDeps, message: string): number {
  deps.error(`md2html: ${message}`);
  deps.error(USAGE);
  return 1;
}

/** parseArgs へ渡すオプション定義。値付き・真偽値の一覧はここから導出する。 */
const PARSE_OPTIONS = {
  output: { type: "string" },
  css: { type: "string" },
  title: { type: "string" },
  lang: { type: "string" },
  "mermaid-version": { type: "string" },
  help: { type: "boolean" },
  version: { type: "boolean" },
} as const;

type OptionName = keyof typeof PARSE_OPTIONS;

const optionNames = Object.keys(PARSE_OPTIONS) as OptionName[];
/** CLI が受け付ける値付きオプション。 */
const STRING_OPTIONS: string[] = optionNames.filter(
  (name) => PARSE_OPTIONS[name].type === "string",
);
/** CLI が受け付ける真偽値オプション。 */
const BOOLEAN_OPTIONS: string[] = optionNames.filter(
  (name) => PARSE_OPTIONS[name].type === "boolean",
);

/**
 * parseArgs (strict) へ渡す前に引数を走査し、不明なオプションを拾う。
 * parseArgs は不明なオプションを 1 つずつ throw するため、`-xy` のような短縮フラグの塊を
 * 塊のまま 1 回報告できるよう、ここで先に判定する。`--` 以降と "-" 単独は対象外。
 * 値付きオプションの直後に値が無い場合は空文字列を補い、parseArgs が throw せず
 * 後段の空値判定 (--output / --css はエラー、他は未指定扱い) に乗るようにする。
 */
function scanArgs(args: string[]): {
  unknownOptions: string[];
  help: boolean;
  version: boolean;
  args: string[];
} {
  const unknownOptions = new Set<string>();
  const normalized: string[] = [];
  let help = false;
  let version = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") {
      normalized.push(...args.slice(i));
      break;
    }
    normalized.push(arg);
    if (!arg.startsWith("-") || arg === "-") {
      continue;
    }

    const eq = arg.indexOf("=");
    const name = arg.startsWith("--")
      ? arg.slice(2, eq === -1 ? undefined : eq)
      : undefined;
    if (name !== undefined && STRING_OPTIONS.includes(name)) {
      if (eq === -1) {
        const next = args[i + 1];
        if (next === undefined || (next.startsWith("-") && next !== "-")) {
          normalized.push("");
        } else {
          normalized.push(next);
          i++;
        }
      }
    } else if (
      name !== undefined &&
      eq === -1 &&
      BOOLEAN_OPTIONS.includes(name)
    ) {
      help ||= name === "help";
      version ||= name === "version";
    } else {
      unknownOptions.add(arg);
    }
  }

  return {
    unknownOptions: [...unknownOptions],
    help,
    version,
    args: normalized,
  };
}

export async function main(
  args: string[],
  deps: CliDeps = bunDeps,
): Promise<number> {
  const scanned = scanArgs(args);

  if (scanned.help) {
    deps.log(USAGE);
    return 0;
  }

  if (scanned.version) {
    deps.log(pkg.version);
    return 0;
  }

  if (scanned.unknownOptions.length > 0) {
    return usageError(
      deps,
      `不明なオプション: ${scanned.unknownOptions.join(", ")}`,
    );
  }

  let parsed: ReturnType<
    typeof parseArgs<{
      args: string[];
      options: typeof PARSE_OPTIONS;
      strict: true;
      allowPositionals: true;
    }>
  >;
  try {
    parsed = parseArgs({
      args: scanned.args,
      options: PARSE_OPTIONS,
      strict: true,
      allowPositionals: true,
    });
  } catch (error) {
    return usageError(deps, messageOf(error));
  }
  const values = parsed.values;

  // 値を伴わない --output / --css は空文字列になる (scanArgs が補う)。
  // 空文字列のパスは書き込み・読み込みのどちらでも意味を持たないためエラーにする。
  if (values.output === "") {
    return usageError(deps, "--output にパスを指定してください");
  }
  if (values.css === "") {
    return usageError(deps, "--css にパスを指定してください");
  }

  // 空文字列の位置引数 (シェル変数が空だった等) は弾く。
  const positional = parsed.positionals;
  if (positional.includes("")) {
    return usageError(deps, "入力ファイルのパスが空です");
  }
  if (positional.length > 1) {
    return usageError(deps, "入力ファイルは 1 つだけ指定してください");
  }

  // 位置引数が無く stdin が端末 (パイプでもリダイレクトでもない) なら、
  // 無言でブロックせず使い方を出す。
  if (positional.length === 0 && deps.stdinIsTerminal()) {
    return usageError(deps, "入力ファイルを指定してください");
  }

  const inputPath = positional.length === 1 ? positional[0] : "-";
  const fromStdin = inputPath === "-";

  let markdown: string;
  try {
    markdown = fromStdin
      ? await deps.readStdin()
      : await deps.readTextFile(inputPath);
  } catch (error) {
    deps.error(
      `md2html: ${fromStdin ? "stdin" : "入力ファイル"}を読み込めない: ${messageOf(
        error,
      )}`,
    );
    return 1;
  }

  let css: string | undefined;
  if (values.css !== undefined) {
    try {
      css = await deps.readTextFile(values.css);
    } catch (error) {
      deps.error(`md2html: CSS ファイルを読み込めない: ${messageOf(error)}`);
      return 1;
    }
  }

  let frontmatter: Frontmatter;
  let body: string;
  let warnings: string[];
  try {
    ({ frontmatter, body, warnings } = parseFrontmatter(markdown));
  } catch (error) {
    deps.error(`md2html: ${messageOf(error)}`);
    return 1;
  }

  for (const warning of warnings) {
    deps.error(`md2html: ${warning}`);
  }

  // frontmatter の title は空文字列を未指定扱いにしている (lib/frontmatter.ts)。
  // --title "" もそれに揃え、<title></title> にならないようにする。
  const cliTitle =
    values.title === undefined || values.title === ""
      ? undefined
      : values.title;
  const title =
    cliTitle ??
    frontmatter.title ??
    (fromStdin ? "md2html" : basename(inputPath));
  // 空の --lang も同様に未指定として扱う。
  const lang = (values.lang || undefined) ?? frontmatter.lang;

  // mermaid のバージョンも CLI > frontmatter > 既定。空の --mermaid-version は未指定扱い。
  const cliMermaidVersion = values["mermaid-version"] || undefined;
  const frontmatterMermaidVersion = frontmatter.md2html?.mermaid?.version;
  const mermaidVersion =
    cliMermaidVersion ?? frontmatterMermaidVersion ?? MERMAID_VERSION;
  const mermaidVersionSource =
    cliMermaidVersion !== undefined
      ? "--mermaid-version"
      : frontmatterMermaidVersion !== undefined
        ? "frontmatter の md2html.mermaid.version"
        : "既定";
  // 指定子はキャッシュのファイル名と bundle エントリに埋め込むため、mermaid ブロックの有無に
  // 関わらずここで形式を検査し、指定元を添えて弾く。
  if (!isValidMermaidVersion(mermaidVersion)) {
    deps.error(
      `md2html: mermaid のバージョン指定 "${mermaidVersion}" (${mermaidVersionSource}) の形式が不正です (先頭は英数字、以降は英数字・"."・"-"・"+" のみ)`,
    );
    return 1;
  }

  let html: string;
  try {
    html = await convert(body, {
      title,
      frontmatter,
      lang,
      css,
      getMermaidJs: async () => {
        try {
          return await deps.getMermaidJs(mermaidVersion);
        } catch (error) {
          throw new Error(
            `mermaid ${mermaidVersion} (${mermaidVersionSource}) の取得に失敗した: ${messageOf(
              error,
            )}`,
          );
        }
      },
      resolveImage: createImageResolver({
        readFile: deps.readFile,
        baseDir: dirname(inputPath),
      }),
    });
  } catch (error) {
    deps.error(`md2html: 変換に失敗した: ${messageOf(error)}`);
    return 1;
  }

  if (values.output !== undefined) {
    try {
      await deps.writeTextFile(values.output, html);
    } catch (error) {
      deps.error(`md2html: 出力ファイルを書き込めない: ${messageOf(error)}`);
      return 1;
    }
  } else {
    deps.log(html);
  }

  return 0;
}

if (import.meta.main) {
  // process.exit だと stdout がパイプのとき書き込み途中で終了し出力が切れるため、自然終了させる。
  process.exitCode = await main(process.argv.slice(2), bunDeps);
}
