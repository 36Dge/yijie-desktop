import type {NativeConversationViewEvent} from "./native-conversation-private.gen";
import type {NativeConversationHistory} from "./native-conversation-history.gen";
export declare function validateNativeViewEvent(value: unknown): value is NativeConversationViewEvent;
export declare function validateNativeHistory(value: unknown): value is NativeConversationHistory;
