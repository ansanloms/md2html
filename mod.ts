// md2html をライブラリとして使うための入口。lib/*.ts の公開 API を再 export する。
// CLI は cli.ts を参照。

export {
  convert,
  DEFAULT_LABELS,
  DEFAULT_ZOOM_TARGETS,
  slugify,
  ZOOM_LABEL_KEYS,
} from "./lib/convert.ts";
export type { ConvertOptions, Labels, ResolvedImage } from "./lib/convert.ts";

export { parseFrontmatter } from "./lib/frontmatter.ts";
export type {
  Frontmatter,
  Md2htmlOptions,
  ParsedMarkdown,
} from "./lib/frontmatter.ts";

export { createImageResolver, imageMimeType, imagePath } from "./lib/image.ts";
export type { ImageResolverDeps } from "./lib/image.ts";

export {
  bundleRevision,
  getMermaidBundle,
  MERMAID_VERSION,
  mermaidEntrySource,
  resolveCacheDir,
} from "./lib/mermaid.ts";
export type { MermaidBundleDeps } from "./lib/mermaid.ts";
