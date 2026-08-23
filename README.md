# md2html

markdown ファイルをシンタックスハイライト・mermaid 図・目次を内蔵した自己完結 HTML（外部ファイルへの参照を持たない単一 HTML）へ変換する CLI。remark / rehype / shiki のパイプラインで変換する。

## コマンド

- `md2html <input.md> [--output <path>] [--css <path>] [--title <title>]`
  - `--output` - 出力先パス。省略時は変換結果を stdout へ出す。
  - `--css` - 追記するユーザ CSS ファイルのパス。組み込みテーマ CSS の後に連結される。
  - `--title` - 出力 HTML の `<title>`。省略時は frontmatter の `title`、それも無ければ入力ファイル名を使う。

CLI にテーマ・目次・mermaid ズームを切り替えるオプションは無く、常に有効なビルトイン機能として次を持つ。

- シンタックスハイライトは `@shikijs/rehype` による light/dark 2 テーマ（`github-light` / `github-dark`）を埋め込み、実際の表示切替は組み込み CSS の `prefers-color-scheme` 参照で行う（OS 設定に追従、JS によるトグルではない）。
- 見出し（h2/h3）が 1 つ以上あれば目次（TOC）を自動生成して本文右側に配置し、無ければ TOC 無しの 1 カラムレイアウトにする。見出しには一意な id とアンカーリンク（h1〜h4）を自動付与する。
- コードブロックには言語ラベルとコピー・ボタンを自動付与する（`assets/code-copy.js`）。
- mermaid コードブロックは `pre.mermaid` へ変換し、mermaid 本体（npm パッケージをブラウザ向けにバンドルしたもの）とパン・ズーム UI（`assets/mermaid-zoom.js`）を出力 HTML に埋め込む。mermaid のブラウザ向け bundle は初回のみ `deno bundle` で生成し、`$XDG_CACHE_HOME/md2html`（無ければ `~/.cache/md2html`）へキャッシュする。以降はキャッシュを読むだけなので、mermaid ブロックが無い変換や 2 回目以降の変換はネットワーク・`deno bundle` 実行を必要としない。
- ローカル画像（`http(s):` / `data:` 以外の `img` の `src`）は cwd 相対で読み込んで data URI に埋め込む。読み込めない場合は代替テキスト付きのプレースホルダ要素に置き換える。
- 入力 markdown 先頭の YAML frontmatter を解釈し、`title` を `<title>` に（優先順位は `--title` > frontmatter `title` > 入力ファイル名）、`description` を `<meta name="description">` に反映する。frontmatter ブロック自体は本文としてレンダリングしない。frontmatter が無い・空の場合は従来どおり動作する。値は書かれたとおりの文字列として扱い（YAML の数値・日付変換は行わない）、空文字列は未指定とみなす。

## 構成

エントリポイント（`md2html.ts`）+ 依存注入した変換ロジック（`lib/md2html.ts` の `convert()`）に分離している。副作用（ファイル読み書き・`deno bundle` によるバンドル生成・キャッシュ・画像解決）はエントリ側で組み立てて注入し、`lib/*.ts` はユニットテストする。

- `md2html.ts` - CLI 本体。引数パース、入力/CSS ファイルの読み込み、frontmatter の解釈（`parseFrontmatter`）と `<title>` の決定、ローカル画像の解決（`resolveImage`）、mermaid bundle の取得（`getMermaidJs`、キャッシュ経由）を組み立てて `lib/md2html.ts` の `convert()` へ渡す。
- `lib/md2html.ts` - 変換の中心ロジック。unified（remark-parse → remark-gfm → remark-rehype → rehype-raw）で markdown を hast に変換した後、mermaid ブロックの退避・shiki ハイライト（`@shikijs/rehype`）・見出し id/TOC 付与・コードブロックのラップ・テーブルのラップ・ローカル画像のインライン化・rehype-stringify を経て、テーマ CSS やスクリプトを埋め込んだ 1 枚の HTML 文字列を組み立てる。
- `lib/frontmatter.ts` - YAML frontmatter の解釈（`@std/front-matter` で分離し、`@std/yaml` の failsafe スキーマで解析）。frontmatter ブロックを本文から切り離し、`title` / `description` を型付きで返す。CLI がこれを呼び、本文と解釈結果を `convert()` へ渡す。
- `lib/mermaid.ts` - mermaid のブラウザ向け bundle 取得ロジック。bundle 対象（エントリ TS + `mermaid-zoom.js`）の内容から revision ハッシュを作ってキャッシュキーとし、キャッシュがあれば読み、無ければ一時ディレクトリにエントリを書いて `deno bundle`（呼び出し側から注入）を実行し、結果をキャッシュへ保存する。
- `lib/assets.ts` - `lib/assets/` 配下の CSS / JS を `with { type: "text" }` のテキスト import で取り込み、文字列定数として export するアグリゲータ。
- `lib/assets/markdown-theme.css` - 自己完結テーマ CSS。light/dark は `prefers-color-scheme` を直接参照する。
- `lib/assets/code-copy.js` - コードブロックのコピー・ボタンの挙動。
- `lib/assets/mermaid-zoom.js` - mermaid の render と、パン・ズーム UI（`.mermaid-zoom`）の DOM 構築。テーマ変更時に再描画できるよう、`pre.mermaid` のソーステキストを保持したまま都度 `render()` する方式を取る。

モジュール固有の依存（`deno.json`）は remark/rehype/shiki 系パッケージ一式（`unified` / `remark-parse` / `remark-gfm` / `remark-rehype` / `rehype-raw` / `rehype-stringify` / `@shikijs/rehype` / `unist-util-visit`）、`@std/encoding`（ローカル画像の data URI 化に使う base64 エンコード）、`@std/front-matter` / `@std/yaml`（YAML frontmatter の分離と failsafe スキーマでの解析）。

## ビルドとテスト

- `deno task build` - エントリ（`md2html.ts`）を `deno bundle` で単一ファイル化し、`dist/md2html` として出力する（エントリの shebang は bundle の先頭へ引き継がれる）。
- `deno task test` - ユニットテスト（`lib/*.test.ts`）を実行する。
- `deno task lint` / `deno task check` - lint・フォーマット検査と型検査。

## 配布

GitHub Release にバージョンタグ（例: `0.1.0`、`v` プレフィックス無し）を切り、`deno task build` で生成した `dist/md2html` を asset 名 `md2html` として添付する。利用側はこの単一ファイルを取得してそのまま実行できる（shebang が `deno run` に必要な権限フラグを持つ）。
