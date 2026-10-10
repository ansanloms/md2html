// CLI (cli.ts) のスモークテスト。
//
// 変換ロジックそのものは lib/convert.test.ts が検証するので、ここでは CLI の
// 引数解釈・終了コード・stdin 入力といった実行時の振る舞いだけを見る。
// mermaid ブロックは含めない (含めると子プロセスが jsdelivr へ取得に行く)。

import { expect, test } from "bun:test";
import { dirname } from "node:path";
import { type CliDeps, main } from "./cli.ts";
import { MERMAID_VERSION } from "./lib/mermaid.ts";

const CLI_PATH = new URL("./cli.ts", import.meta.url).pathname;
const REPO_ROOT = dirname(CLI_PATH);

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** cli.ts を子プロセスとして実行する。stdin を渡すとパイプ入力になる。 */
async function runCli(args: string[], stdin?: string): Promise<CliResult> {
  const proc = Bun.spawn(["bun", "run", CLI_PATH, ...args], {
    cwd: REPO_ROOT,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  if (stdin !== undefined) {
    proc.stdin.write(stdin);
  }
  proc.stdin.end();

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

const SIMPLE_MARKDOWN = `# 見出し

本文。

## セクション

- a
- b
`;

test("--help は使い方を stdout に出して 0 で終わる", async () => {
  const { code, stdout } = await runCli(["--help"]);
  expect(code).toEqual(0);
  expect(stdout).toContain("使い方: md2html");
  expect(stdout).toContain("--version");
  expect(stdout).toContain("--mermaid-version");
});

test("--version は package.json の version を stdout に出して 0 で終わる", async () => {
  const { code, stdout } = await runCli(["--version"]);
  expect(code).toEqual(0);
  expect(stdout.trim()).toEqual("0.1.0");
});

test("未知のオプションはエラーになる", async () => {
  const { code, stderr } = await runCli(["--bogus", "x", "input.md"]);
  expect(code).toEqual(1);
  expect(stderr).toContain("不明なオプション: --bogus");
  expect(stderr).toContain("使い方: md2html");
});

test("存在しない入力ファイルはエラーになる", async () => {
  const { code, stderr } = await runCli(["does-not-exist-4f2a.md"]);
  expect(code).toEqual(1);
  expect(stderr).toContain("入力ファイルを読み込めない");
});

test("位置引数が 2 つ以上あるとエラーになる", async () => {
  const { code, stderr } = await runCli(["a.md", "b.md"]);
  expect(code).toEqual(1);
  expect(stderr).toContain("入力ファイルは 1 つだけ");
});

test("--output に値が無いとエラーになる", async () => {
  const { code, stderr } = await runCli(["a.md", "--output"]);
  expect(code).toEqual(1);
  expect(stderr).toContain("--output にパスを指定してください");
});

test("--css に値が無いとエラーになる", async () => {
  const { code, stderr } = await runCli(["a.md", "--css"]);
  expect(code).toEqual(1);
  expect(stderr).toContain("--css にパスを指定してください");
});

test("位置引数を省略すると stdin から読む", async () => {
  const { code, stdout } = await runCli([], SIMPLE_MARKDOWN);
  expect(code).toEqual(0);
  expect(stdout).toContain("<title>md2html</title>");
  expect(stdout).toContain("見出し");
  expect(!stdout.includes('<pre class="mermaid"')).toBe(true);
});

test('位置引数 "-" は stdin から読む', async () => {
  const { code, stdout } = await runCli(["-"], SIMPLE_MARKDOWN);
  expect(code).toEqual(0);
  expect(stdout).toContain("<title>md2html</title>");
});

test("stdin 入力でも frontmatter の title を使う", async () => {
  const markdown = `---
title: fm-title
---

# 見出し
`;
  const { code, stdout } = await runCli(["-"], markdown);
  expect(code).toEqual(0);
  expect(stdout).toContain("<title>fm-title</title>");
});

test("--title は frontmatter の title より優先される", async () => {
  const markdown = `---
title: fm-title
---

# 見出し
`;
  const { code, stdout } = await runCli(
    ["--title", "cli-title", "-"],
    markdown,
  );
  expect(code).toEqual(0);
  expect(stdout).toContain("<title>cli-title</title>");
});

test("空文字列の位置引数はエラーになる", async () => {
  const { code, stderr } = await runCli([""], SIMPLE_MARKDOWN);
  expect(code).toEqual(1);
  expect(stderr).toContain("入力ファイルのパスが空です");
});

test("短縮フラグの塊でも不明なオプションは 1 回だけ報告される", async () => {
  const { code, stderr } = await runCli(["-xy", "a.md"]);
  expect(code).toEqual(1);
  expect(stderr).toContain("不明なオプション: -xy\n");
});

test('--title "" は未指定扱いになる', async () => {
  const markdown = `---
title: fm-title
---

# 見出し
`;
  const { code, stdout } = await runCli(["--title", "", "-"], markdown);
  expect(code).toEqual(0);
  expect(stdout).toContain("<title>fm-title</title>");
});

test("lang の指定が無ければ html lang は ja になる", async () => {
  const { code, stdout } = await runCli(["-"], SIMPLE_MARKDOWN);
  expect(code).toEqual(0);
  expect(stdout).toContain('<html lang="ja">');
});

test("stdin 入力でも frontmatter の lang が html lang に反映される", async () => {
  const markdown = `---
lang: en
---

# 見出し
`;
  const { code, stdout } = await runCli(["-"], markdown);
  expect(code).toEqual(0);
  expect(stdout).toContain('<html lang="en">');
});

test("--lang は frontmatter の lang より優先される", async () => {
  const markdown = `---
lang: en
---

# 見出し
`;
  const { code, stdout } = await runCli(["--lang", "fr", "-"], markdown);
  expect(code).toEqual(0);
  expect(stdout).toContain('<html lang="fr">');
});

test('--lang "" は未指定扱いになる', async () => {
  const markdown = `---
lang: en
---

# 見出し
`;
  const { code, stdout } = await runCli(["--lang", "", "-"], markdown);
  expect(code).toEqual(0);
  expect(stdout).toContain('<html lang="en">');
});

test("frontmatter の md2html が不正なら stderr へ警告を出しつつ変換は続ける", async () => {
  const markdown = `---
md2html: img
---

# 見出し
`;
  const { code, stdout, stderr } = await runCli(["-"], markdown);
  expect(code).toEqual(0);
  expect(stderr).toContain(
    "md2html: frontmatter の md2html はマッピングでないため無視した",
  );
  expect(stdout).toContain("<h1");
});

test("--mermaid-version の形式が不正なら exit 1 で指定元を含むエラーになる", async () => {
  const { code, stderr } = await runCli(
    ["--mermaid-version", "../x", "-"],
    SIMPLE_MARKDOWN,
  );
  expect(code).toEqual(1);
  expect(stderr).toContain(
    'mermaid のバージョン指定 "../x" (--mermaid-version) の形式が不正です',
  );
});

test("frontmatter の md2html.mermaid.version の形式が不正なら exit 1 になる", async () => {
  const markdown = `---
md2html:
  mermaid:
    version: "^11"
---

# 見出し
`;
  const { code, stderr } = await runCli(["-"], markdown);
  expect(code).toEqual(1);
  expect(stderr).toContain("(frontmatter の md2html.mermaid.version)");
});

test("frontmatter の md2html.mermaid が不正なら stderr へ警告を出しつつ変換は続ける", async () => {
  const markdown = `---
md2html:
  mermaid: x
---

# 見出し
`;
  const { code, stdout, stderr } = await runCli(["-"], markdown);
  expect(code).toEqual(0);
  expect(stderr).toContain(
    "md2html: frontmatter の md2html.mermaid はマッピングでないため無視した",
  );
  expect(stdout).toContain("<h1");
});

/** main() を fake deps で直接呼ぶためのテスト用 CliDeps を作る。 */
function fakeDeps(overrides: Partial<CliDeps> = {}): {
  deps: CliDeps;
  out: string[];
  err: string[];
} {
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = {
    stdinIsTerminal: () => false,
    readStdin: () => Promise.resolve(""),
    readTextFile: () => Promise.reject(new Error("not implemented")),
    readFile: () => Promise.reject(new Error("not implemented")),
    writeTextFile: () => Promise.reject(new Error("not implemented")),
    getMermaidJs: () => Promise.resolve("/* mermaid stub */"),
    log: (text) => out.push(text),
    error: (text) => err.push(text),
    ...overrides,
  };
  return { deps, out, err };
}

test("main(): --help は使い方を out に積んで 0 を返す", async () => {
  const { deps, out, err } = fakeDeps();
  const code = await main(["--help"], deps);
  expect(code).toEqual(0);
  expect(out.length).toEqual(1);
  expect(out[0]).toContain("使い方: md2html");
  expect(err.length).toEqual(0);
});

test("main(): 読み込めない入力ファイルは err の先頭にエラーを積んで 1 を返す", async () => {
  const { deps, err } = fakeDeps({
    readTextFile: () => Promise.reject(new Error("ENOENT")),
  });
  const code = await main(["missing.md"], deps);
  expect(code).toEqual(1);
  expect(err[0]).toEqual("md2html: 入力ファイルを読み込めない: ENOENT");
});

test("main(): stdin 入力を変換して out に積む", async () => {
  const { deps, out } = fakeDeps({
    stdinIsTerminal: () => false,
    readStdin: () => Promise.resolve("# hello\n"),
  });
  const code = await main([], deps);
  expect(code).toEqual(0);
  expect(out.length).toEqual(1);
  expect(out[0]).toContain("<title>md2html</title>");
  expect(out[0]).toContain("<h1");
});

const MERMAID_MARKDOWN = "```mermaid\ngraph TD; A-->B;\n```\n";

/** mermaid バージョン検証テスト用に、渡された version を記録する fakeDeps を作る。 */
function fakeDepsRecordingMermaidVersion(
  markdown: string,
  overrides: Partial<CliDeps> = {},
): { deps: CliDeps; out: string[]; err: string[]; versions: string[] } {
  const versions: string[] = [];
  const { deps, out, err } = fakeDeps({
    stdinIsTerminal: () => false,
    readStdin: () => Promise.resolve(markdown),
    getMermaidJs: (version) => {
      versions.push(version);
      return Promise.resolve("/* mermaid stub */");
    },
    ...overrides,
  });
  return { deps, out, err, versions };
}

test("main(): 既定では MERMAID_VERSION が getMermaidJs に渡る", async () => {
  const { deps, versions } = fakeDepsRecordingMermaidVersion(MERMAID_MARKDOWN);
  const code = await main([], deps);
  expect(code).toEqual(0);
  expect(versions).toEqual([MERMAID_VERSION]);
});

test("main(): frontmatter の md2html.mermaid.version が getMermaidJs に渡る", async () => {
  const markdown = `---
md2html:
  mermaid:
    version: 11.0.0
---

${MERMAID_MARKDOWN}`;
  const { deps, versions } = fakeDepsRecordingMermaidVersion(markdown);
  const code = await main([], deps);
  expect(code).toEqual(0);
  expect(versions).toEqual(["11.0.0"]);
});

test("main(): --mermaid-version は frontmatter より優先される", async () => {
  const markdown = `---
md2html:
  mermaid:
    version: 11.0.0
---

${MERMAID_MARKDOWN}`;
  const { deps, versions } = fakeDepsRecordingMermaidVersion(markdown);
  const code = await main(["--mermaid-version", "11.1.0"], deps);
  expect(code).toEqual(0);
  expect(versions).toEqual(["11.1.0"]);
});

test('main(): --mermaid-version "" は未指定扱い', async () => {
  const markdown = `---
md2html:
  mermaid:
    version: 11.0.0
---

${MERMAID_MARKDOWN}`;
  const { deps, versions } = fakeDepsRecordingMermaidVersion(markdown);
  const code = await main(["--mermaid-version", ""], deps);
  expect(code).toEqual(0);
  expect(versions).toEqual(["11.0.0"]);
});

test("main(): getMermaidJs が失敗すると版と指定元を含むエラーで 1 を返す", async () => {
  const markdown = `---
md2html:
  mermaid:
    version: 11.0.0
---

${MERMAID_MARKDOWN}`;
  const { deps, err } = fakeDeps({
    stdinIsTerminal: () => false,
    readStdin: () => Promise.resolve(markdown),
    getMermaidJs: () =>
      Promise.reject(new Error("mermaid の取得に失敗した: boom")),
  });
  const code = await main([], deps);
  expect(code).toEqual(1);
  expect(
    err.some((line) =>
      line.includes(
        "mermaid 11.0.0 (frontmatter の md2html.mermaid.version) の取得に失敗した: mermaid の取得に失敗した: boom",
      ),
    ),
  ).toBe(true);
});
