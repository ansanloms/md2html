// mermaid の browser 向けレンダリングを行う。mermaid.run + dataset 退避方式は
// 使わず、pre.mermaid のテキストを保持したまま render() で都度描画し直す。
// これにより prefers-color-scheme の変更にも追従できる (テーマを切り替えて再描画する)。
// 描画結果は静的な figure.mermaid-fig に入れる。本文幅への収め方は CSS
// (.md .mermaid-fig svg の max-width / height) に任せ、svg の属性は書き換えない。
// クリックでのモーダル拡大表示 (パン・ズーム) と「拡大」バッジの付与は HTML に
// 直接埋め込まれる zoom.js が担い、ここでは globalThis.md2htmlZoom.decorate を呼ぶだけにする。

/** pre.mermaid を mermaid で render し、figure.mermaid-fig へ差し替える。 */
export const initMermaid = async (mermaid) => {
  const targets = Array.from(document.querySelectorAll("pre.mermaid")).map(
    (node) => ({ node, text: node.textContent ?? "" }),
  );
  if (targets.length === 0) {
    return;
  }

  const media = matchMedia("(prefers-color-scheme: dark)");
  let rev = 0;

  const renderAll = async () => {
    const dark = media.matches;
    mermaid.initialize({
      startOnLoad: false,
      fontFamily: "inherit",
      theme: dark ? "dark" : "default",
    });

    rev += 1;

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];

      let svg;
      try {
        ({ svg } = await mermaid.render(`mmd-${rev}-${i}`, target.text));
      } catch {
        continue;
      }

      const figure = document.createElement("figure");
      figure.className = "mermaid-fig";
      figure.tabIndex = 0;
      figure.setAttribute("role", "button");
      figure.setAttribute("aria-label", "図を拡大表示");
      figure.innerHTML = svg;
      globalThis.md2htmlZoom?.decorate(figure);

      target.node.replaceWith(figure);
      target.node = figure;
    }
  };

  await renderAll();
  media.addEventListener("change", renderAll);
};
