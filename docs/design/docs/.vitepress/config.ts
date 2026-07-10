import { defineConfig } from 'vitepress'

export default defineConfig({
  title: '易界 Design System',
  description: 'yijie-desktop Design System / UX 规范',
  lang: 'zh-CN',
  themeConfig: {
    logo: '/brand/yijie-bag-logo.svg',
    nav: [
      { text: '总览', link: '/design/' },
      { text: 'AI 规则', link: '/design/07-ai-codex/01-ai-development-rules' },
      { text: '实现', link: '/design/09-implementation/01-recommended-file-structure' }
    ],
    sidebar: [
      {
        text: '00 总览',
        items: [
          { text: 'Design System 总览', link: '/design/' },
          { text: '终版决策记录', link: '/design/00-final-decisions' },
          { text: '文档标准', link: '/design/01-documentation-standard' }
        ]
      },
      {
        text: '01 Foundations',
        items: [
          { text: '产品上下文', link: '/design/01-foundations/01-product-context' },
          { text: '设计原则', link: '/design/01-foundations/02-design-principles' },
          { text: '品牌气质', link: '/design/01-foundations/03-brand-personality' },
          { text: 'macOS 平台原则', link: '/design/01-foundations/04-platform-principles-macos' },
          { text: '可访问性基线', link: '/design/01-foundations/05-accessibility-baseline' },
          { text: '窗口与密度', link: '/design/01-foundations/06-window-density-baseline' }
        ]
      },
      {
        text: '02 Tokens',
        items: [
          { text: 'Token 架构', link: '/design/02-tokens/01-token-architecture' },
          { text: '颜色 Tokens', link: '/design/02-tokens/02-color-tokens' },
          { text: '字体 Tokens', link: '/design/02-tokens/03-typography-tokens' },
          { text: '间距与布局 Tokens', link: '/design/02-tokens/04-spacing-layout-tokens' },
          { text: '圆角边框阴影 Tokens', link: '/design/02-tokens/05-radius-border-shadow-tokens' },
          { text: '动效层级透明度 Tokens', link: '/design/02-tokens/06-motion-zindex-opacity-tokens' }
        ]
      },
      {
        text: '03 UI System',
        items: [
          { text: 'Naive UI 集成', link: '/design/03-ui-system/01-naive-ui-integration' },
          { text: '图标系统', link: '/design/03-ui-system/02-iconography' },
          { text: '插画与图片', link: '/design/03-ui-system/03-illustration-imagery' },
          { text: '数据可视化', link: '/design/03-ui-system/04-data-visualization' },
          { text: '主题与暗色模式', link: '/design/03-ui-system/05-theme-dark-mode' },
          { text: '品牌资产', link: '/design/03-ui-system/06-brand-assets' }
        ]
      },
      {
        text: '04 Components',
        items: [
          { text: '组件编写标准', link: '/design/04-components/00-component-authoring-standard' },
          { text: '布局组件', link: '/design/04-components/01-layout-components' },
          { text: '导航组件', link: '/design/04-components/02-navigation-components' },
          { text: '操作组件', link: '/design/04-components/03-action-components' },
          { text: '表单组件', link: '/design/04-components/04-form-components' },
          { text: '反馈组件', link: '/design/04-components/05-feedback-components' },
          { text: '数据展示组件', link: '/design/04-components/06-data-display-components' },
          { text: 'Agent 组件', link: '/design/04-components/07-agent-components' },
          { text: '电商领域组件', link: '/design/04-components/08-commerce-domain-components' }
        ]
      },
      {
        text: '05 Patterns',
        items: [
          { text: 'App Shell', link: '/design/05-patterns/01-app-shell-navigation' },
          { text: 'Chat 工作区', link: '/design/05-patterns/02-chat-workspace' },
          { text: 'Agent 任务流', link: '/design/05-patterns/03-agent-task-flow' },
          { text: '店铺授权', link: '/design/05-patterns/04-store-authorization' },
          { text: 'Listing 诊断', link: '/design/05-patterns/05-listing-diagnosis' },
          { text: '广告分析', link: '/design/05-patterns/06-ads-analytics' },
          { text: '合规风险', link: '/design/05-patterns/07-compliance-risk' },
          { text: '物流追踪', link: '/design/05-patterns/08-logistics-tracking' },
          { text: '设置与权限', link: '/design/05-patterns/09-settings-permissions' },
          { text: '插件市场', link: '/design/05-patterns/10-plugin-marketplace' },
          { text: '经营分析', link: '/design/05-patterns/11-store-analytics' }
        ]
      },
      {
        text: '06 Content',
        items: [
          { text: '文案规范', link: '/design/06-content/01-copywriting' },
          { text: '中文与本地化', link: '/design/06-content/02-i18n-l10n' },
          { text: '错误空态加载', link: '/design/06-content/03-error-empty-loading' },
          { text: '风险与审批文案', link: '/design/06-content/04-risk-and-approval-copy' },
          { text: '数据指标文案', link: '/design/06-content/05-data-metric-copy' }
        ]
      },
      {
        text: '07 AI / Codex',
        items: [
          { text: 'AI 开发规则', link: '/design/07-ai-codex/01-ai-development-rules' },
          { text: '页面生成契约', link: '/design/07-ai-codex/02-codex-page-generation-contract' },
          { text: 'UI Review 清单', link: '/design/07-ai-codex/03-ui-review-checklist' },
          { text: 'Prompt 片段', link: '/design/07-ai-codex/04-prompt-snippets' },
          { text: '禁止模式', link: '/design/07-ai-codex/05-prohibited-patterns' },
          { text: 'AGENTS.md 片段', link: '/design/07-ai-codex/06-agents-md-snippet' }
        ]
      },
      {
        text: '08 Governance',
        items: [
          { text: '设计评审流程', link: '/design/08-governance/01-design-review-process' },
          { text: '版本与变更', link: '/design/08-governance/02-versioning-change-management' },
          { text: 'ADR 模板', link: '/design/08-governance/03-adr-template' },
          { text: '贡献指南', link: '/design/08-governance/04-contribution-guide' },
          { text: '质量门禁', link: '/design/08-governance/05-quality-gates' },
          { text: '后续策略预留', link: '/design/08-governance/06-deferred-policy-decisions' }
        ]
      },
      {
        text: '09 Implementation',
        items: [
          { text: '推荐文件结构', link: '/design/09-implementation/01-recommended-file-structure' },
          { text: 'Token 代码骨架', link: '/design/09-implementation/02-design-token-code-scaffold' },
          { text: 'YjIcon 代码骨架', link: '/design/09-implementation/03-yj-icon-code-scaffold' },
          { text: 'Naive 主题代码骨架', link: '/design/09-implementation/04-naive-theme-code-scaffold' },
          { text: '组件 API 示例', link: '/design/09-implementation/05-component-api-examples' },
          { text: 'ECharts 代码骨架', link: '/design/09-implementation/06-echarts-code-scaffold' },
          { text: 'Logo 代码骨架', link: '/design/09-implementation/07-logo-code-scaffold' }
        ]
      },
      {
        text: '10 References',
        items: [
          { text: '参考资料', link: '/design/10-references' }
        ]
      }
    ],
    search: { provider: 'local' },
    outline: [2, 3]
  }
})
