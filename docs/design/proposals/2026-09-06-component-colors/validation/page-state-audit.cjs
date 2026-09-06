const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
let playwright;
try { playwright = require('playwright'); } catch {
  playwright = require('/Users/jack/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
}

const origin = 'http://127.0.0.1:1448';
const report = { recordedAt: new Date().toISOString(), engine: 'Installed Chrome, 1180 × 760; isolated browser only', readyPages: [], statePages: [], interactions: [], limitations: [
  'StorePage uses its actual fixed showcase data and has no whole-page loading/error/denied branches. No replacement page was invented.',
  'State projections and Skill install/toggle/uninstall actions are synthetic and memory-only. No native or backend behavior is validated.',
  'No production resources, existing .local preview files, executable files or permissions are changed.',
], errors: [] };
const url = (page, theme, variant = 'candidate', state = 'ready') => `${origin}/preview/index.html?page=${page}&theme=${theme}&variant=${variant}&state=${state}`;
const style = async (page, selector) => page.locator(selector).first().evaluate(el => {
  const s = getComputedStyle(el);
  return Object.fromEntries(['color', 'backgroundColor', 'borderColor', 'boxShadow', 'outlineWidth', 'outlineColor'].map(key => [key, s[key]]));
});

(async () => {
  const browser = await playwright.chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1180, height: 760 }, deviceScaleFactor: 1 });
    const errors = [], external = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (route.request().url().startsWith(`${origin}/`) || route.request().url().startsWith('data:')) return route.continue();
      external.push(route.request().url());
      return route.abort();
    });
    async function open(pageName, theme, variant = 'candidate', state = 'ready') {
      errors.length = 0; external.length = 0;
      await page.goto(url(pageName, theme, variant, state), { waitUntil: 'networkidle' });
      await page.locator('.yj-app-shell').waitFor();
      await page.waitForTimeout(200);
      assert.deepEqual(errors, [], `${pageName}/${state}: browser errors`);
      assert.deepEqual(external, [], `${pageName}/${state}: external requests`);
    }
    async function diagnostics() {
      const result = await page.evaluate(() => ({
        native: window.__COMPONENT_COLOR_PREVIEW__.native.attemptedCommands,
        memoryActions: [...window.__COMPONENT_COLOR_PREVIEW__.memoryActions],
      }));
      assert.deepEqual(result.native, [], 'No native IPC commands are attempted');
      return result;
    }

    for (const theme of ['light', 'dark']) for (const pageName of ['chat', 'store', 'plugins']) {
      for (const variant of ['current', 'candidate']) {
        await open(pageName, theme, variant);
        const item = { page: pageName, theme, variant, native: (await diagnostics()).native, selectors: {} };
        const selectors = pageName === 'chat'
          ? ['.chat-entry__subtitle', '.chat-entry__eyebrow', '.chat-composer__field', '.chat-composer__permission-value']
          : pageName === 'store'
            ? ['.yj-page-header__description', '.store-scene-card__description', '.yj-tabs__tab--selected', '.store-page__source-label']
            : ['.yj-page-header__description', '.skill-card', '.skill-card__description', '.skill-card__icon', '.skill-card__icon .yj-icon'];
        for (const selector of selectors) item.selectors[selector] = await style(page, selector);
        item.navigation = await style(page, '.yj-nav-item--selected');
        if (variant === 'candidate') {
          assert.match(item.navigation.boxShadow, /inset/, 'Selected navigation retains a position marker');
          if (pageName === 'chat') assert.equal(item.selectors['.chat-composer__field'].boxShadow, 'none');
          if (pageName === 'plugins') {
            assert.equal(item.selectors['.skill-card'].boxShadow, 'none');
            await page.locator('.skill-card').first().hover();
            await page.waitForTimeout(200);
            item.skillHover = await style(page, '.skill-card');
            assert.equal(item.skillHover.boxShadow, 'none');
            const refresh = page.getByRole('button', { name: '重新扫描本地 Skill' });
            item.refresh = await style(page, 'button[aria-label="重新扫描本地 Skill"]');
            assert.equal(item.refresh.backgroundColor, theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(37, 40, 43)');
            await refresh.click();
            await diagnostics();
          }
        }
        report.readyPages.push(item);
      }
    }

    for (const theme of ['light', 'dark']) for (const pageName of ['chat', 'plugins']) {
      for (const state of ['loading', 'empty', 'error', 'denied']) {
        await open(pageName, theme, 'candidate', state);
        const text = await page.locator('body').innerText();
        if (pageName === 'plugins') {
          const expected = { loading: '正在读取内置清单并扫描本地 Skill', empty: '当前客户端没有可展示的 Skill', error: '本地 Skill 服务暂不可用', denied: '无权访问 Skill 广场' }[state];
          assert(text.includes(expected), `${pageName}/${state}: actual page branch is visible`);
        } else {
          if (state === 'loading') assert(text.includes('正在启动本地服务'));
          if (state === 'denied') assert(text.includes('当前账号无权执行此操作'));
          if (state === 'error') assert.equal(await page.locator('.chat-notice[role="alert"]').count(), 1);
          if (state === 'empty') assert.equal(await page.locator('.chat-tree__session-link').count(), 0);
        }
        report.statePages.push({ page: pageName, theme, state, text, ...(await diagnostics()) });
      }
    }

    for (const theme of ['light', 'dark']) {
      await open('chat', theme);
      await page.locator('.chat-composer__textarea').focus();
      await page.waitForTimeout(200);
      const focus = await style(page, '.chat-composer__field');
      assert.match(focus.boxShadow, /0px 0px 0px 2px/, 'Composer has a visible 2 px neutral focus ring');
      await page.locator('.chat-composer__permission').click();
      await page.locator('.permission-dialog').waitFor();
      const dialog = await style(page, '.permission-dialog');
      await page.getByRole('button', { name: '知道了', exact: true }).click();
      report.interactions.push({ page: 'chat', theme, kind: 'focus-and-permission-dialog', focus, dialog, ...(await diagnostics()) });

      await open('plugins', theme);
      const card = page.locator('.skill-card').nth(1);
      await card.locator('button[aria-label^="安装 "]').click();
      await card.getByRole('switch').waitFor();
      assert.equal(await card.getByRole('switch').getAttribute('aria-checked'), 'true');
      await card.getByRole('switch').click();
      assert.equal(await card.getByRole('switch').getAttribute('aria-checked'), 'false');
      report.interactions.push({ page: 'plugins', theme, kind: 'synthetic-install-and-toggle', ...(await diagnostics()) });
    }
  } catch (error) {
    report.errors.push(error.stack || String(error));
    process.exitCode = 1;
  } finally {
    await browser.close();
    await fs.writeFile(path.join(__dirname, 'page-state-audit.json'), JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify({ readyPages: report.readyPages.length, statePages: report.statePages.length, interactions: report.interactions.length, errors: report.errors }));
})();
