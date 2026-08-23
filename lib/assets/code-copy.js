// コードブロックのコピー・ボタンを扱う。document への委譲リスナ 1 本のみ
// 登録し、動的に増える .code-block にも対応する。
(() => {
  // 一時表示 (成功 / 失敗) を元の文言へ戻すまでの時間 (ミリ秒)。
  const RESET_DELAY = 1500;
  // 戻し待ちのボタンごとの状態 (タイマー ID・元の文言・付けたクラス)。
  const pending = new WeakMap();

  /**
   * ボタンの文言とクラスを一時的に差し替え、一定時間後に元へ戻す。
   * 連続クリックでは前回の戻し待ちを取り消してから掛け直す。
   */
  const flash = (button, label, className) => {
    const previous = pending.get(button);
    if (previous) {
      clearTimeout(previous.id);
      button.textContent = previous.original;
      button.classList.remove(previous.className);
      pending.delete(button);
    }

    const original = button.textContent;
    button.textContent = label;
    button.classList.add(className);
    const id = setTimeout(() => {
      button.textContent = original;
      button.classList.remove(className);
      pending.delete(button);
    }, RESET_DELAY);
    pending.set(button, { id, original, className });
  };

  document.addEventListener("click", async (event) => {
    // テキストノードなど Element 以外がターゲットになる場合があるため、
    // closest を呼ぶ前に絞る。
    if (!(event.target instanceof Element)) {
      return;
    }

    const button = event.target.closest(".code-copy");
    if (!button) {
      return;
    }

    const block = button.closest(".code-block");
    const pre = block ? block.querySelector("pre") : null;
    if (!pre) {
      return;
    }

    // クリップボード API が無い環境 (非セキュアコンテキスト等) では
    // 黙って何もせず壊れて見えるのを避け、失敗として表示する。
    if (!navigator.clipboard) {
      flash(button, "コピー失敗", "copy-failed");
      return;
    }

    const text = (pre.textContent ?? "").replace(/\n$/, "");

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      flash(button, "コピー失敗", "copy-failed");
      return;
    }

    flash(button, "コピー済", "copied");
  });
})();
