import { expect, test } from "bun:test";
import {
  createImageResolver,
  type ImageResolverDeps,
  imageMimeType,
  imagePath,
} from "./image.ts";

/** テスト用の readFile。files に無いパスは reject する。 */
function makeReadFile(files: Record<string, string>): {
  readFile: ImageResolverDeps["readFile"];
  calls: string[];
} {
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

test("imageMimeType は拡張子から mime を引く", () => {
  expect(imageMimeType("img.png")).toEqual("image/png");
  expect(imageMimeType("a/b/img.jpg")).toEqual("image/jpeg");
  expect(imageMimeType("img.jpeg")).toEqual("image/jpeg");
  expect(imageMimeType("img.gif")).toEqual("image/gif");
  expect(imageMimeType("img.svg")).toEqual("image/svg+xml");
  expect(imageMimeType("img.webp")).toEqual("image/webp");
  expect(imageMimeType("img.avif")).toEqual("image/avif");
  expect(imageMimeType("img.bmp")).toEqual("image/bmp");
  expect(imageMimeType("img.ico")).toEqual("image/x-icon");
});

test("imageMimeType は拡張子の大文字小文字を区別しない", () => {
  expect(imageMimeType("img.PNG")).toEqual("image/png");
  expect(imageMimeType("img.JPEG")).toEqual("image/jpeg");
});

test("imageMimeType はクエリを無視する", () => {
  expect(imageMimeType("img.png?v=1")).toEqual("image/png");
  expect(imageMimeType("img.png?v=1&w=2")).toEqual("image/png");
});

test("imageMimeType は fragment を無視する", () => {
  expect(imageMimeType("img.png#frag")).toEqual("image/png");
  expect(imageMimeType("img.png#frag?v=1")).toEqual("image/png");
});

test("imageMimeType は percent-encoding を解いてから判定する", () => {
  expect(imageMimeType("sub%20dir/img%2Epng")).toEqual("image/png");
});

test("imageMimeType は未対応拡張子・拡張子なしで null", () => {
  expect(imageMimeType("doc.pdf")).toEqual(null);
  expect(imageMimeType("noext")).toEqual(null);
  expect(imageMimeType("img.png.txt")).toEqual(null);
});

test("imagePath はクエリ・fragment を落として decode する", () => {
  expect(imagePath("sub%20dir/img.png?v=1")).toEqual("sub dir/img.png");
  expect(imagePath("img.png#frag")).toEqual("img.png");
});

test("imagePath は不正な percent-encoding では元の文字列で続行する", () => {
  expect(imagePath("100%.png")).toEqual("100%.png");
});

test("createImageResolver は baseDir 基準を優先する", async () => {
  const { readFile, calls } = makeReadFile({
    "docs/img.png": "base",
    "img.png": "cwd",
  });
  const resolve = createImageResolver({ readFile, baseDir: "docs" });

  const resolved = await resolve("img.png");
  expect(resolved?.mime).toEqual("image/png");
  expect(decode(resolved!.data)).toEqual("base");
  expect(calls).toEqual(["docs/img.png"]);
});

test("createImageResolver は baseDir で読めなければ cwd 基準へフォールバックする", async () => {
  const { readFile, calls } = makeReadFile({ "img.png": "cwd" });
  const resolve = createImageResolver({ readFile, baseDir: "docs" });

  const resolved = await resolve("img.png");
  expect(decode(resolved!.data)).toEqual("cwd");
  expect(calls).toEqual(["docs/img.png", "img.png"]);
});

test("createImageResolver は baseDir 省略時は cwd 基準のみ", async () => {
  const { readFile, calls } = makeReadFile({ "img.png": "cwd" });
  const resolve = createImageResolver({ readFile });

  const resolved = await resolve("img.png");
  expect(decode(resolved!.data)).toEqual("cwd");
  expect(calls).toEqual(["img.png"]);
});

test("createImageResolver は両方読めなければ null", async () => {
  const { readFile, calls } = makeReadFile({});
  const resolve = createImageResolver({ readFile, baseDir: "docs" });

  expect(await resolve("img.png")).toEqual(null);
  expect(calls).toEqual(["docs/img.png", "img.png"]);
});

test("createImageResolver は絶対パスに baseDir を結合しない", async () => {
  const { readFile, calls } = makeReadFile({ "/abs/img.png": "abs" });
  const resolve = createImageResolver({ readFile, baseDir: "docs" });

  const resolved = await resolve("/abs/img.png");
  expect(decode(resolved!.data)).toEqual("abs");
  expect(calls).toEqual(["/abs/img.png"]);
});

test("createImageResolver はクエリ・percent-encoding を落としたパスで読む", async () => {
  const { readFile, calls } = makeReadFile({ "docs/sub dir/img.png": "base" });
  const resolve = createImageResolver({ readFile, baseDir: "docs" });

  const resolved = await resolve("sub%20dir/img.png?v=1");
  expect(resolved?.mime).toEqual("image/png");
  expect(decode(resolved!.data)).toEqual("base");
  expect(calls).toEqual(["docs/sub dir/img.png"]);
});

test("createImageResolver は ? / # を含むファイル名も src そのもので試す", async () => {
  const { readFile, calls } = makeReadFile({ "docs/img#1.png": "hash" });
  const resolve = createImageResolver({ readFile, baseDir: "docs" });

  const resolved = await resolve("img#1.png");
  expect(resolved?.mime).toEqual("image/png");
  expect(decode(resolved!.data)).toEqual("hash");
  expect(calls).toEqual(["docs/img", "img", "docs/img#1.png"]);
});

test("createImageResolver は percent を含むファイル名も src そのもので試す", async () => {
  const { readFile } = makeReadFile({ "a%20b.png": "raw" });
  const resolve = createImageResolver({ readFile });

  const resolved = await resolve("a%20b.png");
  expect(decode(resolved!.data)).toEqual("raw");
});

test("createImageResolver は未対応 mime では readFile を呼ばない", async () => {
  const { readFile, calls } = makeReadFile({ "doc.pdf": "pdf" });
  const resolve = createImageResolver({ readFile, baseDir: "docs" });

  expect(await resolve("doc.pdf")).toEqual(null);
  expect(calls).toEqual([]);
});
