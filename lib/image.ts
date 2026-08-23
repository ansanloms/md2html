// ローカル画像 (http(s): / data: 以外の img src) の解決ロジック。
// ファイル読み込みは呼び出し側から readFile として注入するので、このモジュールは
// Deno API に依存しない。

import { isAbsolute, join } from "@std/path";
import type { ResolvedImage } from "./convert.ts";

const IMAGE_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
};

/**
 * img の src からローカルファイルパスを取り出す。
 * クエリ (`?`) と fragment (`#`) 以降を落とし、percent-encoding を解く。
 * 不正な percent-encoding で decodeURIComponent が throw する場合は元の文字列を返す。
 */
export function imagePath(src: string): string {
  let end = src.length;
  for (const marker of ["?", "#"]) {
    const index = src.indexOf(marker);
    if (index !== -1 && index < end) {
      end = index;
    }
  }
  const path = src.slice(0, end);
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** 拡張子そのものから画像 mime を引く。 */
function extensionMimeType(path: string): string | null {
  const dot = path.lastIndexOf(".");
  if (dot === -1) {
    return null;
  }
  return IMAGE_MIME_TYPES[path.slice(dot).toLowerCase()] ?? null;
}

/**
 * 拡張子から画像 mime を引く。対応外は null。
 * クエリ・fragment は無視し、percent-encoding を解いてから判定する。
 * それで引けない場合は src そのもの (`?` / `#` / `%` を含むファイル名) でも判定する。
 */
export function imageMimeType(src: string): string | null {
  return extensionMimeType(imagePath(src)) ?? extensionMimeType(src);
}

export interface ImageResolverDeps {
  /** 指定パスの中身を読む。読めない場合は reject すること。 */
  readFile: (path: string) => Promise<Uint8Array>;
  /**
   * 相対パスの基準ディレクトリ (通常は入力 markdown のあるディレクトリ)。
   * 指定時はここを基準に読み、失敗したら cwd 基準 (src そのまま) へフォールバックする。
   * 省略時は cwd 基準のみ。
   */
  baseDir?: string;
}

/**
 * ConvertOptions.resolveImage 互換の関数を作る。
 * 対応外の拡張子は readFile を呼ばずに null を返す。読み込みに失敗した場合も null。
 */
export function createImageResolver(
  deps: ImageResolverDeps,
): (src: string) => Promise<ResolvedImage | null> {
  const expand = (path: string): string[] =>
    deps.baseDir !== undefined && !isAbsolute(path)
      ? [join(deps.baseDir, path), path]
      : [path];

  return async (src: string): Promise<ResolvedImage | null> => {
    const mime = imageMimeType(src);
    if (mime === null) {
      return null;
    }

    // クエリ・fragment を落として decode したパスを優先し、それで読めなければ
    // src そのもの (`?` / `#` / `%` を含むファイル名) でも試す。
    const path = imagePath(src);
    const candidates = [
      ...expand(path),
      ...(src === path ? [] : expand(src)),
    ];

    for (const candidate of candidates) {
      try {
        return { mime, data: await deps.readFile(candidate) };
      } catch {
        continue;
      }
    }

    return null;
  };
}
