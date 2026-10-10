// assets/ 配下の CSS / JS を `with { type: "text" }` のテキスト
// インポートで取り込み、文字列定数として export するアグリゲータ。
// これらは純データのため、convert.ts / mermaid.ts から直接 import してよい
// (副作用の DI 分離という既存方針は、副作用を持つ処理のみを対象とする)。

import codeCopyJsRaw from "./assets/code-copy.js" with { type: "text" };
import markdownThemeCssRaw from "./assets/markdown-theme.css" with {
  type: "text",
};
import mermaidRenderJsRaw from "./assets/mermaid-render.js" with {
  type: "text",
};
import zoomJsRaw from "./assets/zoom.js" with { type: "text" };

/** デザイナ提供の自己完結テーマ CSS (light/dark は prefers-color-scheme を直接参照)。 */
export const MARKDOWN_THEME_CSS = markdownThemeCssRaw;

/** コードブロックのコピー・ボタンを扱う JS。 */
export const CODE_COPY_JS = codeCopyJsRaw;

/** mermaid の render と静的な figure.mermaid-fig 構築を行うクライアント JS (mermaid.min.js の直後に classic script として埋め込まれる)。 */
export const MERMAID_RENDER_JS = mermaidRenderJsRaw;

/** クリックした要素をモーダル (dialog.zoom-dialog) で表示しパン・ズームするクライアント JS。HTML に直接埋め込む。 */
export const ZOOM_JS = zoomJsRaw;
