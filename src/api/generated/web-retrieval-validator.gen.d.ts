// Generated from web-retrieval; DO NOT EDIT.
import type * as T from "../../domain/web-retrieval.generated.js";
export interface Validator<T>{(value:unknown):value is T;errors?:unknown;}
export declare const validateSearchOutput:Validator<T.SearchOutput>;
export declare const validateProOutput:Validator<T.ProOutput>;
export declare const validateFetchOutput:Validator<T.FetchOutput>;
