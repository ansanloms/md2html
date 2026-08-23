// markdown 先頭の YAML frontmatter を解釈する純粋ロジック。
// frontmatter ブロックを本文から切り離し、既知のキーを型付きで返す。
// 将来 `md2html.*` 名前空間の変換オプションを frontmatter で持たせる想定で、
// パース結果は呼び出し側から convert() へ渡す。

import { extract } from "@std/front-matter/yaml";
import { test } from "@std/front-matter/test";
import { parse } from "@std/yaml";

/** frontmatter から読み取る既知のキー。 */
export interface Frontmatter {
  /** 出力 HTML の <title> 候補。CLI の --title が無いときに使う。 */
  title?: string;
  /** <meta name="description"> の content。 */
  description?: string;
}

/** parseFrontmatter の結果。 */
export interface ParsedMarkdown {
  /** 解釈済みの frontmatter。frontmatter が無ければ空オブジェクト。 */
  frontmatter: Frontmatter;
  /** frontmatter ブロックを取り除いた本文。frontmatter が無ければ入力そのまま。 */
  body: string;
}

/** 非空の文字列ならそのまま返す。空文字列・文字列以外は undefined (未指定扱い)。 */
function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * markdown 先頭の YAML frontmatter を解釈し、本文と分離する。
 *
 * - 先頭が `---` で始まる frontmatter ブロックが無ければ、frontmatter は空、本文は入力そのまま。
 * - YAML は failsafe スキーマで解析し、スカラは書かれた文字どおりの文字列として受ける
 *   (`1.10` や `2024-01-01` も数値・日付へ変換しない)。
 * - `title` / `description` は非空の文字列だけを採用し、空文字列・配列・マッピング等は未指定扱いにする。
 * - コメントだけ等で YAML 文書が空になる場合は、空の frontmatter として扱いブロックは本文から除く。
 * - ブロック全体がマッピングでない (スカラ等) 場合は frontmatter とみなさず、本文は入力そのまま
 *   (先頭の `---` 水平線を frontmatter と誤認して本文を欠落させないため)。
 * - YAML として解析できない場合は原因を含む Error を throw する。
 */
export function parseFrontmatter(markdown: string): ParsedMarkdown {
  if (!test(markdown, ["yaml"])) {
    return { frontmatter: {}, body: markdown };
  }

  let frontMatter: string;
  let body: string;
  let attrs: unknown;
  try {
    // extract は分割と同時に core スキーマで YAML を解析するため不正な YAML で throw する。
    // スカラを文字どおり保つため、分割結果の frontMatter を failsafe スキーマで解析し直す。
    ({ frontMatter, body } = extract<unknown>(markdown));
    attrs = frontMatter === ""
      ? {}
      : parse(frontMatter, { schema: "failsafe" });
  } catch (error) {
    throw new Error(
      `frontmatter の YAML を解析できない: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // コメントだけ等で YAML 文書が空 (null) の場合は空の frontmatter として扱い、ブロックは本文から除く。
  if (attrs === null || attrs === undefined) {
    return { frontmatter: {}, body };
  }

  // スカラ・配列など、マッピングでない YAML は frontmatter とみなさず入力をそのまま返す
  // (先頭の `---` 水平線を frontmatter と誤認して本文を欠落させないため)。
  if (typeof attrs !== "object" || Array.isArray(attrs)) {
    return { frontmatter: {}, body: markdown };
  }

  const record = attrs as Record<string, unknown>;
  const frontmatter: Frontmatter = {};
  const title = nonEmptyString(record.title);
  if (title !== undefined) {
    frontmatter.title = title;
  }
  const description = nonEmptyString(record.description);
  if (description !== undefined) {
    frontmatter.description = description;
  }
  return { frontmatter, body };
}
