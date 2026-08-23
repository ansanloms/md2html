import { assertEquals } from "@std/assert";
import {
  createImageResolver,
  imageMimeType,
  imagePath,
  type ImageResolverDeps,
} from "./image.ts";

/** テスト用の readFile。files に無いパスは reject する。 */
function makeReadFile(
  files: Record<string, string>,
): { readFile: ImageResolverDeps["readFile"]; calls: string[] } {
  const map = new Map(Object.entries(files));
  const calls: string[] = [];
  const readFile = (path: string): Promise<Uint8Array> => {
    calls.push(path);
    const found = map.get(path);
    if (found === undefined) {
      return Promise.reject(new Error(`not found: ${path}`));
    }
    return Promise.resolve(new TextEncoder().encode(found));
  };
  return { readFile, calls };
}

function decode(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

Deno.test("imageMimeType は拡張子から mime を引く", () => {
  assertEquals(imageMimeType("img.png"), "image/png");
  assertEquals(imageMimeType("a/b/img.jpg"), "image/jpeg");
  assertEquals(imageMimeType("img.jpeg"), "image/jpeg");
  assertEquals(imageMimeType("img.gif"), "image/gif");
  assertEquals(imageMimeType("img.svg"), "image/svg+xml");
  assertEquals(imageMimeType("img.webp"), "image/webp");
  assertEquals(imageMimeType("img.avif"), "image/avif");
  assertEquals(imageMimeType("img.bmp"), "image/bmp");
  assertEquals(imageMimeType("img.ico"), "image/x-icon");
});

Deno.test("imageMimeType は拡張子の大文字小文字を区別しない", () => {
  assertEquals(imageMimeType("img.PNG"), "image/png");
  assertEquals(imageMimeType("img.JPEG"), "image/jpeg");
});

Deno.test("imageMimeType はクエリを無視する", () => {
  assertEquals(imageMimeType("img.png?v=1"), "image/png");
  assertEquals(imageMimeType("img.png?v=1&w=2"), "image/png");
});

Deno.test("imageMimeType は fragment を無視する", () => {
  assertEquals(imageMimeType("img.png#frag"), "image/png");
  assertEquals(imageMimeType("img.png#frag?v=1"), "image/png");
});

Deno.test("imageMimeType は percent-encoding を解いてから判定する", () => {
  assertEquals(imageMimeType("sub%20dir/img%2Epng"), "image/png");
});

Deno.test("imageMimeType は未対応拡張子・拡張子なしで null", () => {
  assertEquals(imageMimeType("doc.pdf"), null);
  assertEquals(imageMimeType("noext"), null);
  assertEquals(imageMimeType("img.png.txt"), null);
});

Deno.test("imagePath はクエリ・fragment を落として decode する", () => {
  assertEquals(imagePath("sub%20dir/img.png?v=1"), "sub dir/img.png");
  assertEquals(imagePath("img.png#frag"), "img.png");
});

Deno.test("imagePath は不正な percent-encoding では元の文字列で続行する", () => {
  assertEquals(imagePath("100%.png"), "100%.png");
});

Deno.test("createImageResolver は baseDir 基準を優先する", async () => {
  const { readFile, calls } = makeReadFile({
    "docs/img.png": "base",
    "img.png": "cwd",
  });
  const resolve = createImageResolver({ readFile, baseDir: "docs" });

  const resolved = await resolve("img.png");
  assertEquals(resolved?.mime, "image/png");
  assertEquals(decode(resolved!.data), "base");
  assertEquals(calls, ["docs/img.png"]);
});

Deno.test("createImageResolver は baseDir で読めなければ cwd 基準へフォールバックする", async () => {
  const { readFile, calls } = makeReadFile({ "img.png": "cwd" });
  const resolve = createImageResolver({ readFile, baseDir: "docs" });

  const resolved = await resolve("img.png");
  assertEquals(decode(resolved!.data), "cwd");
  assertEquals(calls, ["docs/img.png", "img.png"]);
});

Deno.test("createImageResolver は baseDir 省略時は cwd 基準のみ", async () => {
  const { readFile, calls } = makeReadFile({ "img.png": "cwd" });
  const resolve = createImageResolver({ readFile });

  const resolved = await resolve("img.png");
  assertEquals(decode(resolved!.data), "cwd");
  assertEquals(calls, ["img.png"]);
});

Deno.test("createImageResolver は両方読めなければ null", async () => {
  const { readFile, calls } = makeReadFile({});
  const resolve = createImageResolver({ readFile, baseDir: "docs" });

  assertEquals(await resolve("img.png"), null);
  assertEquals(calls, ["docs/img.png", "img.png"]);
});

Deno.test("createImageResolver は絶対パスに baseDir を結合しない", async () => {
  const { readFile, calls } = makeReadFile({ "/abs/img.png": "abs" });
  const resolve = createImageResolver({ readFile, baseDir: "docs" });

  const resolved = await resolve("/abs/img.png");
  assertEquals(decode(resolved!.data), "abs");
  assertEquals(calls, ["/abs/img.png"]);
});

Deno.test("createImageResolver はクエリ・percent-encoding を落としたパスで読む", async () => {
  const { readFile, calls } = makeReadFile({ "docs/sub dir/img.png": "base" });
  const resolve = createImageResolver({ readFile, baseDir: "docs" });

  const resolved = await resolve("sub%20dir/img.png?v=1");
  assertEquals(resolved?.mime, "image/png");
  assertEquals(decode(resolved!.data), "base");
  assertEquals(calls, ["docs/sub dir/img.png"]);
});

Deno.test("createImageResolver は ? / # を含むファイル名も src そのもので試す", async () => {
  const { readFile, calls } = makeReadFile({ "docs/img#1.png": "hash" });
  const resolve = createImageResolver({ readFile, baseDir: "docs" });

  const resolved = await resolve("img#1.png");
  assertEquals(resolved?.mime, "image/png");
  assertEquals(decode(resolved!.data), "hash");
  assertEquals(calls, ["docs/img", "img", "docs/img#1.png"]);
});

Deno.test("createImageResolver は percent を含むファイル名も src そのもので試す", async () => {
  const { readFile } = makeReadFile({ "a%20b.png": "raw" });
  const resolve = createImageResolver({ readFile });

  const resolved = await resolve("a%20b.png");
  assertEquals(decode(resolved!.data), "raw");
});

Deno.test("createImageResolver は未対応 mime では readFile を呼ばない", async () => {
  const { readFile, calls } = makeReadFile({ "doc.pdf": "pdf" });
  const resolve = createImageResolver({ readFile, baseDir: "docs" });

  assertEquals(await resolve("doc.pdf"), null);
  assertEquals(calls, []);
});
