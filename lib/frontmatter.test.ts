import { assertEquals, assertThrows } from "@std/assert";
import { parseFrontmatter } from "./frontmatter.ts";

Deno.test("frontmatter が無ければ本文はそのまま返る", () => {
  const markdown = "# hello\n\ntext\n";
  const result = parseFrontmatter(markdown);
  assertEquals(result.frontmatter, {});
  assertEquals(result.body, markdown);
});

Deno.test("空の frontmatter は空オブジェクトになる", () => {
  const result = parseFrontmatter("---\n---\n# hello\n");
  assertEquals(result.frontmatter, {});
  assertEquals(result.body, "# hello\n");
});

Deno.test("コメントだけの frontmatter は空として扱いブロックは本文から除く", () => {
  const result = parseFrontmatter("---\n# title: draft\n---\n# Doc\n");
  assertEquals(result.frontmatter, {});
  assertEquals(result.body, "# Doc\n");
});

Deno.test("title と description を読み取る", () => {
  const result = parseFrontmatter(
    "---\ntitle: Hello\ndescription: Desc text\n---\n# hello\n",
  );
  assertEquals(result.frontmatter, {
    title: "Hello",
    description: "Desc text",
  });
  assertEquals(result.body, "# hello\n");
});

Deno.test("数値・真偽値・日付は書かれたとおりの文字列になる", () => {
  const result = parseFrontmatter(
    "---\ntitle: 1.10\ndescription: 2024-01-01\n---\nbody\n",
  );
  assertEquals(result.frontmatter, {
    title: "1.10",
    description: "2024-01-01",
  });
});

Deno.test("配列・マッピング・空値は無視される", () => {
  const result = parseFrontmatter(
    "---\ntitle: [a, b]\ndescription:\nother: x\n---\nbody\n",
  );
  assertEquals(result.frontmatter, {});
});

Deno.test("ブロックがマッピングでなければ frontmatter とみなさず本文はそのまま", () => {
  const markdown = "---\njust a string\n---\nbody\n";
  const result = parseFrontmatter(markdown);
  assertEquals(result.frontmatter, {});
  assertEquals(result.body, markdown);
});

Deno.test("先頭の水平線と後続の水平線に挟まれた本文を欠落させない", () => {
  const markdown = "---\nSome paragraph\n---\nbody\n";
  const result = parseFrontmatter(markdown);
  assertEquals(result.frontmatter, {});
  assertEquals(result.body, markdown);
});

Deno.test("空文字列の title / description は未指定扱い", () => {
  const result = parseFrontmatter(
    "---\ntitle: ''\ndescription: \"\"\n---\nbody\n",
  );
  assertEquals(result.frontmatter, {});
  assertEquals(result.body, "body\n");
});

Deno.test("クォートとブロックスカラを解釈する", () => {
  const result = parseFrontmatter(
    "---\ntitle: 'Quoted: Title'\ndescription: >\n  first\n  second\n---\nbody\n",
  );
  assertEquals(result.frontmatter, {
    title: "Quoted: Title",
    description: "first second\n",
  });
});

Deno.test("CRLF の frontmatter も解釈できる", () => {
  const result = parseFrontmatter("---\r\ntitle: X\r\n---\r\nbody\r\n");
  assertEquals(result.frontmatter, { title: "X" });
  assertEquals(result.body, "body\r\n");
});

Deno.test("本文中の水平線は frontmatter として扱わない", () => {
  const markdown = "# t\n\n---\n\nfoo\n";
  const result = parseFrontmatter(markdown);
  assertEquals(result.frontmatter, {});
  assertEquals(result.body, markdown);
});

Deno.test("先頭に空行があると frontmatter とみなさない", () => {
  const markdown = "\n---\ntitle: X\n---\nbody\n";
  const result = parseFrontmatter(markdown);
  assertEquals(result.frontmatter, {});
  assertEquals(result.body, markdown);
});

Deno.test("不正な YAML はエラーになる", () => {
  assertThrows(
    () => parseFrontmatter("---\ntitle: [unclosed\n---\nbody\n"),
    Error,
    "frontmatter の YAML を解析できない",
  );
});

Deno.test("md2html.zoomTargets は非空文字列の配列として読み取る", () => {
  const result = parseFrontmatter(
    '---\ntitle: t\nmd2html:\n  zoomTargets:\n    - img\n    - "table"\n---\nbody\n',
  );
  assertEquals(result.frontmatter, {
    title: "t",
    md2html: { zoomTargets: ["img", "table"] },
  });
});

Deno.test("md2html.zoomTargets の非文字列・空文字列の要素は除外される", () => {
  const result = parseFrontmatter(
    '---\nmd2html:\n  zoomTargets:\n    - img\n    - ""\n    - [a]\n    - {k: v}\n---\nbody\n',
  );
  assertEquals(result.frontmatter, { md2html: { zoomTargets: ["img"] } });
});

Deno.test("md2html.zoomTargets の空配列はそのまま保持する (既定を外す指定)", () => {
  assertEquals(
    parseFrontmatter("---\nmd2html:\n  zoomTargets: []\n---\nbody\n")
      .frontmatter,
    { md2html: { zoomTargets: [] } },
  );
  // 要素が全て除外されて空になった場合も同じ。
  assertEquals(
    parseFrontmatter('---\nmd2html:\n  zoomTargets:\n    - ""\n---\nbody\n')
      .frontmatter,
    { md2html: { zoomTargets: [] } },
  );
});

Deno.test("md2html.zoomTargets が配列でない・md2html がマッピングでない場合は未設定", () => {
  assertEquals(
    parseFrontmatter("---\nmd2html:\n  zoomTargets: img\n---\nbody\n")
      .frontmatter,
    {},
  );
  assertEquals(
    parseFrontmatter("---\nmd2html: img\n---\nbody\n").frontmatter,
    {},
  );
  assertEquals(
    parseFrontmatter("---\nmd2html:\n  - img\n---\nbody\n").frontmatter,
    {},
  );
});

Deno.test("lang を読み取る", () => {
  const result = parseFrontmatter("---\nlang: en\n---\nbody\n");
  assertEquals(result.frontmatter, { lang: "en" });
  assertEquals(result.body, "body\n");
});

Deno.test("空文字列・非文字列の lang は未指定扱い", () => {
  assertEquals(
    parseFrontmatter("---\nlang: ''\n---\nbody\n").frontmatter,
    {},
  );
  assertEquals(
    parseFrontmatter("---\nlang: [en, ja]\n---\nbody\n").frontmatter,
    {},
  );
});

Deno.test("正しい frontmatter では警告が出ない", () => {
  assertEquals(
    parseFrontmatter(
      "---\ntitle: t\nlang: en\nmd2html:\n  zoomTargets:\n    - img\n---\nbody\n",
    ).warnings,
    [],
  );
  assertEquals(parseFrontmatter("# hello\n").warnings, []);
  assertEquals(parseFrontmatter("---\n---\nbody\n").warnings, []);
  // md2html に既知のキーが無い場合は警告しない。
  assertEquals(
    parseFrontmatter("---\nmd2html:\n  other: x\n---\nbody\n").warnings,
    [],
  );
});

Deno.test("値の無い md2html / zoomTargets は未設定として扱い警告しない", () => {
  const empty = parseFrontmatter("---\nmd2html:\n---\nbody\n");
  assertEquals(empty.warnings, []);
  assertEquals(empty.frontmatter, {});

  const emptyTargets = parseFrontmatter(
    "---\nmd2html:\n  zoomTargets:\n---\nbody\n",
  );
  assertEquals(emptyTargets.warnings, []);
  assertEquals(emptyTargets.frontmatter, {});
});

Deno.test("md2html がマッピングでなければ警告する", () => {
  assertEquals(
    parseFrontmatter("---\nmd2html: img\n---\nbody\n").warnings,
    ["frontmatter の md2html はマッピングでないため無視した"],
  );
  assertEquals(
    parseFrontmatter("---\nmd2html:\n  - img\n---\nbody\n").warnings,
    ["frontmatter の md2html はマッピングでないため無視した"],
  );
});

Deno.test("md2html.zoomTargets が配列でなければ警告する", () => {
  assertEquals(
    parseFrontmatter("---\nmd2html:\n  zoomTargets: img\n---\nbody\n").warnings,
    ["frontmatter の md2html.zoomTargets は配列でないため無視した"],
  );
});

Deno.test("md2html.mermaid.version は文字列として読み取る", () => {
  const result = parseFrontmatter(
    "---\nmd2html:\n  mermaid:\n    version: 11.16.0\n---\nbody\n",
  );
  assertEquals(result.frontmatter, {
    md2html: { mermaid: { version: "11.16.0" } },
  });
  assertEquals(result.warnings, []);

  const latest = parseFrontmatter(
    "---\nmd2html:\n  mermaid:\n    version: latest\n---\nbody\n",
  );
  assertEquals(latest.frontmatter, {
    md2html: { mermaid: { version: "latest" } },
  });
});

Deno.test("md2html.zoomTargets と md2html.mermaid.version を併記すると両方入る", () => {
  const result = parseFrontmatter(
    "---\nmd2html:\n  zoomTargets:\n    - img\n  mermaid:\n    version: 11.16.0\n---\nbody\n",
  );
  assertEquals(result.frontmatter, {
    md2html: { zoomTargets: ["img"], mermaid: { version: "11.16.0" } },
  });
});

Deno.test("値の無い md2html.mermaid / mermaid.version は未設定として扱い警告しない", () => {
  const noMermaid = parseFrontmatter("---\nmd2html:\n  mermaid:\n---\nbody\n");
  assertEquals(noMermaid.frontmatter, {});
  assertEquals(noMermaid.warnings, []);

  const noVersion = parseFrontmatter(
    "---\nmd2html:\n  mermaid:\n    version:\n---\nbody\n",
  );
  assertEquals(noVersion.frontmatter, {});
  assertEquals(noVersion.warnings, []);

  const emptyVersion = parseFrontmatter(
    '---\nmd2html:\n  mermaid:\n    version: ""\n---\nbody\n',
  );
  assertEquals(emptyVersion.frontmatter, {});
  assertEquals(emptyVersion.warnings, []);
});

Deno.test("md2html.mermaid がマッピングでなければ警告する", () => {
  assertEquals(
    parseFrontmatter("---\nmd2html:\n  mermaid: 11.16.0\n---\nbody\n")
      .warnings,
    ["frontmatter の md2html.mermaid はマッピングでないため無視した"],
  );
  assertEquals(
    parseFrontmatter("---\nmd2html:\n  mermaid: 11.16.0\n---\nbody\n")
      .frontmatter,
    {},
  );
  assertEquals(
    parseFrontmatter(
      "---\nmd2html:\n  mermaid:\n    - 11.16.0\n---\nbody\n",
    ).warnings,
    ["frontmatter の md2html.mermaid はマッピングでないため無視した"],
  );
  assertEquals(
    parseFrontmatter(
      "---\nmd2html:\n  mermaid:\n    - 11.16.0\n---\nbody\n",
    ).frontmatter,
    {},
  );
});

Deno.test("md2html.mermaid.version が文字列でなければ警告する", () => {
  const result = parseFrontmatter(
    "---\nmd2html:\n  mermaid:\n    version:\n      - 11.16.0\n---\nbody\n",
  );
  assertEquals(result.warnings, [
    "frontmatter の md2html.mermaid.version は文字列でないため無視した",
  ]);
  assertEquals(result.frontmatter, {});
});

Deno.test("md2html.zoomTargets から要素が除外されたら件数を警告する", () => {
  assertEquals(
    parseFrontmatter(
      '---\nmd2html:\n  zoomTargets:\n    - img\n    - ""\n    - [a]\n---\nbody\n',
    ).warnings,
    ["frontmatter の md2html.zoomTargets の 2 件は非空の文字列でないため除外した"],
  );
  // 全て除外されて空配列になる場合も警告する。
  assertEquals(
    parseFrontmatter('---\nmd2html:\n  zoomTargets:\n    - ""\n---\nbody\n')
      .warnings,
    ["frontmatter の md2html.zoomTargets の 1 件は非空の文字列でないため除外した"],
  );
  // 明示的な空配列は指定として正しいため警告しない。
  assertEquals(
    parseFrontmatter("---\nmd2html:\n  zoomTargets: []\n---\nbody\n").warnings,
    [],
  );
});
