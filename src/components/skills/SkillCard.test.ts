// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import axe from "axe-core";
import { NSwitch, NTooltip } from "naive-ui";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseSkillCatalogSnapshot,
  type ManagedSkillProjection,
} from "../../domain/skill-marketplace";
import YjIcon from "../yijie/YjIcon.vue";
import SkillCard from "./SkillCard.vue";

const SKILL_ID = "yijie.content-marketing.copywriting";

function skill(overrides: Record<string, unknown> = {}): ManagedSkillProjection {
  return parseSkillCatalogSnapshot({
    schemaVersion: 1,
    scannedAt: "2026-08-25T08:00:00Z",
    skills: [{
      id: SKILL_ID,
      runtimeName: "copywriting",
      category: "content-marketing",
      order: 0,
      displayName: "跨境营销文案",
      description: "根据已确认的商品事实和受众生成跨境营销文案。",
      version: "0.1.0",
      iconKey: "edit",
      riskLevel: "medium",
      riskReasons: ["营销文案可能包含未经证实的声明。"],
      sourceType: "internal",
      licenseExpression: "LicenseRef-YiJie-Local-Development-Only",
      executionMode: "model-only",
      networkAccess: "none",
      filesystemAccess: "none",
      requiredTools: [],
      catalogStatus: "installable",
      maintenanceStatus: "maintained",
      capabilityReadiness: "ready",
      installationStatus: "not_installed",
      enabled: false,
      runtimeVisible: false,
      failureCode: "",
      ...overrides,
    }],
  }).skills[0]!;
}

function mountCard(
  projection = skill(),
  canManage = true,
  operation: "install" | "enable" | "disable" | "uninstall" | null = null,
) {
  return mount(SkillCard, {
    attachTo: document.body,
    props: { skill: projection, canManage, operation },
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("SkillCard", () => {
  it("offers one labelled install control with a hover and keyboard-focus tooltip", async () => {
    const wrapper = mountCard();
    const install = wrapper.get(`button[aria-label="安装 跨境营销文案"]`);

    const tooltip = wrapper.getComponent(NTooltip);
    expect(tooltip.props("trigger")).toBe("manual");
    expect(tooltip.props("show")).toBe(false);
    expect(tooltip.vm.$slots.default?.().some((node) =>
      typeof node.children === "string" && node.children.includes("安装")
    )).toBe(true);

    await install.trigger("mouseenter");
    expect(tooltip.props("show")).toBe(true);
    await install.trigger("mouseleave");
    expect(tooltip.props("show")).toBe(false);

    await install.trigger("focus");
    expect(tooltip.props("show")).toBe(true);
    await install.trigger("blur");
    expect(tooltip.props("show")).toBe(false);

    await install.trigger("click");

    expect(wrapper.emitted("install")).toEqual([[SKILL_ID]]);
    expect(wrapper.text()).toContain("v0.1.0");
    expect(wrapper.text()).not.toContain("低风险");
    expect(wrapper.text()).toContain("中风险");
    expect(wrapper.text()).toContain("模型内执行，不访问网络或本地文件");
  });

  it("replaces install with delete and enable controls for an installed Skill", async () => {
    const wrapper = mountCard(skill({
      installationStatus: "installed",
      enabled: true,
      runtimeVisible: true,
    }));
    const deleteButton = wrapper.get(`button[aria-label="卸载 跨境营销文案"]`);
    const switchControl = wrapper.getComponent(NSwitch);

    expect(wrapper.find(`button[aria-label="安装 跨境营销文案"]`).exists()).toBe(false);
    expect(deleteButton.classes()).toContain("skill-card__delete");
    expect(switchControl.attributes("aria-label")).toBe("停用 跨境营销文案");

    await switchControl.vm.$emit("update:value", false);
    await deleteButton.trigger("click");

    expect(wrapper.emitted("enabled-change")).toEqual([[SKILL_ID, false]]);
    expect(wrapper.emitted("uninstall")?.[0]?.[0]).toBe(SKILL_ID);
    expect(wrapper.emitted("uninstall")?.[0]?.[1]).toBe(deleteButton.element);
  });

  it("renders a read-only catalog without mutation controls", () => {
    const uninstalled = mountCard(skill(), false);
    expect(uninstalled.find(".skill-card__actions button").exists()).toBe(false);

    uninstalled.unmount();
    const installed = mountCard(skill({
      installationStatus: "installed",
      enabled: true,
      runtimeVisible: true,
    }), false);
    expect(installed.find(".skill-card__delete").exists()).toBe(false);
    expect(installed.getComponent(NSwitch).props("disabled")).toBe(true);
  });

  it("falls back to the semantic plugin icon for an unknown iconKey", () => {
    const wrapper = mountCard(skill({ iconKey: "futureIcon" }));

    expect(wrapper.findAllComponents(YjIcon)[0]?.props("name")).toBe("plugin");
  });

  it("keeps an installable degraded Skill actionable before and after Runtime confirmation", async () => {
    const projection = skill({
      executionMode: "tool-assisted",
      networkAccess: "required",
      requiredTools: ["browser.search"],
      capabilityReadiness: "degraded",
    });
    const wrapper = mountCard(projection);
    expect(wrapper.get(`button[aria-label="安装 跨境营销文案"]`)).toBeDefined();
    expect(wrapper.text()).toContain("可安装 · 需工具");

    await wrapper.setProps({
      skill: skill({
        executionMode: "tool-assisted",
        networkAccess: "required",
        requiredTools: ["browser.search"],
        capabilityReadiness: "degraded",
        installationStatus: "installed",
        enabled: true,
        runtimeVisible: true,
      }),
    });
    expect(wrapper.text()).toContain("模型可用");
    expect(wrapper.getComponent(NSwitch).props("value")).toBe(true);
  });

  it("shows the stable blocked reason and exposes no install control", () => {
    const wrapper = mountCard(skill({
      catalogStatus: "blocked",
      catalogBlockedReason: "license_unverified",
      capabilityReadiness: "blocked",
    }));

    expect(wrapper.text()).toContain("许可尚未通过审核");
    expect(wrapper.text()).toContain("暂不可安装");
    expect(wrapper.find(".skill-card__install").exists()).toBe(false);
  });

  it("turns an install failure into an explicit retry action", () => {
    const wrapper = mount(SkillCard, {
      attachTo: document.body,
      props: {
        skill: skill(),
        canManage: true,
        operationError: "Skill 安装失败，未保留不完整文件。",
      },
    });

    expect(wrapper.get(`button[aria-label="重试安装 跨境营销文案"]`)).toBeDefined();
    expect(String(wrapper.getComponent(NTooltip).vm.$slots.default?.()[0]?.children).trim())
      .toBe("重试安装");
  });

  it.each([
    "edit",
    "skillContent",
    "skillOperations",
    "skillResearch",
    "skillSourcing",
    "skillTraffic",
  ])("renders the reviewed iconKey %s without fallback", (iconKey) => {
    const wrapper = mountCard(skill({ iconKey }));
    expect(wrapper.findAllComponents(YjIcon)[0]?.props("name")).toBe(iconKey);
  });

  it("has no serious or critical accessibility violations", async () => {
    const wrapper = mountCard(skill({
      installationStatus: "installed",
      enabled: true,
      runtimeVisible: true,
    }));
    const results = await axe.run(wrapper.element, {
      rules: { region: { enabled: false } },
    });

    expect(results.violations.filter((violation) =>
      violation.impact === "serious" || violation.impact === "critical"
    )).toEqual([]);
  });
});
