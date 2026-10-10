// クリックした要素をモーダル (<dialog class="zoom-dialog">) に複製して表示し、
// その中でパン・ズーム (ドラッグ / ホイール / ボタン / ダブルクリックで全体表示)
// できるようにする。対象は mermaid 図 (figure.mermaid-fig) と、frontmatter の
// md2html.zoomTargets で指定された CSS セレクタにマッチする要素
// (id="md2html-zoom-targets" の <script type="application/json"> から読む。
// 中身はセレクタの配列か、UI 文言の上書きを伴う場合の { targets, labels })。
// click / keydown は document への委譲リスナで扱うため、後から描画される mermaid 図
// (figure.mermaid-fig) にも追従する。zoomTargets のセレクタは読み込み時に 1 回だけ
// 適用する (後から生成される要素には付かない)。mermaid 図へ「拡大」バッジを付けるため
// globalThis.md2htmlZoom.decorate を公開し、mermaid bundle 側 (mermaid-render.js) から呼ばせる。
(() => {
  const MERMAID_FIGURE = ".mermaid-fig";
  const IMAGE_WRAPPER = ".img-zoom";
  const TARGETS_ID = "md2html-zoom-targets";
  // クリックを横取りしない操作子。HTML の <a href> に加え、mermaid の click 指定が
  // 出力する SVG の <a xlink:href>、ボタン・入力欄などを含む。
  const INTERACTIVE_SELECTOR =
    "a[href], a[*|href], button, input, select, textarea, summary, label, [contenteditable]";
  const EXPAND_ICON =
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 1.5H2.25A.75.75 0 0 0 1.5 2.25V6.5h1.5V3h3.5Zm3 0V3H13v3.5h1.5V2.25a.75.75 0 0 0-.75-.75Zm5 8H13V13H9.5v1.5h4.25a.75.75 0 0 0 .75-.75Zm-13 0V13.75c0 .414.336.75.75.75H6.5V13H3V9.5Z"/></svg>';
  // UI 文言の既定値 (日本語)。JSON ブロックの labels で個別に上書きできる。
  // `{name}` は対象の名前 (画像の alt・モーダルのキャプション) に置換する。
  const DEFAULT_LABELS = {
    image: "画像",
    figure: "図",
    zoomBadge: "拡大",
    zoomImageLabel: "{name}を拡大表示",
    zoomDialogLabel: "{name}拡大表示",
    zoomClose: "閉じる",
    zoomIn: "拡大",
    zoomOut: "縮小",
    zoomFit: "全体表示",
    zoomHint:
      "ドラッグで移動 · ホイールで拡大縮小 · ダブルクリックで全体表示 · Esc で閉じる",
  };

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  /** HTML エスケープ (innerHTML / 属性値へ文言を埋め込むため)。 */
  const escapeHtml = (text) =>
    String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  /** 文言テンプレートの `{name}` を値で置換する。 */
  const format = (template, name) => template.replaceAll("{name}", name);

  /**
   * 埋め込み JSON (id="md2html-zoom-targets") を読む。中身は zoomTargets の配列か、
   * 文言の上書きを伴う場合の `{ targets, labels }` オブジェクト。壊れていれば既定へ倒す。
   * セレクタの検証はここでは行わない (文書全体の走査より前に文言を確定させるため)。
   */
  const readConfig = () => {
    const node = document.getElementById(TARGETS_ID);
    let parsed = null;
    if (node) {
      try {
        parsed = JSON.parse(node.textContent ?? "null");
      } catch {
        parsed = null;
      }
    }
    if (Array.isArray(parsed)) {
      return { targets: parsed, labels: { ...DEFAULT_LABELS } };
    }
    const labels = { ...DEFAULT_LABELS };
    let targets = [];
    if (parsed && typeof parsed === "object") {
      if (Array.isArray(parsed.targets)) {
        targets = parsed.targets;
      }
      const raw = parsed.labels;
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        for (const key of Object.keys(DEFAULT_LABELS)) {
          if (typeof raw[key] === "string") {
            labels[key] = raw[key];
          }
        }
      }
    }
    return { targets, labels };
  };

  const config = readConfig();
  const LABELS = config.labels;

  /** 拡大対象 (mermaid 図 / 画像ラッパ) へ拡大バッジを付ける。 */
  const decorate = (element) => {
    if (element.querySelector(":scope > .fig-expand")) {
      return;
    }
    element.insertAdjacentHTML(
      "beforeend",
      `<span class="fig-expand">${EXPAND_ICON}${escapeHtml(
        LABELS.zoomBadge,
      )}</span>`,
    );
  };

  /**
   * 要素の固有サイズ (CSS px) を決める。svg は viewBox、img は自然サイズ。
   * 決められなければ null (未ロードの画像、viewBox の無い svg 等)。
   */
  const intrinsicSize = (element) => {
    if (element instanceof SVGSVGElement) {
      const viewBox = element.getAttribute("viewBox");
      if (viewBox) {
        const parts = viewBox
          .trim()
          .split(/[\s,]+/)
          .map(Number);
        if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
          return { width: parts[2], height: parts[3] };
        }
      }
      return null;
    }
    if (element instanceof HTMLImageElement) {
      return element.naturalWidth > 0 && element.naturalHeight > 0
        ? { width: element.naturalWidth, height: element.naturalHeight }
        : null;
    }
    return null;
  };

  /**
   * モーダルに置く複製のサイズ (CSS px) を決める。固有サイズがあればそれを、
   * 無ければ元要素が文書中で占める実寸を使う (表などの折り返しは文書中と同じになる)。
   * どちらも取れなければ仮サイズ。
   */
  const measure = (source) => {
    const intrinsic = intrinsicSize(source);
    if (intrinsic) {
      return intrinsic;
    }
    const rect = source.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return { width: rect.width, height: rect.height };
    }
    return { width: 400, height: 300 };
  };

  /**
   * 複製から文書内向けの操作子 (拡大バッジ・zoom-target / img-zoom の印) を外す。
   * モーダル内では click / keydown を受け付けないため、残すと死んだ操作子になる。
   */
  const sanitizeClone = (clone) => {
    if (!(clone instanceof Element)) {
      return;
    }
    for (const badge of clone.querySelectorAll(".fig-expand")) {
      badge.remove();
    }
    for (const node of [clone, ...clone.querySelectorAll(".zoom-target")]) {
      node.classList.remove("zoom-target");
    }
    for (const wrapper of clone.querySelectorAll(IMAGE_WRAPPER)) {
      wrapper.classList.remove("img-zoom");
      wrapper.removeAttribute("tabindex");
      wrapper.removeAttribute("role");
      wrapper.removeAttribute("aria-label");
    }
  };

  /**
   * パン・ズーム操作を stage (操作面) / viewport (transform を掛ける要素) へ仕込む。
   * 仕込んだリスナを全て外す関数を返す。
   */
  const setupZoom = (stage, viewport, width, height, onClose) => {
    viewport.style.width = `${width}px`;
    viewport.style.height = `${height}px`;

    let scale = 1;
    let tx = 0;
    let ty = 0;
    let minS = 0.1;
    let maxS = 10;
    // ユーザがズーム・パンしたか。resize 時に基準状態へ戻すかの判定に使う。
    let touched = false;

    const apply = () => {
      viewport.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    };

    // 操作面の実寸に contain フィットして中央配置する (全体表示 = 基準状態)。
    const reset = () => {
      const cw = stage.clientWidth;
      const ch = stage.clientHeight;
      const fit = cw > 0 && ch > 0 ? Math.min(cw / width, ch / height) : 1;
      minS = Math.min(fit, 1) * 0.4;
      maxS = Math.max(fit, 1) * 6;
      scale = fit;
      tx = (cw - width * scale) / 2;
      ty = (ch - height * scale) / 2;
      touched = false;
      apply();
    };

    // (px, py) を固定点として倍率を factor 倍する。
    const zoomAt = (px, py, factor) => {
      const next = clamp(scale * factor, minS, maxS);
      const ratio = next / scale;
      tx = px - (px - tx) * ratio;
      ty = py - (py - ty) * ratio;
      scale = next;
      touched = true;
      apply();
    };

    const onWheel = (event) => {
      event.preventDefault();
      // 横スクロール (deltaY が 0) では倍率を変えない。
      if (event.deltaY === 0) {
        return;
      }
      const rect = stage.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      zoomAt(px, py, factor);
    };

    let dragging = false;
    let originX = 0;
    let originY = 0;

    const onPointerDown = (event) => {
      if (event.button !== 0 || event.target.closest(".mz-btn")) {
        return;
      }
      // 画像のネイティブ drag & drop (pointercancel でパンが止まる) を抑止する。
      event.preventDefault();
      dragging = true;
      originX = event.clientX - tx;
      originY = event.clientY - ty;
      stage.classList.add("dragging");
      try {
        stage.setPointerCapture(event.pointerId);
      } catch {
        // 既に無効になったポインタ (合成イベント等) では capture できないが、パン自体は続行できる。
      }
    };

    const onPointerMove = (event) => {
      if (!dragging) {
        return;
      }
      tx = event.clientX - originX;
      ty = event.clientY - originY;
      touched = true;
      apply();
    };

    const endDrag = () => {
      dragging = false;
      stage.classList.remove("dragging");
    };

    // ウィンドウサイズ変更時は、ユーザがまだ操作していないときだけ再フィットする
    // (操作中の位置・倍率を勝手に捨てない。モバイルのアドレスバー表示切替でも resize が飛ぶ)。
    const onResize = () => {
      if (!touched) {
        reset();
      }
    };

    const onDragStart = (event) => {
      event.preventDefault();
    };

    const onDblClick = (event) => {
      if (event.target.closest(".mz-btn")) {
        return;
      }
      event.preventDefault();
      reset();
    };

    const onControls = (event) => {
      const button = event.target.closest(".mz-btn");
      if (!button) {
        return;
      }
      const action = button.dataset.a;
      if (action === "in") {
        zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 1.25);
      } else if (action === "out") {
        zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 1 / 1.25);
      } else if (action === "reset") {
        reset();
      } else if (action === "close") {
        onClose();
      }
    };

    stage.addEventListener("wheel", onWheel, { passive: false });
    stage.addEventListener("pointerdown", onPointerDown);
    stage.addEventListener("pointermove", onPointerMove);
    stage.addEventListener("pointerup", endDrag);
    stage.addEventListener("pointercancel", endDrag);
    // capture が取れなかった場合でも、stage の外で離したらドラッグを終える。
    globalThis.addEventListener("pointerup", endDrag);
    stage.addEventListener("dragstart", onDragStart);
    stage.addEventListener("dblclick", onDblClick);
    stage.addEventListener("click", onControls);
    globalThis.addEventListener("resize", onResize);

    requestAnimationFrame(reset);

    return () => {
      stage.removeEventListener("wheel", onWheel);
      stage.removeEventListener("pointerdown", onPointerDown);
      stage.removeEventListener("pointermove", onPointerMove);
      stage.removeEventListener("pointerup", endDrag);
      stage.removeEventListener("pointercancel", endDrag);
      globalThis.removeEventListener("pointerup", endDrag);
      stage.removeEventListener("dragstart", onDragStart);
      stage.removeEventListener("dblclick", onDblClick);
      stage.removeEventListener("click", onControls);
      globalThis.removeEventListener("resize", onResize);
    };
  };

  let dialog = null;
  let stage = null;
  let viewport = null;
  let captionNode = null;
  let teardown = null;

  /** モーダル DOM は 1 つだけ遅延生成し、開閉のたびに中身を入れ替える。 */
  const ensureDialog = () => {
    if (dialog) {
      return dialog;
    }
    dialog = document.createElement("dialog");
    dialog.className = "zoom-dialog";
    dialog.innerHTML = `<div class="zm-stage" tabindex="-1">
  <div class="mz-viewport md"></div>
  <div class="mz-controls">
    <button class="mz-btn" type="button" data-a="close" title="${escapeHtml(
      LABELS.zoomClose,
    )}">✕</button>
    <button class="mz-btn" type="button" data-a="in" title="${escapeHtml(
      LABELS.zoomIn,
    )}">+</button>
    <button class="mz-btn" type="button" data-a="out" title="${escapeHtml(
      LABELS.zoomOut,
    )}">−</button>
    <button class="mz-btn" type="button" data-a="reset" title="${escapeHtml(
      LABELS.zoomFit,
    )}">↺</button>
  </div>
  <span class="mz-hint">${escapeHtml(LABELS.zoomHint)}</span>
  <span class="zm-caption" hidden></span>
</div>`;
    stage = dialog.querySelector(".zm-stage");
    viewport = dialog.querySelector(".mz-viewport");
    captionNode = dialog.querySelector(".zm-caption");

    // 操作面の外 (dialog 自身の余白 = 背景) を押したら閉じる。
    dialog.addEventListener("pointerdown", (event) => {
      if (event.target === dialog) {
        dialog.close();
      }
    });
    // 余白の上でホイールしても背面の文書をスクロールさせない。
    dialog.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
      },
      { passive: false },
    );
    // Esc (cancel → close) / close() のどちらでも後片付けする。
    dialog.addEventListener("close", () => {
      if (teardown) {
        teardown();
        teardown = null;
      }
      stage.classList.remove("dragging");
      viewport.replaceChildren();
      viewport.removeAttribute("style");
    });
    document.body.append(dialog);
    return dialog;
  };

  /** 複製へ内容サイズを明示してパン・ズームを (再) 設定する。 */
  const mount = (modal, clone, size) => {
    clone.style.width = `${size.width}px`;
    clone.style.height = `${size.height}px`;
    if (teardown) {
      teardown();
    }
    teardown = setupZoom(stage, viewport, size.width, size.height, () =>
      modal.close(),
    );
  };

  /** element を複製してモーダルに表示し、パン・ズームを有効にする。 */
  const openModal = (element, caption) => {
    const modal = ensureDialog();
    if (modal.open) {
      return;
    }
    // サイズは元要素が文書中にある間に決める (固有サイズ、無ければ文書中の実寸)。
    const size = measure(element);
    const clone = element.cloneNode(true);
    sanitizeClone(clone);
    // 複製は元要素の width / height 属性や style に左右されないようにし、
    // サイズは計測結果で明示する。
    clone.removeAttribute("width");
    clone.removeAttribute("height");
    clone.style.maxWidth = "none";
    clone.style.margin = "0";
    if (clone instanceof HTMLImageElement) {
      clone.draggable = false;
    }
    viewport.replaceChildren(clone);
    captionNode.textContent = caption;
    captionNode.hidden = caption === "";
    modal.setAttribute("aria-label", format(LABELS.zoomDialogLabel, caption));
    modal.showModal();

    mount(modal, clone, size);
    // 未ロードの画像は文書中の実寸 (または仮サイズ) で置き、ロード後に自然サイズで置き直す。
    if (clone instanceof HTMLImageElement && !clone.complete) {
      clone.addEventListener(
        "load",
        () => {
          if (!modal.open || clone.parentElement !== viewport) {
            return;
          }
          const loaded = intrinsicSize(clone);
          if (loaded) {
            mount(modal, clone, loaded);
          }
        },
        { once: true },
      );
    }
    stage.focus();
  };

  /** 読み込んだ md2html.zoomTargets のセレクタを検証する。不正なセレクタは警告して読み飛ばす。 */
  const validTargets = () => {
    return config.targets.filter((selector) => {
      if (typeof selector !== "string" || selector === "") {
        return false;
      }
      try {
        document.querySelectorAll(selector);
        return true;
      } catch {
        console.warn(
          `md2html: zoomTargets のセレクタを解釈できないため無視する: ${selector}`,
        );
        return false;
      }
    });
  };

  /** img を span.img-zoom で包み、バッジとキーボード操作用の属性を付ける。 */
  const wrapImage = (img) => {
    if (img.closest(IMAGE_WRAPPER)) {
      return;
    }
    const wrapper = document.createElement("span");
    wrapper.className = "img-zoom";
    wrapper.tabIndex = 0;
    wrapper.setAttribute("role", "button");
    wrapper.setAttribute(
      "aria-label",
      format(LABELS.zoomImageLabel, img.getAttribute("alt") || LABELS.image),
    );
    img.replaceWith(wrapper);
    wrapper.append(img);
    decorate(wrapper);
  };

  /** 起点要素から拡大対象 (複製する要素とキャプション) を引く。見つからなければ null。 */
  const resolveTarget = (origin) => {
    if (!(origin instanceof Element) || origin.closest(".zoom-dialog")) {
      return null;
    }
    const figure = origin.closest(MERMAID_FIGURE);
    if (figure) {
      const svg = figure.querySelector("svg");
      return svg ? { element: svg, caption: LABELS.figure } : null;
    }
    const wrapper = origin.closest(IMAGE_WRAPPER);
    if (wrapper) {
      const img = wrapper.querySelector("img");
      return img
        ? { element: img, caption: img.getAttribute("alt") || LABELS.image }
        : null;
    }
    const hit = origin.closest(".zoom-target");
    return hit ? { element: hit, caption: "" } : null;
  };

  /** click / keydown の共通処理。対象があればモーダルを開き true を返す。 */
  const openFrom = (event) => {
    const origin = event.target;
    // 対象の内側にあるリンク (mermaid の click 指定や表中のリンク) は
    // リンクの動作を優先する。
    if (origin instanceof Element && origin.closest(INTERACTIVE_SELECTOR)) {
      return false;
    }
    const target = resolveTarget(origin);
    if (!target) {
      return false;
    }
    event.preventDefault();
    openModal(target.element, target.caption);
    return true;
  };

  document.addEventListener("click", (event) => {
    // 表のテキストをドラッグ選択した直後の click では開かない。
    const selection = getSelection();
    if (selection && !selection.isCollapsed) {
      return;
    }
    openFrom(event);
  });

  // mermaid 図 / 画像ラッパ (tabindex=0, role=button) は Enter / Space でも開く。
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    if (
      !(event.target instanceof Element) ||
      !event.target.matches(`${MERMAID_FIGURE}, ${IMAGE_WRAPPER}`)
    ) {
      return;
    }
    openFrom(event);
  });

  // リスナー登録の後で行う。ここでの例外が mermaid 図の拡大まで巻き込まないようにするため。
  // 対象は本文 (article.md) の中だけから探す。目次や枠組みの要素は対象にしない。
  const article = document.querySelector("article.md") ?? document.body;
  const userTargets = validTargets();
  for (const selector of userTargets) {
    for (const element of article.querySelectorAll(selector)) {
      // リンク内の要素はリンクの動作を優先し、対象にしない。
      if (element.closest(INTERACTIVE_SELECTOR)) {
        continue;
      }
      if (element instanceof HTMLImageElement) {
        wrapImage(element);
      } else {
        element.classList.add("zoom-target");
      }
    }
  }

  globalThis.md2htmlZoom = { decorate };
})();
