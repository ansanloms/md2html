// markdown -> 自己完結 HTML 変換の純粋ロジック。
// 副作用 (mermaid bundle の取得・キャッシュ、ローカル画像の読み込み) は
// ConvertOptions 経由で呼び出し側から注入する。

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";
import rehypeShiki from "@shikijs/rehype";
import { rehypeGithubAlerts } from "rehype-github-alerts";
import { visit } from "unist-util-visit";
import { encodeBase64 } from "@std/encoding/base64";
import { CODE_COPY_JS, MARKDOWN_THEME_CSS, ZOOM_JS } from "./assets.ts";
import type { Frontmatter } from "./frontmatter.ts";

export interface ResolvedImage {
  mime: string;
  data: Uint8Array;
}

/**
 * 出力 HTML に埋め込む UI 文言。既定は日本語 (DEFAULT_LABELS)。
 * `{name}` を含む値は、対象の名前 (画像の alt・モーダルのキャプション) に置換する。
 * zoom.js が使う文言は JSON ブロック経由でクライアントへ渡す (ZOOM_LABEL_KEYS)。
 */
export interface Labels {
  /** コードブロックのコピーボタンのラベル。 */
  copy: string;
  /** 目次 (aside.toc) の aria-label。 */
  toc: string;
  /** alt の無い画像の既定名。プレースホルダと拡大表示のラベルで使う。 */
  image: string;
  /** 読み込めなかった画像のプレースホルダ文言。`{name}` は alt (無ければ image)。 */
  imagePlaceholder: string;
  /** mermaid 図のモーダルキャプション。 */
  figure: string;
  /** モーダル拡大の対象に付くバッジの文言。 */
  zoomBadge: string;
  /** 画像を拡大表示するラッパの aria-label。`{name}` は alt (無ければ image)。 */
  zoomImageLabel: string;
  /** モーダル (dialog) の aria-label。`{name}` はキャプション (無ければ空)。 */
  zoomDialogLabel: string;
  /** モーダルの閉じるボタンの title。 */
  zoomClose: string;
  /** モーダルの拡大ボタンの title。 */
  zoomIn: string;
  /** モーダルの縮小ボタンの title。 */
  zoomOut: string;
  /** モーダルの全体表示ボタンの title。 */
  zoomFit: string;
  /** モーダルの操作ヒント。 */
  zoomHint: string;
}

/** UI 文言の既定値 (日本語)。ConvertOptions.labels で個別に上書きできる。 */
export const DEFAULT_LABELS: Labels = {
  copy: "コピー",
  toc: "目次",
  image: "画像",
  imagePlaceholder: "{name}（画像プレースホルダ）",
  figure: "図",
  zoomBadge: "拡大",
  zoomImageLabel: "{name}を拡大表示",
  zoomDialogLabel: "{name}拡大表示",
  zoomClose: "閉じる",
  zoomIn: "拡大",
  zoomOut: "縮小",
  zoomFit: "全体表示",
  zoomHint:
    "ドラッグで移動 · ホイールで拡大縮小 · ダブルクリックで全体表示 · Esc で閉じる",
};

/**
 * zoom.js (クライアント側) が使う文言のキー。JSON ブロックへ載せる対象。
 * 既定値のままなら JSON へ載せず zoom.js 側の既定を使うため、
 * ここの既定値は zoom.js の DEFAULT_LABELS と一致している必要がある
 * (一致は md2html.test.ts で検証する)。
 */
export const ZOOM_LABEL_KEYS = [
  "image",
  "figure",
  "zoomBadge",
  "zoomImageLabel",
  "zoomDialogLabel",
  "zoomClose",
  "zoomIn",
  "zoomOut",
  "zoomFit",
  "zoomHint",
] as const satisfies ReadonlyArray<keyof Labels>;

/** `{name}` を値で置換する。 */
function formatLabel(template: string, name: string): string {
  return template.replaceAll("{name}", name);
}

export interface ConvertOptions {
  /**
   * 出力 HTML の <title>。
   * 優先順位 (CLI --title > frontmatter title > 入力ファイル名) の解決は
   * 呼び出し側の責務で、ここでは frontmatter.title を参照しない。
   */
  title: string;
  /**
   * 解釈済みの frontmatter (lib/frontmatter.ts の parseFrontmatter の結果)。
   * description があれば <meta name="description"> を出力し、
   * md2html.zoomTargets があればモーダル拡大表示の対象セレクタとして埋め込む (無ければ DEFAULT_ZOOM_TARGETS)。
   * 渡す markdown は frontmatter ブロックを除いた本文であること。
   */
  frontmatter?: Frontmatter;
  /**
   * 出力 HTML の `<html lang>`。省略時は "ja"。
   * 優先順位 (CLI --lang > frontmatter lang > 既定) の解決は呼び出し側の責務で、
   * ここでは frontmatter.lang を参照しない。
   */
  lang?: string;
  /** UI 文言の上書き。指定しないキーは DEFAULT_LABELS (日本語) のまま。 */
  labels?: Partial<Labels>;
  /** 追記するユーザ CSS (テキスト)。 */
  css?: string;
  /** mermaid ブロックがあるときだけ呼ばれる。mermaid の browser 向け bundle 本文を返す。 */
  getMermaidJs: () => Promise<string>;
  /** http(s): / data: 以外の img src を解決する。読めなければ null を返す。 */
  resolveImage: (src: string) => Promise<ResolvedImage | null>;
}

// remark/rehype 系のパッケージは deno.json に "hast" 型を直接持ち込んでいないため、
// hast ノードは最小限のダックタイピングで扱う (visit へは any として渡す)。
// deno-lint-ignore no-explicit-any
type HastNode = any;

/**
 * hast の要素 properties からクラス名の配列を読む。canonical な `className`
 * (配列) だけでなく、`@shikijs/rehype` の addLanguageClass が出力する生の
 * `class` (文字列または配列) にも対応する。
 */
function getClassNames(properties: HastNode | undefined): string[] {
  if (!properties) {
    return [];
  }
  const raw = properties.className ?? properties.class;
  if (Array.isArray(raw)) {
    return raw as string[];
  }
  if (typeof raw === "string") {
    return raw.split(/\s+/).filter((name) => name !== "");
  }
  return [];
}

/** テキストノードの value を再帰的に連結する。 */
function extractText(node: HastNode): string {
  if (node.type === "text") {
    return typeof node.value === "string" ? node.value : "";
  }
  if (!Array.isArray(node.children)) {
    return "";
  }
  return node.children.map(extractText).join("");
}

/**
 * `pre > code.language-mermaid` を `<pre class="mermaid">生コード</pre>` へ置換する
 * rehype プラグイン。@shikijs/rehype より前に適用し、shiki のハイライト対象から外す。
 * mermaid ブロックを 1 つでも変換したら used.value を true にする。
 */
function rehypeMermaid(used: { value: boolean }) {
  return (tree: HastNode) => {
    visit(
      tree,
      "element",
      (
        node: HastNode,
        index: number | undefined,
        parent: HastNode | undefined,
      ) => {
        if (node.tagName !== "pre" || !parent || typeof index !== "number") {
          return;
        }

        const codeChild = (node.children ?? []).find(
          (child: HastNode) =>
            child.type === "element" && child.tagName === "code",
        );
        if (!codeChild) {
          return;
        }

        const classNames: string[] = Array.isArray(
            codeChild.properties?.className,
          )
          ? codeChild.properties.className
          : [];
        if (!classNames.includes("language-mermaid")) {
          return;
        }

        parent.children[index] = {
          type: "element",
          tagName: "pre",
          properties: { className: ["mermaid"] },
          children: [{ type: "text", value: extractText(codeChild) }],
        };
        used.value = true;
      },
    );
  };
}

/**
 * http(s): / data: 以外の img src を扱う rehype プラグイン。resolveImage が
 * 画像を返せば data URI へ差し替え、null を返せば (ローカルに実体が無ければ)
 * `<div class="img-ph">` + labels.imagePlaceholder へ置換する。
 * 置換されずに img として残った要素が 1 つでもあれば used.value を true にする
 * (zoom.js の既定対象 (img) を埋め込むかの判定に使う)。
 */
function rehypeInlineImages(
  resolveImage: ConvertOptions["resolveImage"],
  labels: Labels,
  used: { value: boolean },
) {
  return async (tree: HastNode) => {
    const targets: Array<
      { node: HastNode; parent: HastNode; index: number }
    > = [];
    visit(
      tree,
      "element",
      (
        node: HastNode,
        index: number | undefined,
        parent: HastNode | undefined,
      ) => {
        if (
          node.tagName === "img" &&
          typeof node.properties?.src === "string" &&
          parent && typeof index === "number"
        ) {
          targets.push({ node, parent, index });
        }
      },
    );

    for (const { node, parent, index } of targets) {
      const src = node.properties.src as string;
      if (/^(https?:|data:)/i.test(src)) {
        used.value = true;
        continue;
      }

      const resolved = await resolveImage(src);
      if (resolved) {
        node.properties.src = `data:${resolved.mime};base64,${
          encodeBase64(resolved.data)
        }`;
        used.value = true;
        continue;
      }

      const alt = typeof node.properties.alt === "string"
        ? node.properties.alt
        : "";
      const label = formatLabel(
        labels.imagePlaceholder,
        alt !== "" ? alt : labels.image,
      );
      parent.children[index] = {
        type: "element",
        tagName: "div",
        properties: { className: ["img-ph"] },
        children: [{ type: "text", value: label }],
      };
    }
  };
}

/** table を `<div class="table-wrap">` で包む rehype プラグイン。 */
function rehypeTableWrap() {
  return (tree: HastNode) => {
    visit(
      tree,
      "element",
      (
        node: HastNode,
        index: number | undefined,
        parent: HastNode | undefined,
      ) => {
        if (
          node.tagName !== "table" || !parent || typeof index !== "number"
        ) {
          return;
        }
        parent.children[index] = {
          type: "element",
          tagName: "div",
          properties: { className: ["table-wrap"] },
          children: [node],
        };
      },
    );
  };
}

/**
 * shiki 変換後の `pre` (mermaid は既に pre.mermaid へ退避済みのため対象外) を
 * `<div class="code-block">` で包み、言語ラベル (フェンスに言語指定があった
 * 場合のみ) と `<button class="code-copy">` を付ける rehype プラグイン。
 * @shikijs/rehype より後に適用する。コードブロックを 1 つでも変換したら
 * used.value を true にする。
 */
function rehypeCodeBlocks(labels: Labels, used: { value: boolean }) {
  return (tree: HastNode) => {
    visit(
      tree,
      "element",
      (
        node: HastNode,
        index: number | undefined,
        parent: HastNode | undefined,
      ) => {
        if (node.tagName !== "pre" || !parent || typeof index !== "number") {
          return;
        }

        const codeChild = (node.children ?? []).find(
          (child: HastNode) =>
            child.type === "element" && child.tagName === "code",
        );
        if (!codeChild) {
          return;
        }

        const classNames = getClassNames(codeChild.properties);
        const languageClass = classNames.find((name) =>
          name.startsWith("language-")
        );
        // defaultLanguage: "text" の fallback と区別できないため、
        // 解決後の言語が "text" のときはラベルを出さない。
        const language = languageClass
          ? languageClass.slice("language-".length)
          : "";

        const children: HastNode[] = [];
        if (language !== "" && language !== "text") {
          children.push({
            type: "element",
            tagName: "span",
            properties: { className: ["code-lang"] },
            children: [{ type: "text", value: language }],
          });
        }
        children.push(node);
        children.push({
          type: "element",
          tagName: "button",
          properties: { className: ["code-copy"], type: "button" },
          children: [{ type: "text", value: labels.copy }],
        });

        parent.children[index] = {
          type: "element",
          tagName: "div",
          properties: { className: ["code-block"] },
          children,
        };
        used.value = true;
      },
    );
  };
}

/** 見出し 1 件分の TOC エントリ (h2/h3 のみ)。 */
interface TocEntry {
  depth: 2 | 3;
  id: string;
  text: string;
}

/**
 * 見出しテキストから id 用の slug を生成する。前後 trim → 小文字化 →
 * 空白の連続を "-" 1 個に → 文字・数字・"-"・"_" 以外を除去 → 連続する
 * "-" を 1 個に潰し、先頭・末尾の "-" を除去する。日本語見出しはそのまま
 * (文字として) 残る。
 */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}\-_]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * h1〜h6 要素へ id を付与する rehype プラグイン。@shikijs/rehype より後、
 * rehype-stringify より前に適用する。既に id を持つ見出し (raw HTML 由来) は
 * その id をそのまま使い、書き換えない (文書内リンクを壊すため)。id 未設定の
 * 見出しへ slug を生成する際は、既存 id との衝突も避ける必要があるため 2 パスで
 * 走査する。第 1 パスで全見出しの既存 id を予約し、第 2 パスで未設定の見出しへ
 * (予約済みも含めて) 重複しない slug を割り当てる。生成した slug が空なら
 * "section" へフォールバックし、重複する場合は "-1", "-2" ... を付けて一意化する。
 *
 * TOC (headings) には h2/h3 のみを、テキストは h1〜h4 へのアンカー追加より前に
 * 抽出した状態で収集する。h1〜h4 には見出し末尾へ `<a class="anchor">` を追加する。
 */
function rehypeHeadingIds(headings: TocEntry[]) {
  return (tree: HastNode) => {
    const usedIds = new Set<string>();

    // 第 1 パス: 既存 id を全て予約する。
    visit(tree, "element", (node: HastNode) => {
      const match = /^h([1-6])$/.exec(node.tagName ?? "");
      if (!match) {
        return;
      }
      const existingId = node.properties?.id;
      if (typeof existingId === "string" && existingId !== "") {
        usedIds.add(existingId);
      }
    });

    // 第 2 パス: id 未設定の見出しへ slug を生成し、TOC (h2/h3) を収集し、
    // h1〜h4 へアンカーを追加する。
    visit(tree, "element", (node: HastNode) => {
      const match = /^h([1-6])$/.exec(node.tagName ?? "");
      if (!match) {
        return;
      }

      const depth = Number(match[1]);
      const text = extractText(node);

      node.properties = node.properties ?? {};
      let id = typeof node.properties.id === "string" ? node.properties.id : "";

      if (id === "") {
        const base = slugify(text) || "section";
        id = base;
        let suffix = 1;
        while (usedIds.has(id)) {
          id = `${base}-${suffix}`;
          suffix += 1;
        }
        node.properties.id = id;
        usedIds.add(id);
      }

      if (depth === 2 || depth === 3) {
        headings.push({ depth, id, text });
      }

      if (depth >= 1 && depth <= 4) {
        node.children = node.children ?? [];
        node.children.push({
          type: "element",
          tagName: "a",
          properties: {
            className: ["anchor"],
            href: `#${id}`,
            ariaHidden: "true",
          },
          children: [{ type: "text", value: "#" }],
        });
      }
    });
  };
}

/** HTML エスケープ (title・meta 等の埋め込み用)。 */
function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * 埋め込み <script> 内の `</script` によるタグの早期終了を防ぐ。
 * JS では文字列・正規表現中の `\/` は `/` のエスケープとして解釈されるため意味は変わらない。
 */
function escapeScriptClose(js: string): string {
  return js.replace(/<\/script/gi, (match) => `<\\${match.slice(1)}`);
}

/**
 * 埋め込み <style> 内の `</style` によるタグの早期終了を防ぐ。
 * CSS では文字列中の `\/` は `/` のエスケープとして解釈されるため意味は変わらない。
 */
function escapeStyleClose(css: string): string {
  return css.replace(/<\/style/gi, (match) => `<\\${match.slice(1)}`);
}

/**
 * frontmatter に md2html.zoomTargets が無いときのモーダル拡大対象。
 * mermaid 図はこの指定によらず常に対象で、画像 (img) を既定で加える。
 */
export const DEFAULT_ZOOM_TARGETS: readonly string[] = ["img"];

/**
 * `<script type="application/json">` へ埋め込む JSON の `<` `>` `&` を
 * `\uXXXX` にエスケープし、`</script` 等の混入でタグが早期終了しないようにする。
 * JSON.parse は `\u003c` を `<` に戻すため意味は変わらない。
 */
function escapeJsonForHtml(json: string): string {
  return json
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
}

/** markdown を自己完結 HTML へ変換する。 */
export async function convert(
  markdown: string,
  options: ConvertOptions,
): Promise<string> {
  const mermaidUsed = { value: false };
  const codeBlockUsed = { value: false };
  const imageUsed = { value: false };
  const headings: TocEntry[] = [];
  const labels: Labels = { ...DEFAULT_LABELS, ...options.labels };

  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeGithubAlerts, {})
    .use(rehypeMermaid, mermaidUsed)
    .use(rehypeShiki, {
      themes: { light: "github-light", dark: "github-dark" },
      // langs 未指定だと初回適用時に bundled 全 grammar (alias 込み 332 キー)
      // が eager load され、コードブロックが無い文書でも変換に数秒かかる。
      // langs を空にして lazy を有効にすると、実際に現れた言語だけがオンデマンド
      // でロードされ、ロードできない言語 (未知言語等) は fallbackLanguage へ
      // 落ちる (fallbackLanguage が設定されている限り onError には到達しない)。
      // 注意: langs: [] で eager load を避けられるのは、upstream が
      // `options.langs || 全言語` で判定し空配列が truthy に評価されるため。
      // 既知の制約: コンテナ grammar の埋め込み言語 (例: markdown フェンス内の
      // さらに内側のコードブロック) は grammar がロードされず、内側のハイライト
      // が浅くなる。フェンス言語の事前スキャンや shiki の guessEmbeddedLanguages
      // による先読みで回復はできるが、複雑さに見合わないため受容する。
      langs: [],
      lazy: true,
      defaultLanguage: "text",
      fallbackLanguage: "text",
      addLanguageClass: true,
    })
    .use(rehypeHeadingIds, headings)
    .use(rehypeCodeBlocks, labels, codeBlockUsed)
    .use(rehypeTableWrap)
    .use(rehypeInlineImages, options.resolveImage, labels, imageUsed)
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(markdown);

  const body = String(file);

  let mermaidScript = "";
  if (mermaidUsed.value) {
    const js = await options.getMermaidJs();
    mermaidScript = `<script type="module">${escapeScriptClose(js)}</script>`;
  }

  let layoutStyle = "";
  let tocAside = "";
  if (headings.length > 0) {
    const items = headings
      .map((heading) =>
        `<li><a class="lv-${heading.depth}" href="#${escapeHtml(heading.id)}">${
          escapeHtml(heading.text)
        }</a></li>`
      )
      .join("");
    tocAside = `<aside class="toc" aria-label="${
      escapeHtml(labels.toc)
    }"><ul>${items}</ul></aside>`;
  } else {
    layoutStyle = ' style="grid-template-columns: minmax(0, 1fr)"';
  }

  let codeCopyScript = "";
  if (codeBlockUsed.value) {
    codeCopyScript = `<script>${escapeScriptClose(CODE_COPY_JS)}</script>`;
  }

  // モーダル拡大表示 (zoom.js) の対象セレクタ。frontmatter に指定があればそれを使い
  // (空配列なら画像を外して mermaid 図のみ)、無ければ既定 (img)。
  // zoom.js は mermaid 図があるとき、セレクタを明示指定されたとき、既定適用時に
  // img が残っているときに埋め込む (画像も mermaid も無い文書には埋め込まない)。
  // 対象セレクタは zoom.js が読む JSON ブロックとして zoom.js より前に置く。
  const explicitTargets = options.frontmatter?.md2html?.zoomTargets;
  const zoomTargets = explicitTargets ?? DEFAULT_ZOOM_TARGETS;
  const zoomNeeded = mermaidUsed.value ||
    (zoomTargets.length > 0 &&
      (explicitTargets !== undefined || imageUsed.value));
  // zoom.js の文言。既定のままなら JSON へ載せない (zoom.js 側の既定が使われる)。
  const zoomLabels: Partial<Labels> = {};
  for (const key of ZOOM_LABEL_KEYS) {
    if (labels[key] !== DEFAULT_LABELS[key]) {
      zoomLabels[key] = labels[key];
    }
  }
  const hasZoomLabels = Object.keys(zoomLabels).length > 0;
  let zoomTargetsJson = "";
  let zoomScript = "";
  if (zoomNeeded) {
    // 文言の上書きが無ければセレクタの配列そのものを載せ、あれば
    // { targets, labels } のオブジェクトにする (zoom.js は両方を読める)。
    if (zoomTargets.length > 0 || hasZoomLabels) {
      const payload = hasZoomLabels
        ? { targets: zoomTargets, labels: zoomLabels }
        : zoomTargets;
      zoomTargetsJson =
        `<script type="application/json" id="md2html-zoom-targets">${
          escapeJsonForHtml(JSON.stringify(payload))
        }</script>`;
    }
    zoomScript = `<script>${escapeScriptClose(ZOOM_JS)}</script>`;
  }

  const description = options.frontmatter?.description ?? "";
  const descriptionMeta = description === ""
    ? ""
    : `<meta name="description" content="${escapeHtml(description)}">`;

  const lang = options.lang ?? "ja";

  return [
    "<!doctype html>",
    `<html lang="${escapeHtml(lang)}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(options.title)}</title>`,
    descriptionMeta,
    "<style>",
    escapeStyleClose(MARKDOWN_THEME_CSS),
    escapeStyleClose(options.css ?? ""),
    "</style>",
    "</head>",
    "<body>",
    `<header class="site-header"><div class="inner"><span class="brand">${
      escapeHtml(options.title)
    }</span></div></header>`,
    `<div class="layout"${layoutStyle}>`,
    `<article class="md">${body}</article>`,
    tocAside,
    "</div>",
    codeCopyScript,
    zoomTargetsJson,
    zoomScript,
    mermaidScript,
    "</body>",
    "</html>",
  ].filter((part) => part !== "").join("\n");
}
