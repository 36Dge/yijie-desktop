import type { InjectionKey } from "vue";

export type ChatAuthorityRetry = () => Promise<boolean>;
export const CHAT_EXECUTION_PREPARE_KEY: InjectionKey<ChatAuthorityRetry> = Symbol("chat-execution-prepare");

export const CHAT_AUTHORITY_RETRY_KEY: InjectionKey<ChatAuthorityRetry> = Symbol(
  "chat-authority-retry",
);
