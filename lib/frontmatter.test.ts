import { expect, test } from "bun:test";
import { parseFrontmatter } from "./frontmatter.ts";

test("frontmatter が無ければ本文はそのまま返る", () => {
  const markdown = "# hello\n\ntext\n";
  const result = parseFrontmatter(markdown);
  expect(result.frontmatter).toEqual({});
  expect(result.body).toEqual(markdown);
});

test("空の frontmatter は空オブジェクトになる", () => {
  const result = parseFrontmatter("---\n---\n# hello\n");
  expect(result.frontmatter).toEqual({});
  expect(result.body).toEqual("# hello\n");
});

test("コメントだけの frontmatter は空として扱いブロックは本文から除く", () => {
  const result = parseFrontmatter("---\n# title: draft\n---\n# Doc\n");
  expect(result.frontmatter).toEqual({});
  expect(result.body).toEqual("# Doc\n");
});

test("title と description を読み取る", () => {
  const result = parseFrontmatter(
    "---\ntitle: Hello\ndescription: Desc text\n---\n# hello\n",
  );
  expect(result.frontmatter).toEqual({
    title: "Hello",
    description: "Desc text",
  });
  expect(result.body).toEqual("# hello\n");
});

test("数値・真偽値・日付は書かれたとおりの文字列になる", () => {
  const result = parseFrontmatter(
    "---\ntitle: 1.10\ndescription: 2024-01-01\n---\nbody\n",
  );
  expect(result.frontmatter).toEqual({
    title: "1.10",
    description: "2024-01-01",
  });
});

test("配列・マッピング・空値は無視される", () => {
  const result = parseFrontmatter(
    "---\ntitle: [a, b]\ndescription:\nother: x\n---\nbody\n",
  );
  expect(result.frontmatter).toEqual({});
});

test("ブロックがマッピングでなければ frontmatter とみなさず本文はそのまま", () => {
  const markdown = "---\njust a string\n---\nbody\n";
  const result = parseFrontmatter(markdown);
  expect(result.frontmatter).toEqual({});
  expect(result.body).toEqual(markdown);
});

test("先頭の水平線と後続の水平線に挟まれた本文を欠落させない", () => {
  const markdown = "---\nSome paragraph\n---\nbody\n";
  const result = parseFrontmatter(markdown);
  expect(result.frontmatter).toEqual({});
  expect(result.body).toEqual(markdown);
});

test("空文字列の title / description は未指定扱い", () => {
  const result = parseFrontmatter(
    "---\ntitle: ''\ndescription: \"\"\n---\nbody\n",
  );
  expect(result.frontmatter).toEqual({});
  expect(result.body).toEqual("body\n");
});

test("クォートとブロックスカラを解釈する", () => {
  const result = parseFrontmatter(
    "---\ntitle: 'Quoted: Title'\ndescription: >\n  first\n  second\n---\nbody\n",
  );
  expect(result.frontmatter).toEqual({
    title: "Quoted: Title",
    description: "first second\n",
  });
});

test("CRLF の frontmatter も解釈できる", () => {
  const result = parseFrontmatter("---\r\ntitle: X\r\n---\r\nbody\r\n");
  expect(result.frontmatter).toEqual({ title: "X" });
  expect(result.body).toEqual("body\r\n");
});

test("本文中の水平線は frontmatter として扱わない", () => {
  const markdown = "# t\n\n---\n\nfoo\n";
  const result = parseFrontmatter(markdown);
  expect(result.frontmatter).toEqual({});
  expect(result.body).toEqual(markdown);
});

test("先頭に空行があると frontmatter とみなさない", () => {
  const markdown = "\n---\ntitle: X\n---\nbody\n";
  const result = parseFrontmatter(markdown);
  expect(result.frontmatter).toEqual({});
  expect(result.body).toEqual(markdown);
});

test("不正な YAML はエラーになる", () => {
  expect(() => parseFrontmatter("---\ntitle: [unclosed\n---\nbody\n")).toThrow(
    "frontmatter の YAML を解析できない",
  );
});

test("md2html.zoomTargets は非空文字列の配列として読み取る", () => {
  const result = parseFrontmatter(
    '---\ntitle: t\nmd2html:\n  zoomTargets:\n    - img\n    - "table"\n---\nbody\n',
  );
  expect(result.frontmatter).toEqual({
    title: "t",
    md2html: { zoomTargets: ["img", "table"] },
  });
});

test("md2html.zoomTargets の非文字列・空文字列の要素は除外される", () => {
  const result = parseFrontmatter(
    '---\nmd2html:\n  zoomTargets:\n    - img\n    - ""\n    - [a]\n    - {k: v}\n---\nbody\n',
  );
  expect(result.frontmatter).toEqual({ md2html: { zoomTargets: ["img"] } });
});

test("md2html.zoomTargets の空配列はそのまま保持する (既定を外す指定)", () => {
  expect(
    parseFrontmatter("---\nmd2html:\n  zoomTargets: []\n---\nbody\n")
      .frontmatter,
  ).toEqual({ md2html: { zoomTargets: [] } });
  // 要素が全て除外されて空になった場合も同じ。
  expect(
    parseFrontmatter('---\nmd2html:\n  zoomTargets:\n    - ""\n---\nbody\n')
      .frontmatter,
  ).toEqual({ md2html: { zoomTargets: [] } });
});

test("md2html.zoomTargets が配列でない・md2html がマッピングでない場合は未設定", () => {
  expect(
    parseFrontmatter("---\nmd2html:\n  zoomTargets: img\n---\nbody\n")
      .frontmatter,
  ).toEqual({});
  expect(
    parseFrontmatter("---\nmd2html: img\n---\nbody\n").frontmatter,
  ).toEqual({});
  expect(
    parseFrontmatter("---\nmd2html:\n  - img\n---\nbody\n").frontmatter,
  ).toEqual({});
});

test("lang を読み取る", () => {
  const result = parseFrontmatter("---\nlang: en\n---\nbody\n");
  expect(result.frontmatter).toEqual({ lang: "en" });
  expect(result.body).toEqual("body\n");
});

test("空文字列・非文字列の lang は未指定扱い", () => {
  expect(parseFrontmatter("---\nlang: ''\n---\nbody\n").frontmatter).toEqual(
    {},
  );
  expect(
    parseFrontmatter("---\nlang: [en, ja]\n---\nbody\n").frontmatter,
  ).toEqual({});
});

test("正しい frontmatter では警告が出ない", () => {
  expect(
    parseFrontmatter(
      "---\ntitle: t\nlang: en\nmd2html:\n  zoomTargets:\n    - img\n---\nbody\n",
    ).warnings,
  ).toEqual([]);
  expect(parseFrontmatter("# hello\n").warnings).toEqual([]);
  expect(parseFrontmatter("---\n---\nbody\n").warnings).toEqual([]);
  // md2html に既知のキーが無い場合は警告しない。
  expect(
    parseFrontmatter("---\nmd2html:\n  other: x\n---\nbody\n").warnings,
  ).toEqual([]);
});

test("値の無い md2html / zoomTargets は未設定として扱い警告しない", () => {
  const empty = parseFrontmatter("---\nmd2html:\n---\nbody\n");
  expect(empty.warnings).toEqual([]);
  expect(empty.frontmatter).toEqual({});

  const emptyTargets = parseFrontmatter(
    "---\nmd2html:\n  zoomTargets:\n---\nbody\n",
  );
  expect(emptyTargets.warnings).toEqual([]);
  expect(emptyTargets.frontmatter).toEqual({});
});

test("md2html がマッピングでなければ警告する", () => {
  expect(parseFrontmatter("---\nmd2html: img\n---\nbody\n").warnings).toEqual([
    "frontmatter の md2html はマッピングでないため無視した",
  ]);
  expect(
    parseFrontmatter("---\nmd2html:\n  - img\n---\nbody\n").warnings,
  ).toEqual(["frontmatter の md2html はマッピングでないため無視した"]);
});

test("md2html.zoomTargets が配列でなければ警告する", () => {
  expect(
    parseFrontmatter("---\nmd2html:\n  zoomTargets: img\n---\nbody\n").warnings,
  ).toEqual(["frontmatter の md2html.zoomTargets は配列でないため無視した"]);
});

test("md2html.mermaid.version は文字列として読み取る", () => {
  const result = parseFrontmatter(
    "---\nmd2html:\n  mermaid:\n    version: 11.16.0\n---\nbody\n",
  );
  expect(result.frontmatter).toEqual({
    md2html: { mermaid: { version: "11.16.0" } },
  });
  expect(result.warnings).toEqual([]);

  const latest = parseFrontmatter(
    "---\nmd2html:\n  mermaid:\n    version: latest\n---\nbody\n",
  );
  expect(latest.frontmatter).toEqual({
    md2html: { mermaid: { version: "latest" } },
  });
});

test("md2html.zoomTargets と md2html.mermaid.version を併記すると両方入る", () => {
  const result = parseFrontmatter(
    "---\nmd2html:\n  zoomTargets:\n    - img\n  mermaid:\n    version: 11.16.0\n---\nbody\n",
  );
  expect(result.frontmatter).toEqual({
    md2html: { zoomTargets: ["img"], mermaid: { version: "11.16.0" } },
  });
});

test("値の無い md2html.mermaid / mermaid.version は未設定として扱い警告しない", () => {
  const noMermaid = parseFrontmatter("---\nmd2html:\n  mermaid:\n---\nbody\n");
  expect(noMermaid.frontmatter).toEqual({});
  expect(noMermaid.warnings).toEqual([]);

  const noVersion = parseFrontmatter(
    "---\nmd2html:\n  mermaid:\n    version:\n---\nbody\n",
  );
  expect(noVersion.frontmatter).toEqual({});
  expect(noVersion.warnings).toEqual([]);

  const emptyVersion = parseFrontmatter(
    '---\nmd2html:\n  mermaid:\n    version: ""\n---\nbody\n',
  );
  expect(emptyVersion.frontmatter).toEqual({});
  expect(emptyVersion.warnings).toEqual([]);
});

test("md2html.mermaid がマッピングでなければ警告する", () => {
  expect(
    parseFrontmatter("---\nmd2html:\n  mermaid: 11.16.0\n---\nbody\n").warnings,
  ).toEqual(["frontmatter の md2html.mermaid はマッピングでないため無視した"]);
  expect(
    parseFrontmatter("---\nmd2html:\n  mermaid: 11.16.0\n---\nbody\n")
      .frontmatter,
  ).toEqual({});
  expect(
    parseFrontmatter("---\nmd2html:\n  mermaid:\n    - 11.16.0\n---\nbody\n")
      .warnings,
  ).toEqual(["frontmatter の md2html.mermaid はマッピングでないため無視した"]);
  expect(
    parseFrontmatter("---\nmd2html:\n  mermaid:\n    - 11.16.0\n---\nbody\n")
      .frontmatter,
  ).toEqual({});
});

test("md2html.mermaid.version が文字列でなければ警告する", () => {
  const result = parseFrontmatter(
    "---\nmd2html:\n  mermaid:\n    version:\n      - 11.16.0\n---\nbody\n",
  );
  expect(result.warnings).toEqual([
    "frontmatter の md2html.mermaid.version は文字列でないため無視した",
  ]);
  expect(result.frontmatter).toEqual({});
});

test("md2html.zoomTargets から要素が除外されたら件数を警告する", () => {
  expect(
    parseFrontmatter(
      '---\nmd2html:\n  zoomTargets:\n    - img\n    - ""\n    - [a]\n---\nbody\n',
    ).warnings,
  ).toEqual([
    "frontmatter の md2html.zoomTargets の 2 件は非空の文字列でないため除外した",
  ]);
  // 全て除外されて空配列になる場合も警告する。
  expect(
    parseFrontmatter('---\nmd2html:\n  zoomTargets:\n    - ""\n---\nbody\n')
      .warnings,
  ).toEqual([
    "frontmatter の md2html.zoomTargets の 1 件は非空の文字列でないため除外した",
  ]);
  // 明示的な空配列は指定として正しいため警告しない。
  expect(
    parseFrontmatter("---\nmd2html:\n  zoomTargets: []\n---\nbody\n").warnings,
  ).toEqual([]);
});

test("UTF-8 BOM 付きの入力でも frontmatter を認識し、本文に BOM を残さない", () => {
  const result = parseFrontmatter("\uFEFF---\ntitle: T\n---\n# body\n");
  expect(result.frontmatter.title).toEqual("T");
  expect(result.body).toEqual("# body\n");
});

test("開き行・閉じ行の末尾空白を許容する", () => {
  const result = parseFrontmatter("--- \ntitle: T\n---\t\n# body\n");
  expect(result.frontmatter.title).toEqual("T");
  expect(result.body).toEqual("# body\n");
});

test("閉じ行に `...` も使える", () => {
  const result = parseFrontmatter("---\ntitle: T\n...\n# body\n");
  expect(result.frontmatter.title).toEqual("T");
  expect(result.body).toEqual("# body\n");
});
