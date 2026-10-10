# md2html

markdown ファイルをシンタックスハイライト・mermaid 図・目次を内蔵した自己完結 HTML（外部ファイルへの参照を持たない単一 HTML）へ変換する CLI。remark / rehype / shiki のパイプラインで変換する。

## コマンド

- `md2html [<input.md>] [--output <path>] [--css <path>] [--title <title>] [--lang <lang>] [--mermaid-version <version>]`
  - `<input.md>` - 入力 markdown ファイル。省略するか `-` を指定すると stdin から読む（例: `cat foo.md | md2html - --output foo.html`）。指定できるのは 1 つまでで、2 つ以上あるとエラーになる。
  - `--output` - 出力先パス。省略時は変換結果を stdout へ出す。
  - `--css` - 追記するユーザ CSS ファイルのパス。組み込みテーマ CSS の後に連結される。
  - `--title` - 出力 HTML の `<title>`。省略時は frontmatter の `title`、それも無ければ入力ファイル名（stdin から読む場合は `md2html`）を使う。
  - `--lang` - 出力 HTML の `<html lang>`。省略時は frontmatter の `lang`、それも無ければ `ja` を使う。
  - `--mermaid-version` - 埋め込む mermaid の npm バージョン。省略時は frontmatter の `md2html.mermaid.version`、それも無ければ `lib/mermaid.ts` の `MERMAID_VERSION` に pin した版を使う。
  - `--help` - 使い方を表示する。
  - `--version` - バージョンを表示する。

不明なオプションを渡すとエラー（終了コード 1）になる。

frontmatter の例:

```yaml
---
title: 例
description: 説明文
md2html:
  zoomTargets:
    - "img"
    - "table"
  mermaid:
    version: 11.16.0
---
```

CLI にテーマ・目次・mermaid ズームを切り替えるオプションは無く、常に有効なビルトイン機能として次を持つ。

- シンタックスハイライトは `@shikijs/rehype` による light/dark 2 テーマ（`github-light` / `github-dark`）を埋め込み、実際の表示切替は組み込み CSS の `prefers-color-scheme` 参照で行う（OS 設定に追従、JS によるトグルではない）。
- 見出し（h2/h3）が 1 つ以上あれば目次（TOC）を自動生成して本文右側に配置し、無ければ TOC 無しの 1 カラムレイアウトにする。見出しには一意な id とアンカーリンク（h1〜h4）を自動付与する。
- コードブロックには言語ラベルとコピー・ボタンを自動付与する（`lib/assets/code-copy.js`）。
- GitHub のアラート記法（`> [!NOTE]` / `> [!TIP]` / `> [!IMPORTANT]` / `> [!WARNING]` / `> [!CAUTION]`）を `rehype-github-alerts` で `div.markdown-alert` へ変換し、種別ごとのアイコン・タイトル・配色を組み込み CSS で与える。マーカーの無い blockquote は通常の引用のまま扱う。
- mermaid コードブロックは `pre.mermaid` へ変換し、mermaid 本体（`mermaid.min.js`）と描画スクリプト（`lib/assets/mermaid-render.js`）を出力 HTML に埋め込む。描画結果は本文幅に収まる静的な図（`figure.mermaid-fig`、ホバーで「拡大」バッジを表示）として表示し、クリック（または Enter / Space）でモーダル表示に切り替わる。mermaid 本体は版ごとに初回のみ jsdelivr（`https://cdn.jsdelivr.net/npm/mermaid@<version>/dist/mermaid.min.js`）から取得するためネットワークが要り、`$XDG_CACHE_HOME/md2html/mermaid-<version>.min.js`（無ければ `~/.cache/md2html/mermaid-<version>.min.js`）へキャッシュする。以降はキャッシュを読むだけなので、mermaid ブロックが無い変換や 2 回目以降の変換はネットワークを必要としない。版ごとに別ファイルでキャッシュし、古い版のキャッシュは自動では消さない。以前の版が作った `mermaid-*.bundle.js` は使わなくなったので手で消してよい。`latest` などの dist-tag を指定すると初回に解決した版のままキャッシュされて以後更新されないため、完全一致の版の指定を推奨する。
- モーダル表示（`lib/assets/zoom.js`）は `<dialog class="zoom-dialog">` 要素で実装し、モーダル内でドラッグによる移動・ホイールによる拡大縮小・ボタン操作（閉じる / 拡大 / 縮小 / 全体表示）・ダブルクリックでの全体表示ができる。Esc キー・背景クリック・閉じるボタンで閉じる。右下に対象のキャプション（mermaid 図は「図」、画像は `alt`）を表示する。色はテーマ CSS の変数を参照するため `prefers-color-scheme` に追従する。対象は既定で mermaid 図と画像（`img`）。frontmatter の `md2html.zoomTargets` に CSS セレクタの配列を書くと既定を置き換えて任意の要素（例: `table`）を対象にでき、`zoomTargets: []` と書けば画像を外して mermaid 図のみにできる（mermaid 図は指定によらず常に対象）。マッチした要素のうち `img` は `span.img-zoom` で包んで「拡大」バッジを付け、それ以外は `zoom-target` クラスを付ける。mermaid 図と画像はクリックのほか Enter / Space でも開けるが、`zoom-target` クラスを付けた要素はクリック（マウス操作）のみで開く。いずれもクリックでモーダル表示し（要素は複製して表示する）、リンク（`a[href]`）の中にある要素はリンクの動作を優先して対象外とする。解釈できないセレクタはブラウザのコンソールに警告を出して無視する。対象の内側にあるリンクをクリックした場合や、表のテキストをドラッグ選択した直後の click ではモーダルを開かない。
- ローカル画像（`http(s):` / `data:` 以外の `img` の `src`）は入力ファイルのディレクトリ基準で読み込み（見つからなければ cwd 基準）、data URI に埋め込む。対応拡張子は png / jpg / jpeg / gif / svg / webp / avif / bmp / ico で、クエリ・fragment は無視する。読み込めない場合は代替テキスト付きのプレースホルダ要素に置き換える。
- 入力 markdown 先頭の YAML frontmatter を解釈し、`title` を `<title>` に（優先順位は `--title` > frontmatter `title` > 入力ファイル名）、`description` を `<meta name="description">` に、`lang` を `<html lang>` に（優先順位は `--lang` > frontmatter `lang` > `ja`）反映する。frontmatter ブロック自体は本文としてレンダリングしない。frontmatter が無い・空の場合は従来どおり動作する。値は書かれたとおりの文字列として扱い（YAML の数値・日付変換は行わない）、空文字列は未指定とみなす。`md2html.zoomTargets`（文字列の配列）はモーダル拡大表示の対象セレクタとして扱い（未指定なら既定の `["img"]`、空配列なら画像を外す）、非文字列・空文字列の要素は無視する。`md2html.mermaid.version`（文字列）は埋め込む mermaid の npm バージョンで、`--mermaid-version` があればそちらを優先し、どちらも無ければ `lib/mermaid.ts` の `MERMAID_VERSION` に pin した版を使う。`md2html` 名前空間の指定が不正な場合（マッピングでない、`zoomTargets` が配列でない、要素が除外された、`mermaid` がマッピングでない、`mermaid.version` が文字列でない）は標準エラー出力へ警告を出したうえで無視する。バージョン指定子は先頭が英数字で、以降に使えるのは英数字・`.`・`-`・`+` のみ。それ以外（レンジ・パス文字等）はエラーで終了する。

入力 markdown は信頼できるものとして扱う。markdown 中に直接書かれた raw HTML（`<script>` を含む）は `rehype-raw` と `allowDangerousHtml` によりサニタイズされずそのまま出力 HTML へ通す。信頼できない markdown を変換して第三者へ配布する用途は想定していない。

## 構成

エントリポイント（`cli.ts`）+ 依存注入した変換ロジック（`lib/convert.ts` の `convert()`）に分離している。副作用（ファイル読み書き・mermaid の取得・キャッシュ・画像解決）はエントリ側で組み立てて注入し、`lib/*.ts` はユニットテストする。

- `cli.ts` - CLI 本体。引数パース、入力/CSS ファイルの読み込み、frontmatter の解釈（`parseFrontmatter`）と `<title>` の決定、ローカル画像の解決（`resolveImage`）、mermaid の取得（`getMermaidJs`、キャッシュ経由）を組み立てて `lib/convert.ts` の `convert()` へ渡す。`main(args, deps)` を export し、直接実行時のみ `process.exitCode` へ終了コードを設定する。
- `mod.ts` - ライブラリとして import するための入口。`lib/convert.ts` / `lib/frontmatter.ts` / `lib/image.ts` / `lib/mermaid.ts` の公開 API を再 export する。`package.json` の `exports` は `.` → `mod.ts`、`./cli` → `cli.ts`。
- `lib/convert.ts` - 変換の中心ロジック。unified（remark-parse → remark-gfm → remark-rehype → rehype-raw）で markdown を hast に変換した後、mermaid ブロックの退避・shiki ハイライト（`@shikijs/rehype`）・見出し id/TOC 付与・コードブロックのラップ・テーブルのラップ・ローカル画像のインライン化・rehype-stringify を経て、テーマ CSS やスクリプトを埋め込んだ 1 枚の HTML 文字列を組み立てる。
- `lib/frontmatter.ts` - YAML frontmatter の解釈（先頭の `---` 行から次の `---` / `...` 行までを自前で分割し（BOM と行末空白を許容）、`yaml` パッケージの failsafe スキーマで解析）。frontmatter ブロックを本文から切り離し、`title` / `description` / `lang` / `md2html.zoomTargets` を型付きで返す。不正な `md2html` 指定は警告文（`warnings`）として返し、CLI が stderr へ出す。CLI がこれを呼び、本文と解釈結果を `convert()` へ渡す。
- `lib/mermaid.ts` - mermaid のブラウザ向け bundle 取得ロジック。`<cacheDir>/mermaid-<version>.min.js` があれば読み、無ければ jsdelivr から `mermaid.min.js`（IIFE）を fetch（呼び出し側から注入）して一時ファイルへ書き、rename でキャッシュへ差し替える。
- `lib/assets.ts` - `lib/assets/` 配下の CSS / JS を `with { type: "text" }` のテキスト import で取り込み、文字列定数として export するアグリゲータ。
- `lib/assets/markdown-theme.css` - 自己完結テーマ CSS。light/dark は `prefers-color-scheme` を直接参照する。
- `lib/assets/code-copy.js` - コードブロックのコピー・ボタンの挙動。
- `lib/assets/mermaid-render.js` - mermaid の render と静的な図（`figure.mermaid-fig`）の DOM 構築。テーマ変更時に再描画できるよう、`pre.mermaid` のソーステキストを保持したまま都度 `render()` する方式を取る。`mermaid.min.js` の直後に classic script として埋め込まれ、`globalThis.mermaid` を使う。
- `lib/assets/zoom.js` - クリックした要素（mermaid 図・`md2html.zoomTargets` で指定した要素）を `<dialog class="zoom-dialog">` のモーダルへ複製して表示し、その中でパン・ズームする。mermaid 図・画像へ「拡大」バッジを付ける `globalThis.md2htmlZoom.decorate` も公開する。mermaid 図があるとき・`zoomTargets` を明示したとき・既定の対象である画像があるときに HTML に直接埋め込む（mermaid 本体とは別）。

モジュール固有の依存（`package.json`）は remark/rehype/shiki 系パッケージ一式（`unified` / `remark-parse` / `remark-gfm` / `remark-rehype` / `rehype-raw` / `rehype-stringify` / `@shikijs/rehype` / `unist-util-visit` / `rehype-github-alerts`）、`yaml`（YAML frontmatter の failsafe スキーマでの解析。frontmatter の分離は `lib/frontmatter.ts` で自前実装）。ローカル画像の data URI 化には `Buffer` を使う。

## ライブラリとして使う

CLI とは別に、変換ロジックを `mod.ts` からライブラリとして import できる。JSR には公開していないため、リポジトリをクローンして相対パスで import する。`mod.ts` が使う `unified` 等の依存はこのリポジトリの `package.json` で解決するので、事前に `bun install` が要る。

```ts
import { readFile } from "node:fs/promises";
import {
  convert,
  createImageResolver,
  MERMAID_VERSION,
  parseFrontmatter,
} from "./mod.ts";
import { bunDeps } from "./cli.ts";

const { frontmatter, body } = parseFrontmatter(markdown);
const mermaidVersion = frontmatter.md2html?.mermaid?.version ?? MERMAID_VERSION;
const html = await convert(body, {
  title: frontmatter.title ?? "untitled",
  frontmatter,
  // mermaid の browser 向け bundle (JS ソース) を返す関数を注入する。
  // Bun 上なら cli.ts の bunDeps.getMermaidJs（jsdelivr から取得 + キャッシュ）に
  // バージョンを渡して使える。他の環境では mermaid.min.js を返す関数を自前で用意する。
  getMermaidJs: () => bunDeps.getMermaidJs(mermaidVersion),
  resolveImage: createImageResolver({ readFile: (path) => readFile(path) }),
});
```

## ビルドとテスト

- `bun run build` - `bun build --compile` で `cli.ts` を単一バイナリ `dist/md2html` にする（実行に Bun / Deno は不要）。
- `bun run test` - ユニットテスト（`lib/*.test.ts` と `cli.test.ts`）を実行する。
- `bun run lint` - oxlint (`oxlint --deny-warnings`) と oxfmt (`oxfmt --check`)。
- `bun run check` - 型検査 (`tsc --noEmit`)。

## インストール

GitHub Release から OS・アーキテクチャ別のバイナリをダウンロードし、実行権限を付ける（deno・bun は不要）。

```sh
chmod +x md2html-<target>
```

## 配布

GitHub Release にバージョンタグ（例: `0.1.0`、`v` プレフィックス無し）を切り、`bun build --compile --target=<target>` で生成した OS・アーキテクチャ別のバイナリを添付する。
ターゲットは `bun-linux-x64` / `bun-linux-arm64` / `bun-darwin-x64` / `bun-darwin-arm64` / `bun-windows-x64` の 5 つで、asset 名は `md2html-<target>`。Windows 向けは `.exe` が付いて `md2html-bun-windows-x64.exe` として添付される。
