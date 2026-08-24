// md2html をライブラリとして使うための入口。lib/*.ts の公開 API を再 export する。
// CLI は cli.ts を参照。

export {
  assembleHtml,
  convert,
  convertFragment,
  DEFAULT_LABELS,
  DEFAULT_ZOOM_TARGETS,
  slugify,
  ZOOM_LABEL_KEYS,
} from "./lib/convert.ts";
export type {
  AssembleOptions,
  ConvertFragmentOptions,
  ConvertFragmentResult,
  ConvertOptions,
  Labels,
  NeededAssets,
  ResolvedImage,
  TocEntry,
  ZoomConfig,
} from "./lib/convert.ts";

export {
  CODE_COPY_JS,
  MARKDOWN_THEME_CSS,
  MERMAID_RENDER_JS,
  ZOOM_JS,
} from "./lib/assets.ts";

export { parseFrontmatter } from "./lib/frontmatter.ts";
export type {
  Frontmatter,
  Md2htmlOptions,
  MermaidOptions,
  ParsedMarkdown,
} from "./lib/frontmatter.ts";

export { createImageResolver, imageMimeType, imagePath } from "./lib/image.ts";
export type { ImageResolverDeps } from "./lib/image.ts";

export {
  bundleRevision,
  getMermaidBundle,
  isValidMermaidVersion,
  MERMAID_VERSION,
  MERMAID_VERSION_PATTERN,
  mermaidEntrySource,
  resolveCacheDir,
} from "./lib/mermaid.ts";
export type { MermaidBundleDeps } from "./lib/mermaid.ts";
