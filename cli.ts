#!/usr/bin/env -S deno run --quiet --allow-read --allow-write --allow-run=deno --allow-env=HOME,XDG_CACHE_HOME,VSCODE_TEXTMATE_DEBUG

// markdown ファイルを自己完結 HTML (シンタックスハイライト + mermaid 内蔵) へ変換する CLI。
//
// 使い方は USAGE 定数を参照 (--help でも表示する)。
//
// 入力 markdown 先頭の YAML frontmatter (lib/frontmatter.ts) を解釈し、title・
// description・lang を出力 HTML のメタ情報へ、md2html.zoomTargets をモーダル拡大表示の
// 対象へ反映する (未指定なら既定で画像が対象)。frontmatter ブロックは本文から除く。
// md2html 名前空間の指定が不正なら警告を stderr へ出したうえで無視する。
//
// mermaid は npm:mermaid を import する browser 向けエントリ TS を子プロセスの
// `deno bundle` でバンドルし、初回のみ ~/.cache/md2html/ (または
// $XDG_CACHE_HOME/md2html/) へキャッシュする。以降はキャッシュを読むだけなので
// このプロセス自身はネットワーク権限を必要としない (npm:mermaid の取得は
// 子プロセスの deno bundle が自身のモジュール解決として行う)。
//
// ローカル画像は入力ファイルのディレクトリを基準に解決し (lib/image.ts)、見つからなければ
// cwd 基準へフォールバックする。
//
// 変換ロジックは lib/convert.ts の convert() に分離し、副作用 (ファイル読み書き・
// mermaid bundle 取得・キャッシュ) はここで組み立てて注入する。
//
// ライブラリとして import する場合は mod.ts を使う。

import { parseArgs } from "@std/cli/parse-args";
import { basename, dirname } from "@std/path";
import { convert } from "./lib/convert.ts";
import { createImageResolver } from "./lib/image.ts";
import { type Frontmatter, parseFrontmatter } from "./lib/frontmatter.ts";
import { getMermaidBundle, type MermaidBundleDeps } from "./lib/mermaid.ts";
import denoJson from "./deno.json" with { type: "json" };

/**
 * --help および引数エラー時に出す使い方。
 * ファイル冒頭コメント・README・エラー出力で文面を分散させないため、ここに一本化する。
 */
const USAGE =
  `使い方: md2html [<input.md>] [--output <path>] [--css <path>] [--title <title>] [--lang <lang>]
  <input.md>  入力 markdown ファイル。省略するか "-" を指定すると stdin から読む。
  --output    出力先パス。省略時は stdout。
  --css       追記するユーザ CSS ファイルのパス。
  --title     HTML の <title>。省略時は frontmatter の title、それも無ければ
              入力ファイル名 (stdin から読む場合は "md2html")。
  --lang      HTML の <html lang>。省略時は frontmatter の lang、それも無ければ "ja"。
  --help      この使い方を表示する。
  --version   バージョンを表示する。`;

/**
 * entryPath を browser 向けに bundle し outPath へ書き出す。失敗時は throw する。
 *
 * `--no-config` / `--no-lock` で md2html 実行時の cwd 以下にある無関係な
 * deno.json / deno.lock の自動検出を止める。付けないと、cwd に deno プロジェクトが
 * あるディレクトリ (例: 別リポジトリの README.md を変換する) で mermaid ブロックを
 * 変換するたびに、そのプロジェクトの deno.lock へ mermaid の依存木が書き込まれてしまう。
 */
async function bundle(entryPath: string, outPath: string): Promise<void> {
  const { success, stderr } = await new Deno.Command("deno", {
    args: [
      "bundle",
      "--no-config",
      "--no-lock",
      "--platform",
      "browser",
      "--minify",
      "-o",
      outPath,
      entryPath,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();

  if (!success) {
    throw new Error(
      `deno bundle に失敗した: ${new TextDecoder().decode(stderr).trim()}`,
    );
  }
}

const mermaidBundleDeps: MermaidBundleDeps = {
  env: (key) => Deno.env.get(key),
  readTextFile: (path) => Deno.readTextFile(path),
  writeTextFile: (path, text) => Deno.writeTextFile(path, text),
  mkdir: (path) => Deno.mkdir(path, { recursive: true }),
  makeTempDir: () => Deno.makeTempDir(),
  remove: (path, options) => Deno.remove(path, options),
  rename: (from, to) => Deno.rename(from, to),
  readDir: (path) => Deno.readDir(path),
  denoVersion: Deno.version.deno,
  bundle,
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
  /** mermaid の browser 向け bundle (JS ソース) を返す。 */
  getMermaidJs: () => Promise<string>;
  /** stdout へ 1 行書く (console.log 相当)。 */
  log: (text: string) => void;
  /** stderr へ 1 行書く (console.error 相当)。 */
  error: (text: string) => void;
}

/** Deno API をそのまま使う CliDeps の実装。 */
export const denoDeps: CliDeps = {
  stdinIsTerminal: () => Deno.stdin.isTerminal(),
  readStdin: () => new Response(Deno.stdin.readable).text(),
  readTextFile: (path) => Deno.readTextFile(path),
  readFile: (path) => Deno.readFile(path),
  writeTextFile: (path, text) => Deno.writeTextFile(path, text),
  getMermaidJs: () => getMermaidBundle(mermaidBundleDeps),
  log: (text) => console.log(text),
  error: (text) => console.error(text),
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

export async function main(
  args: string[],
  deps: CliDeps = denoDeps,
): Promise<number> {
  // parseArgs は未知のフラグも黙って受け入れるため、unknown で拾って後段で弾く。
  // 位置引数 (key 無し) と stdin を表す "-" は正当なので対象外にする。
  // 短縮フラグの塊 (`-xy`) では同じ arg で文字数分呼ばれるため Set で重複を潰す。
  const unknownOptions = new Set<string>();
  const parsed = parseArgs(args, {
    string: ["output", "css", "title", "lang"],
    boolean: ["help", "version"],
    unknown: (arg) => {
      if (arg.startsWith("-") && arg !== "-") {
        unknownOptions.add(arg);
      }
      return true;
    },
  });

  if (parsed.help) {
    deps.log(USAGE);
    return 0;
  }

  if (parsed.version) {
    deps.log(denoJson.version);
    return 0;
  }

  if (unknownOptions.size > 0) {
    return usageError(
      deps,
      `不明なオプション: ${[...unknownOptions].join(", ")}`,
    );
  }

  // 値を伴わない --output / --css は parseArgs が空文字列を返す。
  // 空文字列のパスは書き込み・読み込みのどちらでも意味を持たないためエラーにする。
  if (parsed.output === "") {
    return usageError(deps, "--output にパスを指定してください");
  }
  if (parsed.css === "") {
    return usageError(deps, "--css にパスを指定してください");
  }

  // parseArgs は空文字列の引数を、オプションの値として消費した場合でも "_" へ積む
  // (`--title ""` は title に "" を入れつつ "_" にも "" を積む)。この漏れ出しぶんだけを
  // 1 つ取り除き、残った空文字列は本物の位置引数 (シェル変数が空だった等) として弾く。
  // 空値でエラーにする --output / --css は上で弾いているため、ここでは
  // 空値を未指定扱いにするオプション (--title / --lang) のぶんだけ数える。
  const positional = parsed._.map(String);
  for (const value of [parsed.title, parsed.lang]) {
    if (value !== "") {
      continue;
    }
    const leaked = positional.indexOf("");
    if (leaked !== -1) {
      positional.splice(leaked, 1);
    }
  }
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
      `md2html: ${fromStdin ? "stdin" : "入力ファイル"}を読み込めない: ${
        messageOf(error)
      }`,
    );
    return 1;
  }

  let css: string | undefined;
  if (parsed.css !== undefined) {
    try {
      css = await deps.readTextFile(parsed.css);
    } catch (error) {
      deps.error(
        `md2html: CSS ファイルを読み込めない: ${messageOf(error)}`,
      );
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
  const cliTitle = parsed.title === undefined || parsed.title === ""
    ? undefined
    : parsed.title;
  const title = cliTitle ?? frontmatter.title ??
    (fromStdin ? "md2html" : basename(inputPath));
  // 空の --lang も同様に未指定として扱う。
  const lang = (parsed.lang || undefined) ?? frontmatter.lang;

  let html: string;
  try {
    html = await convert(body, {
      title,
      frontmatter,
      lang,
      css,
      getMermaidJs: deps.getMermaidJs,
      resolveImage: createImageResolver({
        readFile: deps.readFile,
        baseDir: dirname(inputPath),
      }),
    });
  } catch (error) {
    deps.error(`md2html: 変換に失敗した: ${messageOf(error)}`);
    return 1;
  }

  if (parsed.output !== undefined) {
    try {
      await deps.writeTextFile(parsed.output, html);
    } catch (error) {
      deps.error(
        `md2html: 出力ファイルを書き込めない: ${messageOf(error)}`,
      );
      return 1;
    }
  } else {
    deps.log(html);
  }

  return 0;
}

if (import.meta.main) {
  Deno.exit(await main(Deno.args, denoDeps));
}
