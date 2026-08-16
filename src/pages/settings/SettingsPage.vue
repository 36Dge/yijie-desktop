<script setup lang="ts">
import { computed, ref } from "vue";
import { NCard, NText } from "naive-ui";
import { nativeAuthClient } from "../../api/native-auth-client";
import { localWhitelistLoginEnabled } from "../../authorization/local-whitelist-login-config";
import { authoritativePermissionUiEnabled } from "../../authorization/permission-ui-config";
import type { PermissionPhase } from "../../domain/permissions";
import { usePermissionStore } from "../../stores/permission.store";

const permissionStore = usePermissionStore();
const operationPending = ref(false);
const operationMessage = ref<string | null>(null);
const signedOut = ref(false);
const localUsername = ref("");
const localPassword = ref("");
const localUsernameError = ref<string | null>(null);
const localPasswordError = ref<string | null>(null);

const selectedTenant = computed(() =>
  permissionStore.tenants.find(
    (tenant) => tenant.tenantId === permissionStore.selectedTenantId,
  ),
);
const isLoading = computed(
  () => !signedOut.value && (permissionStore.phase === "idle" ||
    permissionStore.phase === "discovering" ||
    permissionStore.phase === "loading"),
);
const showTenantSelector = computed(
  () => permissionStore.tenants.length > 1 && permissionStore.phase !== "discovering",
);
const statusCopy = computed(() =>
  statusForPhase(signedOut.value ? "unauthorized" : permissionStore.phase),
);
const showLocalWhitelistForm = computed(() =>
  localWhitelistLoginEnabled && (
    !authoritativePermissionUiEnabled ||
    signedOut.value ||
    !["ready", "ready-empty", "discovering", "loading"].includes(permissionStore.phase)
  ),
);

function statusForPhase(phase: PermissionPhase): { title: string; detail: string } {
  switch (phase) {
    case "idle":
    case "discovering":
      return { title: "正在确认账户", detail: "正在读取可用租户，请稍候。" };
    case "tenant-selection-required":
      return { title: "选择工作空间", detail: "选择本次操作使用的租户后再继续。" };
    case "loading":
      return { title: "正在校验权限", detail: "切换期间所有业务入口保持关闭。" };
    case "ready":
      return { title: "权限已就绪", detail: "导航已按当前租户的有效权限更新。" };
    case "ready-empty":
      return { title: "暂无业务权限", detail: "当前租户没有已授权的业务模块，设置仍可使用。" };
    case "recovery":
      return { title: "暂无可用租户", detail: "此账户尚未加入有效租户，请重试或重新登录。" };
    case "unauthorized":
      return { title: "需要重新登录", detail: "登录状态已失效，业务入口已关闭。" };
    case "user-access-denied":
      return { title: "账户访问受限", detail: "当前账户不能访问租户信息，请联系管理员。" };
    case "tenant-access-denied":
      return { title: "租户访问已撤销", detail: "请选择其他租户或重新读取租户列表。" };
    case "invalid-tenant-context":
      return { title: "租户上下文无效", detail: "本地选择已清除，请重新选择租户。" };
    case "unavailable":
      return { title: "权限服务暂不可用", detail: "业务入口保持关闭；可稍后重试。" };
    case "invalid-projection":
      return { title: "权限响应未通过校验", detail: "为保护账户，业务入口保持关闭。" };
  }
}

async function retry(): Promise<void> {
  if (operationPending.value) {
    return;
  }
  operationPending.value = true;
  operationMessage.value = null;
  try {
    await permissionStore.refresh();
  } finally {
    operationPending.value = false;
  }
}

async function login(): Promise<void> {
  if (operationPending.value) {
    return;
  }
  operationPending.value = true;
  operationMessage.value = null;
  try {
    await nativeAuthClient.login();
    signedOut.value = false;
    permissionStore.clearForLogout();
    if (authoritativePermissionUiEnabled) {
      await permissionStore.ensureInitialized();
    } else {
      operationMessage.value = "登录已完成；权威权限界面仍保持安全关闭。";
    }
  } catch {
    operationMessage.value = "登录未完成，请检查本地身份环境后重试。";
  } finally {
    operationPending.value = false;
  }
}

async function localWhitelistLogin(): Promise<void> {
  if (operationPending.value) {
    return;
  }
  localUsernameError.value = localUsername.value.length === 0 ? "请输入本地白名单账号。" : null;
  localPasswordError.value = localPassword.value.length === 0 ? "请输入本地白名单密码。" : null;
  if (localUsernameError.value || localPasswordError.value) {
    return;
  }

  let username = localUsername.value;
  let password = localPassword.value;
  // Remove the credentials from the reactive DOM state before any network or
  // permission projection work begins.
  localUsername.value = "";
  localPassword.value = "";
  operationPending.value = true;
  operationMessage.value = null;
  const loginRequest = nativeAuthClient.localWhitelistLogin({ username, password });
  // Intentionally release these credential references before awaiting native work.
  // eslint-disable-next-line no-useless-assignment
  username = "";
  // eslint-disable-next-line no-useless-assignment
  password = "";
  try {
    await loginRequest;
    signedOut.value = false;
    permissionStore.clearForLogout();
    if (authoritativePermissionUiEnabled) {
      await permissionStore.ensureInitialized();
    } else {
      operationMessage.value = "登录已完成；权威权限界面仍保持安全关闭。";
    }
  } catch {
    operationMessage.value = "本地登录未完成，请检查账号、密码和本地服务配置。";
  } finally {
    operationPending.value = false;
  }
}

async function logout(): Promise<void> {
  if (operationPending.value) {
    return;
  }
  operationPending.value = true;
  operationMessage.value = null;
  try {
    await nativeAuthClient.logout();
  } catch {
    operationMessage.value = "退出请求未完成；本地权限状态已安全清除。";
  } finally {
    permissionStore.clearForLogout();
    signedOut.value = true;
    operationPending.value = false;
  }
}

async function selectTenant(tenantId: string): Promise<void> {
  if (operationPending.value || tenantId === permissionStore.selectedTenantId) {
    return;
  }
  operationPending.value = true;
  operationMessage.value = null;
  try {
    await permissionStore.selectTenant(tenantId);
  } finally {
    operationPending.value = false;
  }
}
</script>

<template>
  <section class="page" aria-labelledby="settings-page-title">
    <div class="page__content">
      <h1 id="settings-page-title" class="page__title">设置</h1>

      <n-card class="page__card" title="账户与权限" :bordered="false">
        <div v-if="!authoritativePermissionUiEnabled" class="access-state" role="status">
          <h2>权威权限界面未启用</h2>
          <n-text>
            当前构建保持安全关闭，只提供设置恢复入口，不显示或加载受保护业务模块。
          </n-text>
          <p v-if="operationMessage" class="access-state__error" role="alert">
            {{ operationMessage }}
          </p>
          <div class="access-state__actions">
            <button
              class="button button--primary"
              type="button"
              :disabled="operationPending"
              @click="login"
            >
              登录或更换账户
            </button>
            <button
              class="button"
              type="button"
              :disabled="operationPending"
              @click="logout"
            >
              退出登录
            </button>
          </div>
        </div>

        <div v-else class="access-state" :aria-busy="isLoading" role="status">
          <h2>{{ statusCopy.title }}</h2>
          <n-text>{{ statusCopy.detail }}</n-text>

          <dl v-if="selectedTenant" class="access-state__facts">
            <div>
              <dt>当前租户</dt>
              <dd>{{ selectedTenant.displayName }}</dd>
            </div>
            <div v-if="permissionStore.authorizationRevision !== null">
              <dt>授权版本</dt>
              <dd>{{ permissionStore.authorizationRevision }}</dd>
            </div>
            <div v-if="permissionStore.expiresAt !== null">
              <dt>有效期至</dt>
              <dd>{{ permissionStore.expiresAt }}</dd>
            </div>
          </dl>

          <fieldset v-if="showTenantSelector" class="tenant-selector">
            <legend>可用租户</legend>
            <button
              v-for="tenant in permissionStore.tenants"
              :key="tenant.tenantId"
              class="tenant-selector__option"
              :class="{ 'tenant-selector__option--selected': tenant.tenantId === permissionStore.selectedTenantId }"
              type="button"
              :disabled="operationPending"
              :aria-pressed="tenant.tenantId === permissionStore.selectedTenantId"
              @click="selectTenant(tenant.tenantId)"
            >
              {{ tenant.displayName }}
            </button>
          </fieldset>

          <p v-if="operationMessage" class="access-state__error" role="alert">
            {{ operationMessage }}
          </p>

          <div class="access-state__actions">
            <button
              class="button button--primary"
              type="button"
              :disabled="operationPending"
              @click="retry"
            >
              重新读取权限
            </button>
            <button
              v-if="signedOut || permissionStore.phase === 'unauthorized' || permissionStore.phase === 'recovery'"
              class="button"
              type="button"
              :disabled="operationPending"
              @click="login"
            >
              登录或更换账户
            </button>
            <button
              class="button"
              type="button"
              :disabled="operationPending"
              @click="logout"
            >
              退出登录
            </button>
          </div>
        </div>

        <form
          v-if="showLocalWhitelistForm"
          class="local-login-form"
          aria-labelledby="local-login-title"
          novalidate
          @submit.prevent="localWhitelistLogin"
        >
          <h2 id="local-login-title">本地白名单登录</h2>
          <div class="local-login-form__field">
            <label for="local-login-username">账号</label>
            <input
              id="local-login-username"
              v-model="localUsername"
              class="local-login-form__input"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              :disabled="operationPending"
              :aria-invalid="localUsernameError !== null"
              :aria-describedby="localUsernameError ? 'local-login-username-error' : undefined"
              maxlength="64"
              @input="localUsernameError = null"
            >
            <p
              v-if="localUsernameError"
              id="local-login-username-error"
              class="local-login-form__error"
              role="alert"
            >
              {{ localUsernameError }}
            </p>
          </div>
          <div class="local-login-form__field">
            <label for="local-login-password">密码</label>
            <input
              id="local-login-password"
              v-model="localPassword"
              class="local-login-form__input"
              type="password"
              autocomplete="new-password"
              :disabled="operationPending"
              :aria-invalid="localPasswordError !== null"
              :aria-describedby="localPasswordError ? 'local-login-password-error' : undefined"
              maxlength="256"
              @input="localPasswordError = null"
            >
            <p
              v-if="localPasswordError"
              id="local-login-password-error"
              class="local-login-form__error"
              role="alert"
            >
              {{ localPasswordError }}
            </p>
          </div>
          <div class="access-state__actions">
            <button
              class="button button--primary"
              type="submit"
              :disabled="operationPending"
            >
              登录
            </button>
          </div>
        </form>
      </n-card>

      <n-card class="page__card" title="Sidecar" :bordered="false">
        <n-text>桌面端会在后续版本管理 Codex Runtime 与 yijie-agent-host sidecar。</n-text>
      </n-card>
    </div>
  </section>
</template>

<style scoped>
.page {
  min-height: 100%;
  padding: var(--yj-space-8);
  background: var(--yj-color-bg-page);
}

.page__content {
  display: grid;
  width: min(100%, var(--yj-layout-form-max));
  margin-inline: auto;
  gap: var(--yj-space-5);
}

.page__title {
  margin: 0 0 var(--yj-space-1);
  color: var(--yj-color-text-primary);
  font-size: var(--yj-font-size-page-title);
  font-weight: var(--yj-font-weight-semibold);
  line-height: var(--yj-line-height-page-title);
}

.page__card {
  background: var(--yj-color-bg-card);
  box-shadow: var(--yj-shadow-xs);
}

.access-state {
  display: grid;
  gap: var(--yj-space-4);
}

.access-state h2 {
  margin: 0;
  color: var(--yj-color-text-primary);
  font-size: var(--yj-font-size-section-title);
}

.access-state__facts {
  display: grid;
  margin: 0;
  gap: var(--yj-space-2);
}

.access-state__facts div {
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr);
  gap: var(--yj-space-3);
}

.access-state__facts dt {
  color: var(--yj-color-text-tertiary);
}

.access-state__facts dd {
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--yj-color-text-primary);
}

.tenant-selector {
  display: grid;
  padding: 0;
  border: 0;
  gap: var(--yj-space-2);
}

.tenant-selector legend {
  margin-bottom: var(--yj-space-2);
  color: var(--yj-color-text-secondary);
  font-weight: var(--yj-font-weight-semibold);
}

.tenant-selector__option,
.button {
  min-height: var(--yj-space-10);
  padding: var(--yj-space-2) var(--yj-space-4);
  border: 1px solid var(--yj-color-border-default);
  border-radius: var(--yj-radius-md);
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-card);
  cursor: pointer;
}

.tenant-selector__option {
  text-align: left;
}

.tenant-selector__option--selected {
  border-color: var(--yj-color-brand-border);
  color: var(--yj-color-brand-text);
  background: var(--yj-color-brand-soft);
}

.button--primary {
  border-color: var(--yj-color-brand-primary);
  color: var(--yj-color-text-primary);
  background: var(--yj-color-brand-primary);
}

.tenant-selector__option:focus-visible,
.button:focus-visible {
  outline: var(--yj-space-1) solid var(--yj-color-brand-border);
  outline-offset: var(--yj-space-1);
}

.tenant-selector__option:disabled,
.button:disabled {
  color: var(--yj-color-text-disabled);
  cursor: not-allowed;
  opacity: 0.72;
}

.access-state__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--yj-space-2);
}

.access-state__error {
  margin: 0;
  color: var(--yj-color-error);
}

.local-login-form {
  display: grid;
  max-width: 480px;
  margin-top: var(--yj-space-5);
  padding-top: var(--yj-space-5);
  border-top: 1px solid var(--yj-color-border-default);
  gap: var(--yj-space-4);
}

.local-login-form h2 {
  margin: 0;
  color: var(--yj-color-text-primary);
  font-size: var(--yj-font-size-section-title);
}

.local-login-form__field {
  display: grid;
  gap: var(--yj-space-2);
}

.local-login-form__field label {
  color: var(--yj-color-text-secondary);
  font-weight: var(--yj-font-weight-semibold);
}

.local-login-form__input {
  width: 100%;
  min-height: var(--yj-space-10);
  padding: var(--yj-space-2) var(--yj-space-3);
  border: 1px solid var(--yj-color-border-default);
  border-radius: var(--yj-radius-md);
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-card);
  box-sizing: border-box;
}

.local-login-form__input:focus-visible {
  border-color: var(--yj-color-brand-border);
  outline: var(--yj-space-1) solid var(--yj-color-brand-border);
  outline-offset: var(--yj-space-1);
}

.local-login-form__input:disabled {
  color: var(--yj-color-text-disabled);
  cursor: not-allowed;
  opacity: 0.72;
}

.local-login-form__error {
  margin: 0;
  color: var(--yj-color-error);
}
</style>
