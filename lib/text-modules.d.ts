// lib/assets.ts が `with { type: "text" }` で取り込む資産ファイルの型宣言。
// Bun は text import で中身を文字列として返す。

declare module "*.css" {
  const text: string;
  export default text;
}

declare module "*.js" {
  const text: string;
  export default text;
}
