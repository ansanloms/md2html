// md2html をライブラリとして使うための入口。lib/*.ts の公開 API を再 export する。
// CLI は cli.ts を参照。

export type { ConvertOptions, Labels, ResolvedImage } from "./lib/convert.ts";
export {
  convert,
  DEFAULT_LABELS,
  DEFAULT_ZOOM_TARGETS,
  slugify,
  ZOOM_LABEL_KEYS,
} from "./lib/convert.ts";
export type {
  Frontmatter,
  Md2htmlOptions,
  MermaidOptions,
  ParsedMarkdown,
} from "./lib/frontmatter.ts";
export { parseFrontmatter } from "./lib/frontmatter.ts";
export type { ImageResolverDeps } from "./lib/image.ts";
export { createImageResolver, imageMimeType, imagePath } from "./lib/image.ts";
export type { MermaidFetchDeps } from "./lib/mermaid.ts";
export {
  getMermaidBundle,
  isValidMermaidVersion,
  MERMAID_VERSION,
  MERMAID_VERSION_PATTERN,
  resolveCacheDir,
} from "./lib/mermaid.ts";
