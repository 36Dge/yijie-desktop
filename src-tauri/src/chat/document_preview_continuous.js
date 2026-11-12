// Runs only in the Native-generated reader, never in a supplied HTML document.
(() => {
  const root = document.getElementById("document-pages");
  const status = document.getElementById("document-stream-status");
  const pages = [...root.children];
  let pending = null;
  let scheduled = false;
  let restore = window.__yijieDocumentRestore;

  function appendNext(page) {
    if (page.dataset.more !== "true" || pages[Number(page.dataset.index) + 1]) return;
    const next = document.createElement("article");
    next.className = "document-page";
    next.dataset.index = String(pages.length);
    next.dataset.state = "unloaded";
    next.setAttribute("aria-busy", "true");
    pages.push(next);
    root.append(next);
  }
  function schedule() {
    if (!scheduled) { scheduled = true; requestAnimationFrame(update); }
  }
  function update() {
    scheduled = false;
    const height = innerHeight;
    const tail = pages.at(-1);
    const measuredHeight = document.documentElement.scrollHeight - (tail.dataset.more === undefined ? tail.offsetHeight : 0);
    if (restore && (measuredHeight >= restore.y + height || tail.dataset.more === "false")) {
      window.scrollTo(restore.x, restore.y);
      restore = null;
    }
    const nearby = pages.map(page => ({ page, rect: page.getBoundingClientRect() }))
      .filter(({ rect }) => rect.bottom >= -height && rect.top <= 2 * height)
      .sort((a, b) => Math.abs(a.rect.top - height / 2) - Math.abs(b.rect.top - height / 2))
      .slice(0, 4).map(({ page }) => page);
    // Retain measured placeholders so releasing old DOM/images never removes
    // the scroll range. Returning to a page reads the same immutable source.
    for (const page of pages) {
      if (page.dataset.state === "ready" && !nearby.includes(page)) {
        page.style.height = `${page.offsetHeight}px`;
        page.style.minHeight = "0";
        page.replaceChildren();
        page.dataset.state = "unloaded";
      }
    }
    const next = restore ? pages.at(-1) : nearby.find(page => page.dataset.state === "unloaded");
    if (pending !== null || !next || next.dataset.state !== "unloaded") return;
    pending = Number(next.dataset.index);
    next.setAttribute("aria-busy", "true");
    status.textContent = "正在加载后续内容…";
    window.ipc.postMessage(JSON.stringify({ page: pending }));
  }
  window.__yijieDocumentPage = payload => {
    if (payload.index !== pending || !pages[pending]) return;
    const page = pages[pending];
    pending = null;
    page.setAttribute("aria-busy", "false");
    if (payload.error) {
      page.dataset.state = "failed";
      page.textContent = "此段内容暂时无法显示，请关闭后重新打开预览。";
      status.textContent = "部分内容未能加载";
      restore = null;
      return;
    }
    // This is escaped, Native-generated markup from a bounded adapter.
    page.innerHTML = payload.html;
    page.dataset.state = "ready";
    page.dataset.more = String(payload.more);
    page.style.removeProperty("height");
    page.style.removeProperty("min-height");
    status.textContent = "";
    appendNext(page);
    schedule();
  };
  appendNext(pages[0]);
  addEventListener("scroll", schedule, { passive: true });
  addEventListener("resize", schedule);
  addEventListener("load", schedule);
  // Images may change a chunk's measured height after it has been appended.
  root.addEventListener("load", schedule, true);
  schedule();
})();
