// Generated from market-selection source; DO NOT EDIT.
import type * as T from "../../domain/market-selection.generated.js";
export interface Validator<T>{(value:unknown):value is T;errors?:unknown;}
export declare const validateCanonicalId:Validator<T.CanonicalId>;
export declare const validateSelectionRef:Validator<T.SelectionRef>;
export declare const validateProfileId:Validator<T.ProfileId>;
export declare const validateModelRevision:Validator<T.ModelRevision>;
export declare const validateSelectionDigest:Validator<T.SelectionDigest>;
export declare const validateSelection:Validator<T.Selection>;
export declare const validateModelIntent:Validator<T.ModelIntent>;
export declare const validateTextInput:Validator<T.TextInput>;
export declare const validateFileInput:Validator<T.FileInput>;
export declare const validateImageInput:Validator<T.ImageInput>;
export declare const validateContentBlock:Validator<T.ContentBlock>;
export declare const validateSubmitPayload:Validator<T.SubmitPayload>;
export declare const validateSelectionSnapshot:Validator<T.SelectionSnapshot>;
export declare const validateSubmissionReceipt:Validator<T.SubmissionReceipt>;
export declare const validateSubmitRequest:Validator<T.SubmitRequest>;
export declare const validateSubmitResponse:Validator<T.SubmitResponse>;
export declare const validateErrorCode:Validator<T.ErrorCode>;
export declare const validateError:Validator<T.Error>;
