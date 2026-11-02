import { computed, createApp, defineComponent, h, ref } from "vue";
import { NConfigProvider, darkTheme } from "naive-ui";
import { createNaiveThemeOverrides } from "../../../src/design/theme/naive-theme";
import ChatAnswerActions from "../../../src/components/chat/ChatAnswerActions.vue";
import "../../../src/styles/variables.css";
import "../../../src/styles/main.css";
import "../chat-preloading/preview.css";

// Normal UI samples; no Native bridge, feedback endpoint or model requests.
createApp(defineComponent({setup() {
  const dark=ref(false), copies=ref(0);
  const adapter={writeText:async()=>{copies.value++;}};
  const theme=computed(()=>{void dark.value;return createNaiveThemeOverrides(name=>getComputedStyle(document.documentElement).getPropertyValue(name));});
  const samples=[
    {id:'one',model:'kimi-k3-1-pro-max-v1',text:'出发前核对预约和交通安排，给步行与休息留出时间。',time:new Date(2026,10,2,11,39).getTime()/1000},
    {id:'two',model:'minimax-m3-high-v1',text:'另一条独立回答，用于核对模型、时间以及评价状态互不串用。',time:new Date(2026,10,2,11,42).getTime()/1000},
  ];
  return ()=>h(NConfigProvider,{theme:dark.value?darkTheme:null,themeOverrides:theme.value},()=>h('main',[
    h('h1','回答操作组'),
    h('nav',{class:'preview-controls'},[h('button',{onClick:()=>{dark.value=!dark.value;document.documentElement.dataset.theme=dark.value?'dark':'light';}},'切换亮暗色')]),
    h('section',{class:'preview-window',style:{width:'min(1180px, 100%)',height:'760px'}},[
      h('header',{class:'preview-title'},'普通本地示例 · 生产组件 · 评价不影响模型'),
      h('div',{class:'preview-conversation'},samples.map(sample=>h('article',{style:{maxWidth:'760px',margin:'var(--yj-space-8) auto'},'aria-label':sample.model},[
        h('h2',{style:{fontSize:'var(--yj-font-size-card-title)'}},'建议这样安排'),
        h('p',{style:{marginBlock:'var(--yj-space-4)'}},sample.text),
        h(ChatAnswerActions,{identity:sample.id,text:sample.text,adapter,modelProfileId:sample.model,completedAt:sample.time}),
      ]))),
      h('div',{class:'preview-composer'},'输入区域'),
    ]),
    h('p',{'aria-label':'复制验证次数'},`复制调用：${copies.value}`),
  ]));
}})).mount('#app');
