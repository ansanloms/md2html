// CLI (md2html.ts) のスモークテスト。
//
// 変換ロジックそのものは lib/convert.test.ts が検証するので、ここでは CLI の
// 引数解釈・終了コード・stdin 入力といった実行時の振る舞いだけを見る。
// mermaid ブロックは含めない (含めると子プロセスが `deno bundle` を走らせる)。

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl } from "@std/path";

const CLI_PATH = fromFileUrl(new URL("./md2html.ts", import.meta.url));
const REPO_ROOT = dirname(CLI_PATH);

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** md2html.ts を子プロセスとして実行する。stdin を渡すとパイプ入力になる。 */
async function runCli(args: string[], stdin?: string): Promise<CliResult> {
  const child = new Deno.Command("deno", {
    args: ["run", "--quiet", "--allow-all", CLI_PATH, ...args],
    cwd: REPO_ROOT,
    stdin: stdin === undefined ? "null" : "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  if (stdin !== undefined) {
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(stdin));
    await writer.close();
  }

  const { code, stdout, stderr } = await child.output();
  const decoder = new TextDecoder();
  return {
    code,
    stdout: decoder.decode(stdout),
    stderr: decoder.decode(stderr),
  };
}

/**
 * shebang 行 (`#!/usr/bin/env -S deno run ...`) が指定している deno のフラグを読む。
 * 配布形態の権限セットをテストから直接使うためのもので、ここが実際の実行時権限になる。
 */
async function shebangDenoFlags(): Promise<string[]> {
  const firstLine = (await Deno.readTextFile(CLI_PATH)).split("\n")[0];
  const tokens = firstLine.replace(/^#!\s*/, "").split(/\s+/);
  const runAt = tokens.indexOf("run");
  assert(runAt !== -1, `shebang に deno run が無い: ${firstLine}`);
  return tokens.slice(runAt + 1);
}

const SIMPLE_MARKDOWN = `# 見出し

本文。

## セクション

- a
- b
`;

Deno.test("--help は使い方を stdout に出して 0 で終わる", async () => {
  const { code, stdout } = await runCli(["--help"]);
  assertEquals(code, 0);
  assertStringIncludes(stdout, "使い方: md2html");
  assertStringIncludes(stdout, "--version");
});

Deno.test("--version は deno.json の version を stdout に出して 0 で終わる", async () => {
  const { code, stdout } = await runCli(["--version"]);
  assertEquals(code, 0);
  assertEquals(stdout.trim(), "0.1.0");
});

Deno.test("未知のオプションはエラーになる", async () => {
  const { code, stderr } = await runCli(["--bogus", "x", "input.md"]);
  assertEquals(code, 1);
  assertStringIncludes(stderr, "不明なオプション: --bogus");
  assertStringIncludes(stderr, "使い方: md2html");
});

Deno.test("存在しない入力ファイルはエラーになる", async () => {
  const { code, stderr } = await runCli(["does-not-exist-4f2a.md"]);
  assertEquals(code, 1);
  assertStringIncludes(stderr, "入力ファイルを読み込めない");
});

Deno.test("位置引数が 2 つ以上あるとエラーになる", async () => {
  const { code, stderr } = await runCli(["a.md", "b.md"]);
  assertEquals(code, 1);
  assertStringIncludes(stderr, "入力ファイルは 1 つだけ");
});

Deno.test("--output に値が無いとエラーになる", async () => {
  const { code, stderr } = await runCli(["a.md", "--output"]);
  assertEquals(code, 1);
  assertStringIncludes(stderr, "--output にパスを指定してください");
});

Deno.test("--css に値が無いとエラーになる", async () => {
  const { code, stderr } = await runCli(["a.md", "--css"]);
  assertEquals(code, 1);
  assertStringIncludes(stderr, "--css にパスを指定してください");
});

Deno.test("位置引数を省略すると stdin から読む", async () => {
  const { code, stdout } = await runCli([], SIMPLE_MARKDOWN);
  assertEquals(code, 0);
  assertStringIncludes(stdout, "<title>md2html</title>");
  assertStringIncludes(stdout, "見出し");
  assert(!stdout.includes('<pre class="mermaid"'));
});

Deno.test('位置引数 "-" は stdin から読む', async () => {
  const { code, stdout } = await runCli(["-"], SIMPLE_MARKDOWN);
  assertEquals(code, 0);
  assertStringIncludes(stdout, "<title>md2html</title>");
});

Deno.test("stdin 入力でも frontmatter の title を使う", async () => {
  const markdown = `---
title: fm-title
---

# 見出し
`;
  const { code, stdout } = await runCli(["-"], markdown);
  assertEquals(code, 0);
  assertStringIncludes(stdout, "<title>fm-title</title>");
});

Deno.test("--title は frontmatter の title より優先される", async () => {
  const markdown = `---
title: fm-title
---

# 見出し
`;
  const { code, stdout } = await runCli(
    ["--title", "cli-title", "-"],
    markdown,
  );
  assertEquals(code, 0);
  assertStringIncludes(stdout, "<title>cli-title</title>");
});

Deno.test("空文字列の位置引数はエラーになる", async () => {
  const { code, stderr } = await runCli([""], SIMPLE_MARKDOWN);
  assertEquals(code, 1);
  assertStringIncludes(stderr, "入力ファイルのパスが空です");
});

Deno.test("短縮フラグの塊でも不明なオプションは 1 回だけ報告される", async () => {
  const { code, stderr } = await runCli(["-xy", "a.md"]);
  assertEquals(code, 1);
  assertStringIncludes(stderr, "不明なオプション: -xy\n");
});

Deno.test("shebang の権限セットだけで変換できる", async () => {
  const child = new Deno.Command("deno", {
    args: ["run", ...(await shebangDenoFlags()), CLI_PATH, "-"],
    cwd: REPO_ROOT,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(SIMPLE_MARKDOWN));
  await writer.close();

  const { code, stdout, stderr } = await child.output();
  const decoder = new TextDecoder();
  assertEquals(code, 0, decoder.decode(stderr));
  assertStringIncludes(decoder.decode(stdout), "<title>md2html</title>");
});

Deno.test('--title "" は未指定扱いになる', async () => {
  const markdown = `---
title: fm-title
---

# 見出し
`;
  const { code, stdout } = await runCli(["--title", "", "-"], markdown);
  assertEquals(code, 0);
  assertStringIncludes(stdout, "<title>fm-title</title>");
});
