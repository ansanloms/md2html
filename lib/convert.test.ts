import { expect, test } from "bun:test";
import { MERMAID_RENDER_JS, ZOOM_JS } from "./assets.ts";
import {
  type ConvertOptions,
  convert,
  DEFAULT_LABELS,
  DEFAULT_ZOOM_TARGETS,
  slugify,
  ZOOM_LABEL_KEYS,
} from "./convert.ts";

/** 既定の zoomTargets が JSON ブロックとして出力された形。 */
const DEFAULT_ZOOM_TARGETS_JSON = `<script type="application/json" id="md2html-zoom-targets">${JSON.stringify(
  DEFAULT_ZOOM_TARGETS,
)}</script>`;

/** テスト用の最小 ConvertOptions。個別のテストで必要な項目だけ上書きする。 */
function baseOptions(overrides: Partial<ConvertOptions> = {}): ConvertOptions {
  return {
    title: "テスト",
    getMermaidJs: () => Promise.resolve("/* mermaid stub */"),
    resolveImage: () => Promise.resolve(null),
    ...overrides,
  };
}

test("コードブロックは shiki でインライン style 化される", async () => {
  const html = await convert(
    "```ts\nconst x: number = 1;\n```\n",
    baseOptions(),
  );
  expect(html).toContain('class="shiki');
  expect(html).toContain("style=");
});

test("mermaid ブロックは pre.mermaid に変換され mermaid bundle と描画スクリプトが classic script で埋め込まれる", async () => {
  const html = await convert(
    "```mermaid\ngraph TD\n  A --> B\n```\n",
    baseOptions({ getMermaidJs: () => Promise.resolve("/* mermaid stub */") }),
  );
  expect(html).toContain('<pre class="mermaid">');
  expect(html).toContain("graph TD");
  expect(html).toContain("<script>/* mermaid stub */</script><script>");
  expect(html).toContain(MERMAID_RENDER_JS);
  expect(html.includes('<script type="module">')).toEqual(false);
});

test("mermaid ブロックが無ければ mermaid スクリプトは埋め込まれない", async () => {
  const html = await convert("# hello\n", baseOptions());
  expect(html.includes(MERMAID_RENDER_JS)).toEqual(false);
  expect(html.includes("mermaid stub")).toEqual(false);
});

test("未知言語・言語未指定ブロックでも throw しない", async () => {
  const html1 = await convert("```unknown-lang-xyz\nfoo\n```\n", baseOptions());
  expect(html1).toContain("foo");

  const html2 = await convert("```\nbar\n```\n", baseOptions());
  expect(html2).toContain("bar");
});

test("GFM テーブルは table 要素になる", async () => {
  const html = await convert(
    "| a | b |\n|---|---|\n| 1 | 2 |\n",
    baseOptions(),
  );
  expect(html).toContain("<table>");
  expect(html).toContain("<td>1</td>");
});

test("GFM テーブルは div.table-wrap で包まれる", async () => {
  const html = await convert(
    "| a | b |\n|---|---|\n| 1 | 2 |\n",
    baseOptions(),
  );
  expect(html).toContain('<div class="table-wrap"><table>');
});

test("ローカル画像は data URI 化される", async () => {
  const data = new Uint8Array([1, 2, 3]);
  const html = await convert(
    "![alt](local.png)\n",
    baseOptions({
      resolveImage: (src) =>
        src === "local.png"
          ? Promise.resolve({ mime: "image/png", data })
          : Promise.resolve(null),
    }),
  );
  expect(html).toContain("data:image/png;base64,");
});

test("http(s) 画像はそのまま残る", async () => {
  const html = await convert(
    "![alt](https://example.com/a.png)\n",
    baseOptions({
      resolveImage: () => {
        throw new Error("http(s) 画像で resolveImage を呼んではいけない");
      },
    }),
  );
  expect(html).toContain('src="https://example.com/a.png"');
});

test("resolveImage が null を返すローカル画像は img-ph へ置換される (alt あり)", async () => {
  const html = await convert(
    "![サンプル画像](./not-found.png)\n",
    baseOptions(),
  );
  expect(html).toContain(
    '<div class="img-ph">サンプル画像（画像プレースホルダ）</div>',
  );
  expect(html.includes("<img")).toEqual(false);
});

test("resolveImage が null を返すローカル画像は img-ph へ置換される (alt 空)", async () => {
  const html = await convert("![](./not-found.png)\n", baseOptions());
  expect(html).toContain(
    '<div class="img-ph">画像（画像プレースホルダ）</div>',
  );
});

test("title は HTML エスケープされる", async () => {
  const html = await convert(
    "# hello\n",
    baseOptions({ title: '<script>alert("x")</script>' }),
  );
  expect(html).toContain(
    "<title>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</title>",
  );
});

test("frontmatter の description は meta タグとして出力される", async () => {
  const html = await convert(
    "# hello\n",
    baseOptions({ frontmatter: { description: "説明文" } }),
  );
  expect(html).toContain('<meta name="description" content="説明文">');
  expect(
    html.indexOf("<title>") < html.indexOf('<meta name="description"'),
  ).toEqual(true);
});

test("frontmatter の description は HTML エスケープされる", async () => {
  const html = await convert(
    "# hello\n",
    baseOptions({ frontmatter: { description: 'a "b" <c> & d' } }),
  );
  expect(html).toContain(
    '<meta name="description" content="a &quot;b&quot; &lt;c&gt; &amp; d">',
  );
});

test("frontmatter が無い・description が無い場合は meta description を出力しない", async () => {
  const html1 = await convert("# hello\n", baseOptions());
  expect(html1.includes('name="description"')).toEqual(false);

  const html2 = await convert("# hello\n", baseOptions({ frontmatter: {} }));
  expect(html2.includes('name="description"')).toEqual(false);

  const html3 = await convert(
    "# hello\n",
    baseOptions({ frontmatter: { description: "" } }),
  );
  expect(html3.includes('name="description"')).toEqual(false);
});

test("header.site-header と article.md で本文が構成される", async () => {
  const html = await convert(
    "# hello\n",
    baseOptions({ title: "ドキュメント" }),
  );
  expect(html).toContain(
    '<header class="site-header"><div class="inner"><span class="brand">ドキュメント</span></div></header>',
  );
  expect(html).toContain('<article class="md">');
});

test("header の brand に出す title は HTML エスケープされる", async () => {
  const html = await convert("# hello\n", baseOptions({ title: '<b>&"x"' }));
  expect(html).toContain(
    '<span class="brand">&lt;b&gt;&amp;&quot;x&quot;</span>',
  );
  expect(html.includes('<span class="brand"><b>')).toEqual(false);
});

test("見出しに id が付き h2/h3 のみ TOC (aside.toc) に収集される", async () => {
  const html = await convert(
    "# Hello World\n\n## Sub Heading\n\n### Sub Sub\n",
    baseOptions(),
  );
  expect(html).toContain('<h1 id="hello-world">');
  expect(html).toContain('<h2 id="sub-heading">');
  expect(html).toContain('<h3 id="sub-sub">');
  expect(html).toContain('<aside class="toc" aria-label="目次">');
  expect(html).toContain(
    '<li><a class="lv-2" href="#sub-heading">Sub Heading</a></li>',
  );
  expect(html).toContain(
    '<li><a class="lv-3" href="#sub-sub">Sub Sub</a></li>',
  );
  // h1 は TOC に含まれない (lv-1 は出力されない)。
  expect(html.includes('class="lv-1"')).toEqual(false);
});

test("h1 しか無い文書では TOC が出ず layout が 1 カラムになる", async () => {
  const html = await convert("# hello\n", baseOptions());
  expect(html.includes('<aside class="toc"')).toEqual(false);
  expect(html).toContain(
    '<div class="layout" style="grid-template-columns: minmax(0, 1fr)">',
  );
});

test("h1〜h4 の見出しには anchor が付き、h5/h6 には付かない", async () => {
  const html = await convert(
    "# H1\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6\n",
    baseOptions(),
  );
  expect(html).toContain(
    '<h1 id="h1">H1<a class="anchor" href="#h1" aria-hidden="true">#</a></h1>',
  );
  expect(html).toContain(
    '<h4 id="h4">H4<a class="anchor" href="#h4" aria-hidden="true">#</a></h4>',
  );
  expect(html).toContain('<h5 id="h5">H5</h5>');
  expect(html).toContain('<h6 id="h6">H6</h6>');
});

test("TOC のテキストにアンカーの # が混入しない", async () => {
  const html = await convert("## Sub Heading\n", baseOptions());
  expect(html).toContain(
    '<li><a class="lv-2" href="#sub-heading">Sub Heading</a></li>',
  );
});

test("同名見出しの id は -1 連番で一意化される", async () => {
  const html = await convert("# 概要\n\n## 概要\n", baseOptions());
  expect(html).toContain('<h1 id="概要">');
  expect(html).toContain('<h2 id="概要-1">');
});

test("raw HTML 見出しの既存 id と自動生成 id が衝突しない (既存が後)", async () => {
  const html = await convert(
    '## Foo\n\n<h2 id="foo">Bar</h2>\n',
    baseOptions(),
  );
  expect(html).toContain('id="foo-1"');
  expect(html).toContain('id="foo">Bar');
});

test("raw HTML 見出しの既存 id と自動生成 id が衝突しない (既存が先)", async () => {
  const html = await convert(
    '<h2 id="foo">Bar</h2>\n\n## Foo\n',
    baseOptions(),
  );
  expect(html).toContain('id="foo">Bar');
  expect(html).toContain('id="foo-1"');
});

test("slugify: 日本語見出し・空白・記号を扱う", () => {
  expect(slugify("  Hello World  ")).toEqual("hello-world");
  expect(slugify("日本語 見出し")).toEqual("日本語-見出し");
  expect(slugify("a/b?c#d")).toEqual("abcd");
  expect(slugify("   ")).toEqual("");
});

test("slugify: 記号除去で生じる連続ハイフンを 1 個に潰し、先頭・末尾のハイフンを除去する", () => {
  expect(slugify("code in heading & raw")).toEqual("code-in-heading-raw");
  expect(slugify("- leading and trailing -")).toEqual("leading-and-trailing");
});

test("コードブロックの出力は shiki-dark を含む (デュアルテーマ)", async () => {
  const html = await convert(
    "```ts\nconst x: number = 1;\n```\n",
    baseOptions(),
  );
  expect(html).toContain("--shiki-dark");
});

test("テーマ CSS (MARKDOWN_THEME_CSS) が注入されている", async () => {
  const html = await convert("# hello\n", baseOptions());
  expect(html).toContain(".site-header");
  expect(html).toContain("--accent:");
});

test("コードブロックは div.code-block で包まれ、言語指定時のみラベルが付く", async () => {
  const html = await convert(
    "```ts\nconst x: number = 1;\n```\n",
    baseOptions(),
  );
  expect(html).toContain('<div class="code-block">');
  expect(html).toContain('<span class="code-lang">ts</span>');
  expect(html).toContain(
    '<button class="code-copy" type="button">コピー</button>',
  );
});

test("言語未指定のコードブロックには code-lang ラベルが付かない", async () => {
  const html = await convert("```\nplain\n```\n", baseOptions());
  expect(html).toContain('<div class="code-block">');
  expect(html.includes('<span class="code-lang">')).toEqual(false);
});

test("CODE_COPY_JS はコードブロックがあるときのみ注入される", async () => {
  const withCode = await convert("```ts\nconst x = 1;\n```\n", baseOptions());
  expect(withCode).toContain("navigator.clipboard");

  const withoutCode = await convert("# hello\n", baseOptions());
  expect(withoutCode.includes("navigator.clipboard")).toEqual(false);
});

test("見出しが無い入力では TOC 分の空行が残らない", async () => {
  const html = await convert("本文だけ。\n", baseOptions());
  expect(html).toContain("</article>\n</div>\n</body>");
});

test("タスクリストは task-list-item / contains-task-list class を持つ", async () => {
  const html = await convert("- [x] done\n- [ ] todo\n", baseOptions());
  expect(html).toContain('<ul class="contains-task-list">');
  expect(html).toContain('<li class="task-list-item">');
});

test("convert: 複数言語のコードブロックがそれぞれ shiki 出力になる", async () => {
  const html = await convert(
    "```ts\nconst x: number = 1;\n```\n\n```python\nprint(1)\n```\n",
    baseOptions(),
  );
  expect(html).toContain("const");
  expect(html).toContain("print");
  const shikiCount = html.split('class="shiki').length - 1;
  expect(shikiCount).toEqual(2);
  expect(html).toContain("language-ts");
  expect(html).toContain("language-python");
});

test("convert: mermaid と ts の混在では mermaid は pre.mermaid、ts は shiki 出力になる", async () => {
  const html = await convert(
    "```mermaid\ngraph TD\n  A --> B\n```\n\n```ts\nconst x = 1;\n```\n",
    baseOptions(),
  );
  expect(html).toContain('<pre class="mermaid">');
  expect(html).toContain('class="shiki');
});

test("Object.prototype のプロパティ名と同名のフェンス言語でも throw しない", async () => {
  const html = await convert("```constructor\nfoo\n```\n", baseOptions());
  expect(html).toContain("foo");
  expect(html).toContain("language-text");
});

test("markdown フェンス (コンテナ grammar) を含む文書も throw せず変換できる", async () => {
  const html = await convert(
    "````markdown\n# inner\n\n```python\nprint(1)\n```\n````\n",
    baseOptions(),
  );
  expect(html).toContain("print");
  expect(html).toContain('class="shiki');
});

test("アラート記法は markdown-alert へ変換される", async () => {
  for (const marker of ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"]) {
    const html = await convert(
      `> [!${marker}]\n> 本文テキスト\n`,
      baseOptions(),
    );
    const type = marker.toLowerCase();
    expect(html).toContain(`class="markdown-alert markdown-alert-${type}"`);
    expect(html).toContain('class="markdown-alert-title"');
    expect(html).toContain("本文テキスト");
  }
});

test("マーカーの無い blockquote はアラートにならない", async () => {
  const html = await convert("> ただの引用\n", baseOptions());
  expect(html.includes('class="markdown-alert')).toEqual(false);
  expect(html).toContain("<blockquote>");
});

test("TOC に可視ラベルが出ない", async () => {
  const html = await convert("## 見出し\n", baseOptions());
  expect(html.includes("toc-title")).toEqual(false);
  expect(html).toContain('<aside class="toc" aria-label="目次">');
});

test("ZOOM_JS は mermaid ブロックがあるとき注入され、既定の zoomTargets (img) の JSON が出る", async () => {
  const html = await convert(
    "```mermaid\ngraph TD\n  A --> B\n```\n",
    baseOptions(),
  );
  expect(html).toContain('const TARGETS_ID = "md2html-zoom-targets";');
  expect(html).toContain(DEFAULT_ZOOM_TARGETS_JSON);
  // zoom.js は mermaid bundle より前に置かれる。
  const zoomIndex = html.indexOf('const TARGETS_ID = "md2html-zoom-targets";');
  const mermaidIndex = html.indexOf("/* mermaid stub */");
  expect(zoomIndex !== -1 && zoomIndex < mermaidIndex).toEqual(true);
});

test("ZOOM_JS と zoomTargets の JSON は frontmatter に zoomTargets があるとき注入される", async () => {
  const html = await convert(
    "# h\n\n![a](https://example.com/a.png)\n",
    baseOptions({
      frontmatter: { md2html: { zoomTargets: ["img", "table"] } },
    }),
  );
  expect(html).toContain(
    '<script type="application/json" id="md2html-zoom-targets">["img","table"]</script>',
  );
  expect(html).toContain('const TARGETS_ID = "md2html-zoom-targets";');
  // JSON ブロックは zoom.js より前に置かれる。
  expect(
    html.indexOf('<script type="application/json" id="md2html-zoom-targets">') <
      html.indexOf('const TARGETS_ID = "md2html-zoom-targets";'),
  ).toEqual(true);
});

test("zoomTargets の JSON は < > & をエスケープし script を早期終了させない", async () => {
  const html = await convert(
    "# h\n",
    baseOptions({
      frontmatter: { md2html: { zoomTargets: ["</script><b>&"] } },
    }),
  );
  expect(html).toContain(
    'id="md2html-zoom-targets">["\\u003c/script\\u003e\\u003cb\\u003e\\u0026"]</script>',
  );
  expect(html.includes("</script><b>")).toEqual(false);
});

test("mermaid も画像も無く zoomTargets の指定も無ければ ZOOM_JS は注入されない", async () => {
  const html = await convert("# h\n\n本文\n", baseOptions());
  expect(html.includes('const TARGETS_ID = "md2html-zoom-targets";')).toEqual(
    false,
  );
  expect(
    html.includes('<script type="application/json" id="md2html-zoom-targets">'),
  ).toEqual(false);
});

test("画像があれば既定の zoomTargets (img) で ZOOM_JS と JSON が注入される", async () => {
  const html = await convert(
    "# h\n\n![a](https://example.com/a.png)\n",
    baseOptions(),
  );
  expect(html).toContain('const TARGETS_ID = "md2html-zoom-targets";');
  expect(html).toContain(DEFAULT_ZOOM_TARGETS_JSON);
});

test("画像がプレースホルダに置換された場合は既定の zoomTargets では注入されない", async () => {
  const html = await convert(
    "# h\n\n![a](./missing.png)\n",
    baseOptions({ resolveImage: () => Promise.resolve(null) }),
  );
  expect(html.includes('const TARGETS_ID = "md2html-zoom-targets";')).toEqual(
    false,
  );
});

test("zoomTargets に空配列を明示すると mermaid があっても JSON は出ない (mermaid のみ対象)", async () => {
  const html = await convert(
    "```mermaid\ngraph TD\n  A --> B\n```\n\n![a](https://example.com/a.png)\n",
    baseOptions({ frontmatter: { md2html: { zoomTargets: [] } } }),
  );
  expect(html).toContain('const TARGETS_ID = "md2html-zoom-targets";');
  expect(
    html.includes('<script type="application/json" id="md2html-zoom-targets">'),
  ).toEqual(false);
});

test("zoomTargets に空配列を明示し mermaid も無ければ ZOOM_JS は注入されない", async () => {
  const html = await convert(
    "# h\n\n![a](https://example.com/a.png)\n",
    baseOptions({ frontmatter: { md2html: { zoomTargets: [] } } }),
  );
  expect(html.includes('const TARGETS_ID = "md2html-zoom-targets";')).toEqual(
    false,
  );
});

test("ユーザ CSS は MARKDOWN_THEME_CSS の後ろに連結される", async () => {
  const userCss = "body { color: rebeccapurple; }";
  const html = await convert("# hello\n", baseOptions({ css: userCss }));
  expect(html).toContain(userCss);
  const themeIndex = html.indexOf("--accent:");
  const userIndex = html.indexOf(userCss);
  expect(themeIndex !== -1 && themeIndex < userIndex).toEqual(true);
  // どちらも同じ <style> の中に入る。
  expect(userIndex < html.indexOf("</style>")).toEqual(true);
});

test("ユーザ CSS の </style> はエスケープされ style を早期終了させない", async () => {
  const html = await convert(
    "# hello\n",
    baseOptions({ css: "body{color:red}</style><script>alert(1)</script>" }),
  );
  // style 要素の中身は `</style` までが raw text なので、閉じ側だけを潰せばよい。
  expect(html).toContain("body{color:red}<\\/style>");
  expect(html.includes("body{color:red}</style>")).toEqual(false);
});

test("テーマ CSS 側も </style> のエスケープ対象になる", async () => {
  const html = await convert(
    "# hello\n",
    baseOptions({ css: "/* </STYLE> */" }),
  );
  // 大文字小文字を問わず潰す。
  expect(html).toContain("/* <\\/STYLE> */");
  // 出力に残る生の </style> は style 要素の閉じタグだけ。
  expect(html.split("</style>").length - 1).toEqual(1);
});

test("mermaid bundle の </script> はエスケープされ script を早期終了させない", async () => {
  const html = await convert(
    "```mermaid\ngraph TD\n  A --> B\n```\n",
    baseOptions({ getMermaidJs: () => Promise.resolve("a</script>b") }),
  );
  expect(html).toContain("<script>a<\\/script>b</script>");
});

test("html lang は既定で ja、lang オプションで上書きできる", async () => {
  const defaulted = await convert("# hello\n", baseOptions());
  expect(defaulted).toContain('<html lang="ja">');

  const overridden = await convert("# hello\n", baseOptions({ lang: "en" }));
  expect(overridden).toContain('<html lang="en">');
  expect(overridden.includes('<html lang="ja">')).toEqual(false);
});

test("lang は HTML エスケープされる", async () => {
  const html = await convert("# hello\n", baseOptions({ lang: 'en"><x' }));
  expect(html).toContain('<html lang="en&quot;&gt;&lt;x">');
});

test("labels 未指定なら日本語の既定文言が使われる", async () => {
  const html = await convert(
    "## 見出し\n\n```ts\nconst x = 1;\n```\n\n![a](./missing.png)\n",
    baseOptions(),
  );
  expect(html).toContain(">コピー</button>");
  expect(html).toContain('aria-label="目次"');
  expect(html).toContain('<div class="img-ph">a（画像プレースホルダ）</div>');
});

test("labels でコピー・目次・画像プレースホルダの文言を上書きできる", async () => {
  const html = await convert(
    "## Heading\n\n```ts\nconst x = 1;\n```\n\n![alt](./missing.png)\n\n![](./missing2.png)\n",
    baseOptions({
      labels: {
        copy: "Copy",
        toc: "Table of contents",
        image: "Image",
        imagePlaceholder: "{name} (missing image)",
      },
    }),
  );
  expect(html).toContain(">Copy</button>");
  expect(html).toContain('aria-label="Table of contents"');
  expect(html).toContain('<div class="img-ph">alt (missing image)</div>');
  expect(html).toContain('<div class="img-ph">Image (missing image)</div>');
  expect(html.includes("コピー</button>")).toEqual(false);
});

test("labels の一部だけ上書きしても他は既定のまま", async () => {
  const html = await convert(
    "## 見出し\n\n```ts\nconst x = 1;\n```\n",
    baseOptions({ labels: { copy: "Copy" } }),
  );
  expect(html).toContain(">Copy</button>");
  expect(html).toContain('aria-label="目次"');
});

test("labels の toc は HTML エスケープされる", async () => {
  const html = await convert(
    "## 見出し\n",
    baseOptions({ labels: { toc: 'a"b' } }),
  );
  expect(html).toContain('<aside class="toc" aria-label="a&quot;b">');
});

test("zoom.js 向けの文言を上書きすると JSON が targets/labels 形式になる", async () => {
  const html = await convert(
    "# h\n\n![a](https://example.com/a.png)\n",
    baseOptions({ labels: { figure: "Figure", zoomBadge: "Expand" } }),
  );
  expect(html).toContain(
    '<script type="application/json" id="md2html-zoom-targets">{"targets":["img"],"labels":{"figure":"Figure","zoomBadge":"Expand"}}</script>',
  );
  expect(html).toContain('const TARGETS_ID = "md2html-zoom-targets";');
});

test("zoom.js 向けの文言を上書きしなければ JSON はセレクタの配列のまま", async () => {
  const html = await convert(
    "# h\n\n![a](https://example.com/a.png)\n",
    baseOptions({ labels: { copy: "Copy" } }),
  );
  expect(html).toContain(DEFAULT_ZOOM_TARGETS_JSON);
});

test("zoom.js 向け既定文言は ZOOM_JS 側の既定と一致している", () => {
  // 既定のままのキーは JSON へ載せず zoom.js 側の既定が使われるため、
  // 両者がずれると出力とクライアントの表示が食い違う。
  for (const key of ZOOM_LABEL_KEYS) {
    expect(ZOOM_JS).toContain(`${key}:`);
    expect(ZOOM_JS).toContain(JSON.stringify(DEFAULT_LABELS[key]));
  }
});

test("zoomTargets が空でも文言の上書きがあれば JSON を出す", async () => {
  const html = await convert(
    "```mermaid\ngraph TD\n  A --> B\n```\n",
    baseOptions({
      frontmatter: { md2html: { zoomTargets: [] } },
      labels: { figure: "Figure" },
    }),
  );
  expect(html).toContain(
    '<script type="application/json" id="md2html-zoom-targets">{"targets":[],"labels":{"figure":"Figure"}}</script>',
  );
});
