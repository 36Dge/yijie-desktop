// @vitest-environment happy-dom
import {mount} from "@vue/test-utils";
import {it,expect} from "vitest";
import ChatArchiveActivityDetails from "./ChatArchiveActivityDetails.vue";
it("renders stored file facts without executable actions or inferred counts",()=>{
 const wrapper=mount(ChatArchiveActivityDetails,{props:{item:{id:"file",type:"fileChange",status:"completed",availability:"partial",fileChange:{changes:[{index:0,kind:"add",pathLabel:"report.md",diffText:"Saved report\n",addedLines:1,removedLines:0},{index:1,kind:"update",pathLabel:"notes.md"}]}}}});
 expect(wrapper.text()).toContain("历史文件变更");expect(wrapper.text()).toContain("Saved report");expect(wrapper.text()).toContain("已完成");expect(wrapper.findAll("pre")).toHaveLength(1);expect(wrapper.findAll("button,a,input")).toHaveLength(0);expect(wrapper.text()).toContain("原记录未提供可显示的变更内容");wrapper.unmount();
});
it("preserves command and app display context as history only",()=>{
 const wrapper=mount(ChatArchiveActivityDetails,{props:{item:{id:"command",type:"commandExecution",status:"failed",availability:"partial",commandActions:[{index:2,type:"read",pathLabel:"report.csv",commandPreview:"Read report.csv"}],appContext:{appName:"Reports",actionName:"Read saved report"}}}});
 expect(wrapper.text()).toContain("失败");expect(wrapper.text()).toContain("report.csv");expect(wrapper.text()).toContain("Reports");expect(wrapper.findAll("button,a")).toHaveLength(0);wrapper.unmount();
});
