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

Deno.test("md2html.zoomTargets が配列でない・空配列・md2html がマッピングでない場合は未設定", () => {
  assertEquals(
    parseFrontmatter("---\nmd2html:\n  zoomTargets: img\n---\nbody\n")
      .frontmatter,
    {},
  );
  assertEquals(
    parseFrontmatter("---\nmd2html:\n  zoomTargets: []\n---\nbody\n")
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
