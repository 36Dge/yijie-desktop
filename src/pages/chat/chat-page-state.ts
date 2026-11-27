import { inject, onScopeDispose, provide, ref, shallowRef, watch, type InjectionKey } from "vue";
import { useRoute } from "vue-router";
import type { ProfileId } from "../../api/chat-model-client";
import { useChatAttachmentPresentation } from "../../composables/useChatAttachmentPresentation";
import { useChatShopPreview } from "../../composables/useChatShopPreview";
import { CHAT_COMPOSER_DEFAULT_PROFILE, createChatComposerDrafts } from "../../domain/chat-composer-draft";
import { useChatStore } from "../../stores/chat.store";

// The route owns these drafts and leases until the user leaves it, even if its
// editor is unmounted. Only the active published editor reads attachments.
function createChatPageState() {
  const chat = useChatStore();
  const route = useRoute();
  const context = () => chat.context?.contextId ?? null;
  const localComposerDrafts = shallowRef(createChatComposerDrafts());
  const localSelectedProjectId = ref<string | null>(null);
  const localProfile = ref<ProfileId>(CHAT_COMPOSER_DEFAULT_PROFILE);
  const shopPreview = useChatShopPreview(context, () =>
    typeof route.params.sessionId === "string" ? route.params.sessionId : "new");
  const readAttachmentPresentation = useChatAttachmentPresentation(
    context, () => chat.draftTarget, () => chat.draftAttachments.map(item => item.attachmentId),
    () => chat.canSend && chat.submissionState === "idle",
  );
  watch(context, (_, previous) => {
    localProfile.value = CHAT_COMPOSER_DEFAULT_PROFILE;
    if (previous !== null) {
      localComposerDrafts.value = createChatComposerDrafts();
      localSelectedProjectId.value = null;
    }
  }, { flush: "sync" });
  onScopeDispose(() => { void chat.deactivatePageSession(); });
  return { localComposerDrafts, localSelectedProjectId, localProfile, shopPreview, readAttachmentPresentation };
}

const chatPageStateKey: InjectionKey<ReturnType<typeof createChatPageState>> = Symbol("chat-page-state");

export function provideChatPageState() {
  provide(chatPageStateKey, createChatPageState());
}

export function useChatPageState() {
  return inject(chatPageStateKey, createChatPageState, true);
}
