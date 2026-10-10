// markdown 先頭の YAML frontmatter を解釈する純粋ロジック。
// frontmatter ブロックを本文から切り離し、既知のキーを型付きで返す。
// `md2html.*` 名前空間の変換オプション (zoomTargets) も frontmatter で持ち、
// パース結果は呼び出し側から convert() へ渡す。

import { parse } from "yaml";

/** frontmatter の `md2html` 名前空間で指定する変換オプション。 */
export interface Md2htmlOptions {
  /**
   * クリックでモーダル拡大表示する要素の CSS セレクタ。mermaid 図は指定の有無によらず常に対象。
   * 未指定なら convert() 側の既定 (DEFAULT_ZOOM_TARGETS) が使われ、指定があれば既定を置き換える。
   * 空配列は「既定を外す (mermaid 図のみ)」を意味する。
   */
  zoomTargets?: string[];
  /** mermaid の設定。 */
  mermaid?: MermaidOptions;
}

/** frontmatter の `md2html.mermaid` 名前空間で指定する mermaid の設定。 */
export interface MermaidOptions {
  /** mermaid の npm バージョン指定子。未指定なら lib/mermaid.ts の MERMAID_VERSION。 */
  version?: string;
}

/** frontmatter から読み取る既知のキー。 */
export interface Frontmatter {
  /** 出力 HTML の <title> 候補。CLI の --title が無いときに使う。 */
  title?: string;
  /** <meta name="description"> の content。 */
  description?: string;
  /** 出力 HTML の <html lang> 候補。CLI の --lang が無いときに使う。 */
  lang?: string;
  /** `md2html` 名前空間の変換オプション。`md2html` がマッピングとして書かれていないか、既知のキーが無ければ未設定。 */
  md2html?: Md2htmlOptions;
}

/** parseFrontmatter の結果。 */
export interface ParsedMarkdown {
  /** 解釈済みの frontmatter。frontmatter が無ければ空オブジェクト。 */
  frontmatter: Frontmatter;
  /** frontmatter ブロックを取り除いた本文。frontmatter が無ければ入力そのまま。 */
  body: string;
  /**
   * `md2html` 名前空間の指定が不正で無視・除外された箇所の警告文 (日本語)。
   * 変換自体は続行するため、呼び出し側が利用者へ知らせる。問題が無ければ空配列。
   */
  warnings: string[];
}

/**
 * 値が書かれていない (キーだけ・空文字列) かを判定する。YAML の空値は
 * スキーマによって null / 空文字列のいずれにもなるため両方を未指定として扱う。
 */
function isEmptyValue(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/** 非空の文字列ならそのまま返す。空文字列・文字列以外は undefined (未指定扱い)。 */
function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * 先頭が `---` 行 (LF / CRLF) で始まり、次の `---` / `...` 行で閉じる区間を frontmatter として切り出す。
 * 開き行・閉じ行とも末尾の空白 (スペース・タブ) を許容する。
 * 閉じる行が無い・先頭に空行等があって `---` 行で始まらない場合は null。
 */
function splitFrontmatter(
  markdown: string,
): { frontMatter: string; body: string } | null {
  const opening = /^---[ \t]*\r?\n/.exec(markdown);
  if (opening === null) {
    return null;
  }

  const rest = markdown.slice(opening[0].length);
  let lineStart = 0;
  while (lineStart <= rest.length) {
    const newline = rest.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? rest.length : newline;
    const line = rest.slice(lineStart, lineEnd).replace(/\r$/, "");
    if (/^(---|\.\.\.)[ \t]*$/.test(line)) {
      return {
        frontMatter: rest.slice(0, lineStart).replace(/\r?\n$/, ""),
        body: newline === -1 ? "" : rest.slice(newline + 1),
      };
    }
    if (newline === -1) {
      break;
    }
    lineStart = newline + 1;
  }
  return null;
}

/**
 * markdown 先頭の YAML frontmatter を解釈し、本文と分離する。
 *
 * - 先頭が `---` で始まる frontmatter ブロックが無ければ、frontmatter は空、本文は入力そのまま。
 * - YAML は failsafe スキーマで解析し、スカラは書かれた文字どおりの文字列として受ける
 *   (`1.10` や `2024-01-01` も数値・日付へ変換しない)。
 * - `title` / `description` / `lang` は非空の文字列だけを採用し、空文字列・配列・マッピング等は未指定扱いにする。
 * - `md2html.zoomTargets` は配列の要素のうち非空の文字列だけを採用する。空配列も (既定の対象を外す指定として)
 *   そのまま保持する。配列でない・`md2html` がマッピングでない場合は未設定にする。この種の不正な指定は
 *   黙って無視せず warnings へ積む。
 * - コメントだけ等で YAML 文書が空になる場合は、空の frontmatter として扱いブロックは本文から除く。
 * - ブロック全体がマッピングでない (スカラ等) 場合は frontmatter とみなさず、本文は入力そのまま
 *   (先頭の `---` 水平線を frontmatter と誤認して本文を欠落させないため)。
 * - YAML として解析できない場合は原因を含む Error を throw する。
 */
export function parseFrontmatter(input: string): ParsedMarkdown {
  // 先頭の UTF-8 BOM は frontmatter の判定を妨げるため、1 つだけ除去する。
  const markdown = input.startsWith("\uFEFF") ? input.slice(1) : input;
  const split = splitFrontmatter(markdown);
  if (split === null) {
    return { frontmatter: {}, body: markdown, warnings: [] };
  }

  const { frontMatter, body } = split;
  let attrs: unknown;
  try {
    // スカラを文字どおり保つため failsafe スキーマで解析する。
    attrs =
      frontMatter === "" ? {} : parse(frontMatter, { schema: "failsafe" });
  } catch (error) {
    throw new Error(
      `frontmatter の YAML を解析できない: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // コメントだけ等で YAML 文書が空 (null) の場合は空の frontmatter として扱い、ブロックは本文から除く。
  if (attrs === null || attrs === undefined) {
    return { frontmatter: {}, body, warnings: [] };
  }

  // スカラ・配列など、マッピングでない YAML は frontmatter とみなさず入力をそのまま返す
  // (先頭の `---` 水平線を frontmatter と誤認して本文を欠落させないため)。
  if (typeof attrs !== "object" || Array.isArray(attrs)) {
    return { frontmatter: {}, body: markdown, warnings: [] };
  }

  const record = attrs as Record<string, unknown>;
  const frontmatter: Frontmatter = {};
  const warnings: string[] = [];
  const title = nonEmptyString(record.title);
  if (title !== undefined) {
    frontmatter.title = title;
  }
  const description = nonEmptyString(record.description);
  if (description !== undefined) {
    frontmatter.description = description;
  }
  const lang = nonEmptyString(record.lang);
  if (lang !== undefined) {
    frontmatter.lang = lang;
  }
  const md2html = record.md2html;
  // 値の無いキー (`md2html:` だけ書いた等) は未設定として扱い、警告もしない。
  if (!isEmptyValue(md2html)) {
    if (typeof md2html !== "object" || Array.isArray(md2html)) {
      warnings.push("frontmatter の md2html はマッピングでないため無視した");
    } else {
      const rawTargets = (md2html as Record<string, unknown>).zoomTargets;
      if (isEmptyValue(rawTargets)) {
        // 既知のキーが無い・値が空なら未設定のまま (警告もしない)。
      } else if (!Array.isArray(rawTargets)) {
        warnings.push(
          "frontmatter の md2html.zoomTargets は配列でないため無視した",
        );
      } else {
        // 空配列も保持する (既定の対象 (img) を外して mermaid 図だけにする指定として使う)。
        const zoomTargets = rawTargets.filter(
          (value): value is string => nonEmptyString(value) !== undefined,
        );
        const dropped = rawTargets.length - zoomTargets.length;
        if (dropped > 0) {
          warnings.push(
            `frontmatter の md2html.zoomTargets の ${dropped} 件は非空の文字列でないため除外した`,
          );
        }
        frontmatter.md2html = { ...frontmatter.md2html, zoomTargets };
      }

      const rawMermaid = (md2html as Record<string, unknown>).mermaid;
      // 値の無いキー (`mermaid:` だけ書いた等) は未設定として扱い、警告もしない。
      if (!isEmptyValue(rawMermaid)) {
        if (typeof rawMermaid !== "object" || Array.isArray(rawMermaid)) {
          warnings.push(
            "frontmatter の md2html.mermaid はマッピングでないため無視した",
          );
        } else {
          const rawVersion = (rawMermaid as Record<string, unknown>).version;
          if (isEmptyValue(rawVersion)) {
            // 既知のキーが無い・値が空なら未設定のまま (警告もしない)。
          } else if (typeof rawVersion !== "string") {
            warnings.push(
              "frontmatter の md2html.mermaid.version は文字列でないため無視した",
            );
          } else {
            frontmatter.md2html = {
              ...frontmatter.md2html,
              mermaid: { version: rawVersion },
            };
          }
        }
      }
    }
  }
  return { frontmatter, body, warnings };
}
