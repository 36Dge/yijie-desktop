const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
let playwright;
try { playwright = require('playwright'); } catch {
  playwright = require(process.env.PLAYWRIGHT_MODULE || '/Users/jack/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
}
const proposal = __dirname;
const repo = path.resolve(proposal, '../../../..');
const dest = path.join(repo, '.local/component-color-review/captures');
const origin = 'http://127.0.0.1:1448';
const manifest = { capturedAt: new Date().toISOString(), engine: 'Installed Chrome / Playwright; not Tauri WebKit', images: [], sections: [], pages: [], interactions: [], warnings: [] };
const image = async (target, key) => {
  const file = key + '.png';
  await target.screenshot({ path: path.join(dest, file), animations: 'disabled' });
  manifest.images.push({ key, file });
};
const url = (page, theme, variant = 'candidate', state = 'ready') => `${origin}/preview/index.html?page=${page}&theme=${theme}&variant=${variant}&state=${state}`;
const styles = (locator) => locator.evaluate(el => {
  const s = getComputedStyle(el);
  return Object.fromEntries(['color', 'backgroundColor', 'borderColor', 'borderWidth', 'boxShadow', 'outline', 'fontSize', 'borderRadius'].map(k => [k, s[k]]));
});
async function setup(browser, width, height) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [], requests = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => {
    const request = route.request();
    if (request.url().startsWith(origin + '/') || request.url().startsWith('data:')) return route.continue();
    requests.push({ method: request.method(), origin: new URL(request.url()).origin });
    return route.abort();
  });
  return { page, errors, requests };
}
async function settled(page) { await page.waitForTimeout(180); }
async function forceAtlasStates(page) {
  const session = await page.context().newCDPSession(page);
  await session.send('DOM.enable'); await session.send('CSS.enable');
  const { root } = await session.send('DOM.getDocument');
  const nodes = await page.locator('[data-force-state]').evaluateAll(els => els.map((el, index) => {
    el.setAttribute('data-capture-force', String(index));
    return { index, state: el.getAttribute('data-force-state') };
  }));
  for (const item of nodes) {
    const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector: `[data-capture-force="${item.index}"]` });
    const state = item.state === 'pressed' ? 'active' : item.state;
    await session.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: state === 'focus' ? ['focus', 'focus-visible', 'focus-within'] : [state] });
  }
  return { session, count: nodes.length };
}
(async () => {
  await fs.mkdir(dest, { recursive: true });
  const browser = await playwright.chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const [size, width, height] of [['wide', 1440, 900], ['min', 1180, 760]]) {
      for (const name of ['chat', 'store', 'plugins']) for (const theme of ['light', 'dark']) {
        const pair = [];
        for (const variant of ['current', 'candidate']) {
          const { page, errors, requests } = await setup(browser, width, height);
          await page.goto(url(name, theme, variant), { waitUntil: 'networkidle' });
          await page.locator('.yj-app-shell').waitFor(); await settled(page);
          const summary = await page.evaluate(() => {
            const selectors = '.yj-app-shell,.yj-sidebar,.yj-logo,.yj-app-shell__content,.yj-page-header,.chat-composer,.chat-composer__field,.store-scene-card,.skill-card,.yj-metric-card';
            return {
              text: document.body.innerText,
              width: document.documentElement.scrollWidth,
              background: getComputedStyle(document.documentElement).backgroundColor,
              boxes: [...document.querySelectorAll(selectors)].filter(el => el.getBoundingClientRect().width > 0).map(el => {
                const r = el.getBoundingClientRect(), s = getComputedStyle(el);
                return { class: el.className, x: r.x, y: r.y, width: r.width, height: r.height, fontSize: s.fontSize, borderRadius: s.borderRadius, padding: s.padding, margin: s.margin };
              }),
            };
          });
          await image(page, `page-${name}-${theme}-${variant}-${size}`);
          const item = { page: name, theme, variant, size, ...summary, errors, externalRequests: requests };
          pair.push(item); manifest.pages.push(item);
          assert.equal(errors.length, 0, `${name}/${theme}/${variant} browser errors`);
          assert.equal(requests.length, 0, 'No external requests in isolated preview');
          assert(summary.width <= width, `${name} horizontal document overflow`);
          if (theme === 'light') assert.equal(summary.background, 'rgb(255, 255, 255)');
          await page.close();
        }
        assert.equal(pair[0].text, pair[1].text, `${name} content changed between variants`);
        assert.deepEqual(pair[0].boxes, pair[1].boxes, `${name}/${theme}/${size} layout/type/radius changed`);
      }
    }
    for (const theme of ['light', 'dark']) {
      const { page, errors, requests } = await setup(browser, 1180, 760);
      await page.goto(url('atlas', theme), { waitUntil: 'networkidle' });
      await page.locator('[data-atlas-section]').first().waitFor();
      await page.locator('details.atlas-details').evaluateAll(els => els.forEach(el => el.open = true));
      const forced = await forceAtlasStates(page);
      await settled(page);
      const sections = await page.locator('[data-atlas-section]').evaluateAll(els => els.map(el => ({ id: el.getAttribute('data-atlas-section'), title: el.querySelector('h2,h3')?.textContent || el.getAttribute('data-atlas-section') })));
      for (const section of sections) {
        if (!manifest.sections.some(s => s.id === section.id)) manifest.sections.push(section);
        await image(page.locator(`[data-atlas-section="${section.id}"]`), `atlas-${section.id}-${theme}`);
      }
      manifest.interactions.push({ theme, forcedPseudoSamples: forced.count, errors, externalRequests: requests });
      await forced.session.detach();
      assert.equal(errors.length, 0, 'State atlas browser errors');
      assert.equal(requests.length, 0);
      await page.close();
    }
    // Capture applicable transient states through real pointer/keyboard actions.
    const extras = [
      { id: 'input-hover', title: '交互核验 · 输入框悬停' },
      { id: 'input-focus', title: '交互核验 · 输入框键盘焦点' },
      { id: 'error-focus', title: '交互核验 · 错误与焦点并存' },
      { id: 'choice-focus', title: '交互核验 · 已选控件键盘焦点' },
      { id: 'select-menu', title: '交互核验 · 下拉选中、悬停与禁用' },
      { id: 'popover-open', title: '交互核验 · 说明浮层' },
      { id: 'dropdown-open', title: '交互核验 · 操作菜单' },
      { id: 'modal-open', title: '交互核验 · 确认弹窗' },
      { id: 'chat-focus', title: '真实页面 · 任务输入、可发送与焦点' },
      { id: 'chat-permission', title: '真实页面 · 权限说明弹窗' },
    ];
    manifest.sections.push(...extras);
    for (const theme of ['light', 'dark']) {
      const { page, errors, requests } = await setup(browser, 1180, 760);
      await page.goto(url('atlas', theme), { waitUntil: 'networkidle' });
      const field = page.locator('#atlas-input input');
      await field.hover(); await settled(page);
      await image(page.locator('[data-atlas-section="inputs"]'), `atlas-input-hover-${theme}`);
      await field.focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
      await settled(page);
      await image(page.locator('[data-atlas-section="inputs"]'), `atlas-input-focus-${theme}`);
      const normalFocus = await styles(page.locator('#atlas-input .n-input__state-border'));
      const textSelection = await field.evaluate(el => {
        const s = getComputedStyle(el, '::selection');
        return { color: s.color, background: s.backgroundColor };
      });
      assert.equal(textSelection.color, 'rgb(37, 40, 43)');
      assert.equal(textSelection.background, 'rgb(195, 243, 91)');
      await field.fill('主题切换后保留这段演示内容');
      await page.evaluate(t => window.__COMPONENT_COLOR_PREVIEW__.setAppearance({ theme: t }), theme === 'light' ? 'dark' : 'light');
      await settled(page); assert.equal(await field.inputValue(), '主题切换后保留这段演示内容');
      await page.evaluate(t => window.__COMPONENT_COLOR_PREVIEW__.setAppearance({ theme: t }), theme); await settled(page);
      assert.equal(await page.locator('#atlas-readonly-input input').getAttribute('readonly'), '');
      await page.locator('#atlas-error-input input').focus(); await settled(page);
      await image(page.locator('[data-atlas-section="inputs"]'), `atlas-error-focus-${theme}`);
      const errorFocus = await styles(page.locator('#atlas-error-input .n-input__state-border'));
      await page.locator('#atlas-checkbox').focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab'); await settled(page);
      await image(page.locator('[data-atlas-section="selection"]'), `atlas-choice-focus-${theme}`);
      await page.locator('#atlas-switch').click(); assert.equal(await page.locator('#atlas-switch').getAttribute('aria-checked'), 'false');
      await page.locator('#atlas-switch').click(); assert.equal(await page.locator('#atlas-switch').getAttribute('aria-checked'), 'true');
      await page.locator('#atlas-select').click();
      await page.locator('.n-base-select-menu:visible').waitFor();
      await page.locator('.n-base-select-option').filter({ hasText: '演示店铺 B' }).hover(); await settled(page);
      await image(page, `atlas-select-menu-${theme}`);
      await page.locator('.n-base-select-option').filter({ hasText: '演示店铺 B' }).click();
      assert((await page.locator('#atlas-select').innerText()).includes('演示店铺 B'));
      await page.locator('#atlas-popover-open').click(); await settled(page);
      await image(page, `atlas-popover-open-${theme}`);
      await page.getByRole('button', { name: '知道了', exact: true }).click();
      await page.locator('#atlas-dropdown-open').click(); await settled(page);
      await image(page, `atlas-dropdown-open-${theme}`);
      await page.keyboard.press('Escape');
      await page.locator('#atlas-modal-open').click(); await page.locator('.atlas-modal').waitFor(); await settled(page);
      await image(page, `atlas-modal-open-${theme}`);
      await page.getByRole('button', { name: '取消', exact: true }).click(); await settled(page);
      await page.locator('.atlas-modal').waitFor({ state: 'hidden' });
      const modalFocusRestored = await page.locator('#atlas-modal-open').evaluate(el => el === document.activeElement);
      assert(modalFocusRestored, 'Modal must restore trigger focus');
      await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
      const axe = await page.evaluate(async () => {
        const result = await window.axe.run({ exclude: [['#atlas-raw-secondary-primary'], ['.atlas-disabled']] }, { rules: { region: { enabled: false } } });
        return result.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) }));
      });
      assert.equal(axe.length, 0, 'Candidate atlas accessibility findings must be resolved');
      manifest.interactions.push({ theme, normalFocus, errorFocus, textSelection, themeSwitchPreservesInput: true, readonly: true, switchToggled: true, selectChanged: true, modalFocusRestored, axe, axeExclusions: ['Explicit unsupported raw primary+secondary counterexample', 'Isolated disabled-text color demonstration'] });
      await page.goto(url('chat', theme), { waitUntil: 'networkidle' });
      await page.locator('textarea').fill('检查商品信息');
      assert(await page.locator('.chat-composer__send').isEnabled());
      const send = await styles(page.locator('.chat-composer__send'));
      assert.equal(send.backgroundColor, 'rgb(195, 243, 91)');
      await page.locator('textarea').focus(); await settled(page);
      await image(page, `atlas-chat-focus-${theme}`);
      await page.getByRole('button', { name: /权限审批/ }).click();
      await page.getByRole('button', { name: '知道了', exact: true }).waitFor(); await settled(page);
      await image(page, `atlas-chat-permission-${theme}`);
      await page.getByRole('button', { name: '知道了', exact: true }).click();
      assert.equal(await page.locator('textarea').inputValue(), '检查商品信息');
      const native = await page.evaluate(() => window.__COMPONENT_COLOR_PREVIEW__.native.attemptedCommands);
      assert.equal(native.length, 0, 'No native commands even in preview');
      assert.equal(errors.length, 0); assert.equal(requests.length, 0);
      manifest.interactions.push({ theme, chatSend: send, permissionPreservesDraft: true, nativeAttemptedCommands: native, errors, externalRequests: requests });
      await page.close();
    }
  } finally { await browser.close(); }
  await fs.writeFile(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ images: manifest.images.length, pages: manifest.pages.length, sections: manifest.sections, comparisons: 'Identical content, geometry, font sizes, spacing and radii; 24 captures' }, null, 2));
})().catch(async error => {
  manifest.failure = error.stack;
  await fs.mkdir(dest, { recursive: true });
  await fs.writeFile(path.join(dest, 'manifest-partial.json'), JSON.stringify(manifest, null, 2));
  console.error(error);
  process.exitCode = 1;
});
