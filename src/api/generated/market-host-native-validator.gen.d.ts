// Generated from market-host source and referenced authorities; DO NOT EDIT.
import type * as T from "../../domain/market-host-native.generated.js";
export interface Validator<T>{(value:unknown):value is T;errors?:unknown;}
export declare const validateNativeObserveRequest:Validator<T.NativeObserveRequest>;
export declare const validateNativeObserveResponse:Validator<T.NativeObserveResponse>;
export declare const validateNativeApprovalDecideRequest:Validator<T.NativeApprovalDecideRequest>;
export declare const validateNativeApprovalDecideResponse:Validator<T.NativeApprovalDecideResponse>;
export declare const validateNativeError:Validator<T.NativeError>;
