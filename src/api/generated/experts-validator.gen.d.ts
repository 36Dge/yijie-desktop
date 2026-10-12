// Generated from FEAT-158 experts source and referenced authorities; DO NOT EDIT.
import type * as T from "../../domain/experts.generated.js";
export interface Validator<T>{(value:unknown):value is T;errors?:unknown;}
export declare const validateSnapshotRequest:Validator<T.SnapshotRequest>;
export declare const validateSnapshotResponse:Validator<T.SnapshotResponse>;
export declare const validatePrepareRequest:Validator<T.PrepareRequest>;
export declare const validatePrepareResponse:Validator<T.PrepareResponse>;
export declare const validateRemoveRequest:Validator<T.RemoveRequest>;
export declare const validateRemoveResponse:Validator<T.RemoveResponse>;
export declare const validateResourceOperationReadRequest:Validator<T.ResourceOperationReadRequest>;
export declare const validateResourceOperationReadResponse:Validator<T.ResourceOperationReadResponse>;
export declare const validateBindingReadRequest:Validator<T.BindingReadRequest>;
export declare const validateBindingReadResponse:Validator<T.BindingReadResponse>;
export declare const validateBindingSetRequest:Validator<T.BindingSetRequest>;
export declare const validateBindingSetResponse:Validator<T.BindingSetResponse>;
export declare const validateBindingOperationReadRequest:Validator<T.BindingOperationReadRequest>;
export declare const validateBindingOperationReadResponse:Validator<T.BindingOperationReadResponse>;
export declare const validateNativeSubmitRequest:Validator<T.NativeSubmitRequest>;
export declare const validateNativeSubmitResponse:Validator<T.NativeSubmitResponse>;
export declare const validateBindingRecoverRequest:Validator<T.BindingRecoverRequest>;
export declare const validateBindingRecoverResponse:Validator<T.BindingRecoverResponse>;
export declare const validateResourceOperationRecoverRequest:Validator<T.ResourceOperationRecoverRequest>;
export declare const validateResourceOperationRecoverResponse:Validator<T.ResourceOperationRecoverResponse>;
export declare const validateError:Validator<T.Error>;
