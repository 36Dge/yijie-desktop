/* Canonical workflow source AOT validators. DO NOT EDIT. */
"use strict";
export const v_Identifier = validate20;
const schema31 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/Identifier","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/Identifier"};
const schema33 = {"type":"string","maxLength":64,"minLength":1,"pattern":"^[A-Za-z0-9_-]+$"};
const func1 = (function ucs2length(str) {
    const len = str.length;
    let length = 0;
    let pos = 0;
    let value;
    while (pos < len) {
        length++;
        value = str.charCodeAt(pos++);
        if (value >= 0xd800 && value <= 0xdbff && pos < len) {
            // high surrogate, and there is a next character
            value = str.charCodeAt(pos);
            if ((value & 0xfc00) === 0xdc00)
                pos++; // low surrogate
        }
    }
    return length;
});
const pattern4 = new RegExp("^[A-Za-z0-9_-]+$", "u");

function validate20(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/Identifier" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate20.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(typeof data === "string"){
if(func1(data) > 64){
const err0 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(func1(data) < 1){
const err1 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(!pattern4.test(data)){
const err2 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
else {
const err3 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
validate20.errors = vErrors;
return errors === 0;
}
validate20.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const v_OperationId = validate22;
const schema34 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/OperationId","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/OperationId"};
const schema35 = {"type":"string","maxLength":36,"minLength":36,"pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"};
const pattern5 = new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", "u");

function validate22(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/OperationId" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate22.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(typeof data === "string"){
if(func1(data) > 36){
const err0 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/OperationId/maxLength",keyword:"maxLength",params:{limit: 36},message:"must NOT have more than 36 characters"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(func1(data) < 36){
const err1 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/OperationId/minLength",keyword:"minLength",params:{limit: 36},message:"must NOT have fewer than 36 characters"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(!pattern5.test(data)){
const err2 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/OperationId/pattern",keyword:"pattern",params:{pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},message:"must match pattern \""+"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"+"\""};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
else {
const err3 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/OperationId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
validate22.errors = vErrors;
return errors === 0;
}
validate22.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const v_Version = validate23;
const schema36 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/Version","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/Version"};
const schema37 = {"type":"string","maxLength":32,"pattern":"^v0[.]0[.][1-9][0-9]*$"};
const pattern6 = new RegExp("^v0[.]0[.][1-9][0-9]*$", "u");

function validate23(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/Version" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate23.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(typeof data === "string"){
if(func1(data) > 32){
const err0 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/Version/maxLength",keyword:"maxLength",params:{limit: 32},message:"must NOT have more than 32 characters"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(!pattern6.test(data)){
const err1 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/Version/pattern",keyword:"pattern",params:{pattern: "^v0[.]0[.][1-9][0-9]*$"},message:"must match pattern \""+"^v0[.]0[.][1-9][0-9]*$"+"\""};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
else {
const err2 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/Version/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
validate23.errors = vErrors;
return errors === 0;
}
validate23.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const v_RunEpoch = validate24;
const schema38 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/RunEpoch","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/RunEpoch"};

function validate24(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/RunEpoch" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate24.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(typeof data === "string"){
if(func1(data) > 36){
const err0 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/RunEpoch/maxLength",keyword:"maxLength",params:{limit: 36},message:"must NOT have more than 36 characters"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(func1(data) < 36){
const err1 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/RunEpoch/minLength",keyword:"minLength",params:{limit: 36},message:"must NOT have fewer than 36 characters"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(!pattern5.test(data)){
const err2 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/RunEpoch/pattern",keyword:"pattern",params:{pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},message:"must match pattern \""+"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"+"\""};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
else {
const err3 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/RunEpoch/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
validate24.errors = vErrors;
return errors === 0;
}
validate24.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const v_ErrorCode = validate25;
const schema40 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/ErrorCode","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/ErrorCode"};
const schema41 = {"type":"string","enum":["profile_disabled","service_unavailable","unauthorized","session_expired","resource_not_found","revision_conflict","operation_conflict","invalid_draft","input_too_large","run_busy","operation_unknown","protocol_mismatch","invalid_request","storage_unavailable","internal_error"]};

function validate25(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/ErrorCode" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate25.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(typeof data !== "string"){
const err0 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/ErrorCode/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(!(((((((((((((((data === "profile_disabled") || (data === "service_unavailable")) || (data === "unauthorized")) || (data === "session_expired")) || (data === "resource_not_found")) || (data === "revision_conflict")) || (data === "operation_conflict")) || (data === "invalid_draft")) || (data === "input_too_large")) || (data === "run_busy")) || (data === "operation_unknown")) || (data === "protocol_mismatch")) || (data === "invalid_request")) || (data === "storage_unavailable")) || (data === "internal_error"))){
const err1 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/ErrorCode/enum",keyword:"enum",params:{allowedValues: schema41.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate25.errors = vErrors;
return errors === 0;
}
validate25.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const v_ErrorResponse = validate26;
const schema42 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/ErrorResponse","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/ErrorResponse"};
const schema43 = {"type":"object","additionalProperties":false,"properties":{"code":{"$ref":"#/$defs/ErrorCode"},"message":{"type":"string","maxLength":160},"operation_id":{"$ref":"#/$defs/OperationId"}},"required":["code","message"]};

function validate27(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate27.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.code === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "code"},message:"must have required property '"+"code"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.message === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "message"},message:"must have required property '"+"message"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "code") || (key0 === "message")) || (key0 === "operation_id"))){
const err2 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.code !== undefined){
let data0 = data.code;
if(typeof data0 !== "string"){
const err3 = {instancePath:instancePath+"/code",schemaPath:"#/$defs/ErrorCode/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!(((((((((((((((data0 === "profile_disabled") || (data0 === "service_unavailable")) || (data0 === "unauthorized")) || (data0 === "session_expired")) || (data0 === "resource_not_found")) || (data0 === "revision_conflict")) || (data0 === "operation_conflict")) || (data0 === "invalid_draft")) || (data0 === "input_too_large")) || (data0 === "run_busy")) || (data0 === "operation_unknown")) || (data0 === "protocol_mismatch")) || (data0 === "invalid_request")) || (data0 === "storage_unavailable")) || (data0 === "internal_error"))){
const err4 = {instancePath:instancePath+"/code",schemaPath:"#/$defs/ErrorCode/enum",keyword:"enum",params:{allowedValues: schema41.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.message !== undefined){
let data1 = data.message;
if(typeof data1 === "string"){
if(func1(data1) > 160){
const err5 = {instancePath:instancePath+"/message",schemaPath:"#/properties/message/maxLength",keyword:"maxLength",params:{limit: 160},message:"must NOT have more than 160 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
else {
const err6 = {instancePath:instancePath+"/message",schemaPath:"#/properties/message/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.operation_id !== undefined){
let data2 = data.operation_id;
if(typeof data2 === "string"){
if(func1(data2) > 36){
const err7 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/maxLength",keyword:"maxLength",params:{limit: 36},message:"must NOT have more than 36 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(func1(data2) < 36){
const err8 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/minLength",keyword:"minLength",params:{limit: 36},message:"must NOT have fewer than 36 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(!pattern5.test(data2)){
const err9 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/pattern",keyword:"pattern",params:{pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},message:"must match pattern \""+"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"+"\""};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
else {
const err10 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
}
else {
const err11 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
validate27.errors = vErrors;
return errors === 0;
}
validate27.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate26(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/ErrorResponse" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate26.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(!(validate27(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate27.errors : vErrors.concat(validate27.errors);
errors = vErrors.length;
}
validate26.errors = vErrors;
return errors === 0;
}
validate26.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const v_Limits = validate29;
const schema46 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/Limits","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/Limits"};
const schema47 = {"type":"object","additionalProperties":false,"properties":{"input_bytes":{"type":"integer","enum":[4096]},"prefix_bytes":{"type":"integer","enum":[1024]},"output_bytes":{"type":"integer","enum":[5120]},"canvas_bytes":{"type":"integer","enum":[262144]},"message_bytes":{"type":"integer","enum":[524288]},"max_active_runs":{"type":"integer","enum":[1]},"execution_budget_seconds":{"type":"integer","enum":[30]},"editor_ttl_seconds":{"type":"integer","enum":[300]}},"required":["input_bytes","prefix_bytes","output_bytes","canvas_bytes","message_bytes","max_active_runs","execution_budget_seconds","editor_ttl_seconds"]};

function validate29(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/Limits" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate29.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.input_bytes === undefined){
const err0 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/Limits/required",keyword:"required",params:{missingProperty: "input_bytes"},message:"must have required property '"+"input_bytes"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.prefix_bytes === undefined){
const err1 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/Limits/required",keyword:"required",params:{missingProperty: "prefix_bytes"},message:"must have required property '"+"prefix_bytes"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.output_bytes === undefined){
const err2 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/Limits/required",keyword:"required",params:{missingProperty: "output_bytes"},message:"must have required property '"+"output_bytes"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.canvas_bytes === undefined){
const err3 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/Limits/required",keyword:"required",params:{missingProperty: "canvas_bytes"},message:"must have required property '"+"canvas_bytes"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.message_bytes === undefined){
const err4 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/Limits/required",keyword:"required",params:{missingProperty: "message_bytes"},message:"must have required property '"+"message_bytes"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.max_active_runs === undefined){
const err5 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/Limits/required",keyword:"required",params:{missingProperty: "max_active_runs"},message:"must have required property '"+"max_active_runs"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.execution_budget_seconds === undefined){
const err6 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/Limits/required",keyword:"required",params:{missingProperty: "execution_budget_seconds"},message:"must have required property '"+"execution_budget_seconds"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data.editor_ttl_seconds === undefined){
const err7 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/Limits/required",keyword:"required",params:{missingProperty: "editor_ttl_seconds"},message:"must have required property '"+"editor_ttl_seconds"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
for(const key0 in data){
if(!((((((((key0 === "input_bytes") || (key0 === "prefix_bytes")) || (key0 === "output_bytes")) || (key0 === "canvas_bytes")) || (key0 === "message_bytes")) || (key0 === "max_active_runs")) || (key0 === "execution_budget_seconds")) || (key0 === "editor_ttl_seconds"))){
const err8 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/Limits/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.input_bytes !== undefined){
let data0 = data.input_bytes;
if(!(((typeof data0 == "number") && (!(data0 % 1) && !isNaN(data0))) && (isFinite(data0)))){
const err9 = {instancePath:instancePath+"/input_bytes",schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/Limits/properties/input_bytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(!(data0 === 4096)){
const err10 = {instancePath:instancePath+"/input_bytes",schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/Limits/properties/input_bytes/enum",keyword:"enum",params:{allowedValues: schema47.properties.input_bytes.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.prefix_bytes !== undefined){
let data1 = data.prefix_bytes;
if(!(((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1))) && (isFinite(data1)))){
const err11 = {instancePath:instancePath+"/prefix_bytes",schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/Limits/properties/prefix_bytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(!(data1 === 1024)){
const err12 = {instancePath:instancePath+"/prefix_bytes",schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/Limits/properties/prefix_bytes/enum",keyword:"enum",params:{allowedValues: schema47.properties.prefix_bytes.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.output_bytes !== undefined){
let data2 = data.output_bytes;
if(!(((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2))) && (isFinite(data2)))){
const err13 = {instancePath:instancePath+"/output_bytes",schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/Limits/properties/output_bytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(!(data2 === 5120)){
const err14 = {instancePath:instancePath+"/output_bytes",schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/Limits/properties/output_bytes/enum",keyword:"enum",params:{allowedValues: schema47.properties.output_bytes.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data.canvas_bytes !== undefined){
let data3 = data.canvas_bytes;
if(!(((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3))) && (isFinite(data3)))){
const err15 = {instancePath:instancePath+"/canvas_bytes",schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/Limits/properties/canvas_bytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(!(data3 === 262144)){
const err16 = {instancePath:instancePath+"/canvas_bytes",schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/Limits/properties/canvas_bytes/enum",keyword:"enum",params:{allowedValues: schema47.properties.canvas_bytes.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data.message_bytes !== undefined){
let data4 = data.message_bytes;
if(!(((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4))) && (isFinite(data4)))){
const err17 = {instancePath:instancePath+"/message_bytes",schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/Limits/properties/message_bytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(!(data4 === 524288)){
const err18 = {instancePath:instancePath+"/message_bytes",schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/Limits/properties/message_bytes/enum",keyword:"enum",params:{allowedValues: schema47.properties.message_bytes.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(data.max_active_runs !== undefined){
let data5 = data.max_active_runs;
if(!(((typeof data5 == "number") && (!(data5 % 1) && !isNaN(data5))) && (isFinite(data5)))){
const err19 = {instancePath:instancePath+"/max_active_runs",schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/Limits/properties/max_active_runs/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
if(!(data5 === 1)){
const err20 = {instancePath:instancePath+"/max_active_runs",schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/Limits/properties/max_active_runs/enum",keyword:"enum",params:{allowedValues: schema47.properties.max_active_runs.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
if(data.execution_budget_seconds !== undefined){
let data6 = data.execution_budget_seconds;
if(!(((typeof data6 == "number") && (!(data6 % 1) && !isNaN(data6))) && (isFinite(data6)))){
const err21 = {instancePath:instancePath+"/execution_budget_seconds",schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/Limits/properties/execution_budget_seconds/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
if(!(data6 === 30)){
const err22 = {instancePath:instancePath+"/execution_budget_seconds",schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/Limits/properties/execution_budget_seconds/enum",keyword:"enum",params:{allowedValues: schema47.properties.execution_budget_seconds.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data.editor_ttl_seconds !== undefined){
let data7 = data.editor_ttl_seconds;
if(!(((typeof data7 == "number") && (!(data7 % 1) && !isNaN(data7))) && (isFinite(data7)))){
const err23 = {instancePath:instancePath+"/editor_ttl_seconds",schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/Limits/properties/editor_ttl_seconds/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if(!(data7 === 300)){
const err24 = {instancePath:instancePath+"/editor_ttl_seconds",schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/Limits/properties/editor_ttl_seconds/enum",keyword:"enum",params:{allowedValues: schema47.properties.editor_ttl_seconds.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
}
else {
const err25 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/Limits/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
validate29.errors = vErrors;
return errors === 0;
}
validate29.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const v_ServiceStatus = validate30;
const schema48 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/ServiceStatus","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/ServiceStatus"};
const schema49 = {"type":"object","additionalProperties":false,"properties":{"protocol_version":{"type":"integer","enum":[1]},"run_epoch":{"$ref":"#/$defs/RunEpoch"},"ready":{"type":"boolean"},"state":{"type":"string","enum":["ready","unavailable","disabled"]},"limits":{"$ref":"#/$defs/Limits"}},"required":["protocol_version","run_epoch","ready","state","limits"]};

function validate31(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate31.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.protocol_version === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "protocol_version"},message:"must have required property '"+"protocol_version"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.run_epoch === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "run_epoch"},message:"must have required property '"+"run_epoch"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.ready === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "ready"},message:"must have required property '"+"ready"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.state === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "state"},message:"must have required property '"+"state"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.limits === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "limits"},message:"must have required property '"+"limits"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
for(const key0 in data){
if(!(((((key0 === "protocol_version") || (key0 === "run_epoch")) || (key0 === "ready")) || (key0 === "state")) || (key0 === "limits"))){
const err5 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.protocol_version !== undefined){
let data0 = data.protocol_version;
if(!(((typeof data0 == "number") && (!(data0 % 1) && !isNaN(data0))) && (isFinite(data0)))){
const err6 = {instancePath:instancePath+"/protocol_version",schemaPath:"#/properties/protocol_version/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(!(data0 === 1)){
const err7 = {instancePath:instancePath+"/protocol_version",schemaPath:"#/properties/protocol_version/enum",keyword:"enum",params:{allowedValues: schema49.properties.protocol_version.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.run_epoch !== undefined){
let data1 = data.run_epoch;
if(typeof data1 === "string"){
if(func1(data1) > 36){
const err8 = {instancePath:instancePath+"/run_epoch",schemaPath:"#/$defs/RunEpoch/maxLength",keyword:"maxLength",params:{limit: 36},message:"must NOT have more than 36 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(func1(data1) < 36){
const err9 = {instancePath:instancePath+"/run_epoch",schemaPath:"#/$defs/RunEpoch/minLength",keyword:"minLength",params:{limit: 36},message:"must NOT have fewer than 36 characters"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(!pattern5.test(data1)){
const err10 = {instancePath:instancePath+"/run_epoch",schemaPath:"#/$defs/RunEpoch/pattern",keyword:"pattern",params:{pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},message:"must match pattern \""+"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"+"\""};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
else {
const err11 = {instancePath:instancePath+"/run_epoch",schemaPath:"#/$defs/RunEpoch/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.ready !== undefined){
if(typeof data.ready !== "boolean"){
const err12 = {instancePath:instancePath+"/ready",schemaPath:"#/properties/ready/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.state !== undefined){
let data3 = data.state;
if(typeof data3 !== "string"){
const err13 = {instancePath:instancePath+"/state",schemaPath:"#/properties/state/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(!(((data3 === "ready") || (data3 === "unavailable")) || (data3 === "disabled"))){
const err14 = {instancePath:instancePath+"/state",schemaPath:"#/properties/state/enum",keyword:"enum",params:{allowedValues: schema49.properties.state.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data.limits !== undefined){
let data4 = data.limits;
if(data4 && typeof data4 == "object" && !Array.isArray(data4)){
if(data4.input_bytes === undefined){
const err15 = {instancePath:instancePath+"/limits",schemaPath:"#/$defs/Limits/required",keyword:"required",params:{missingProperty: "input_bytes"},message:"must have required property '"+"input_bytes"+"'"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(data4.prefix_bytes === undefined){
const err16 = {instancePath:instancePath+"/limits",schemaPath:"#/$defs/Limits/required",keyword:"required",params:{missingProperty: "prefix_bytes"},message:"must have required property '"+"prefix_bytes"+"'"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(data4.output_bytes === undefined){
const err17 = {instancePath:instancePath+"/limits",schemaPath:"#/$defs/Limits/required",keyword:"required",params:{missingProperty: "output_bytes"},message:"must have required property '"+"output_bytes"+"'"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(data4.canvas_bytes === undefined){
const err18 = {instancePath:instancePath+"/limits",schemaPath:"#/$defs/Limits/required",keyword:"required",params:{missingProperty: "canvas_bytes"},message:"must have required property '"+"canvas_bytes"+"'"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(data4.message_bytes === undefined){
const err19 = {instancePath:instancePath+"/limits",schemaPath:"#/$defs/Limits/required",keyword:"required",params:{missingProperty: "message_bytes"},message:"must have required property '"+"message_bytes"+"'"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
if(data4.max_active_runs === undefined){
const err20 = {instancePath:instancePath+"/limits",schemaPath:"#/$defs/Limits/required",keyword:"required",params:{missingProperty: "max_active_runs"},message:"must have required property '"+"max_active_runs"+"'"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(data4.execution_budget_seconds === undefined){
const err21 = {instancePath:instancePath+"/limits",schemaPath:"#/$defs/Limits/required",keyword:"required",params:{missingProperty: "execution_budget_seconds"},message:"must have required property '"+"execution_budget_seconds"+"'"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
if(data4.editor_ttl_seconds === undefined){
const err22 = {instancePath:instancePath+"/limits",schemaPath:"#/$defs/Limits/required",keyword:"required",params:{missingProperty: "editor_ttl_seconds"},message:"must have required property '"+"editor_ttl_seconds"+"'"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
for(const key1 in data4){
if(!((((((((key1 === "input_bytes") || (key1 === "prefix_bytes")) || (key1 === "output_bytes")) || (key1 === "canvas_bytes")) || (key1 === "message_bytes")) || (key1 === "max_active_runs")) || (key1 === "execution_budget_seconds")) || (key1 === "editor_ttl_seconds"))){
const err23 = {instancePath:instancePath+"/limits",schemaPath:"#/$defs/Limits/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
if(data4.input_bytes !== undefined){
let data5 = data4.input_bytes;
if(!(((typeof data5 == "number") && (!(data5 % 1) && !isNaN(data5))) && (isFinite(data5)))){
const err24 = {instancePath:instancePath+"/limits/input_bytes",schemaPath:"#/$defs/Limits/properties/input_bytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
if(!(data5 === 4096)){
const err25 = {instancePath:instancePath+"/limits/input_bytes",schemaPath:"#/$defs/Limits/properties/input_bytes/enum",keyword:"enum",params:{allowedValues: schema47.properties.input_bytes.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data4.prefix_bytes !== undefined){
let data6 = data4.prefix_bytes;
if(!(((typeof data6 == "number") && (!(data6 % 1) && !isNaN(data6))) && (isFinite(data6)))){
const err26 = {instancePath:instancePath+"/limits/prefix_bytes",schemaPath:"#/$defs/Limits/properties/prefix_bytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
if(!(data6 === 1024)){
const err27 = {instancePath:instancePath+"/limits/prefix_bytes",schemaPath:"#/$defs/Limits/properties/prefix_bytes/enum",keyword:"enum",params:{allowedValues: schema47.properties.prefix_bytes.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
if(data4.output_bytes !== undefined){
let data7 = data4.output_bytes;
if(!(((typeof data7 == "number") && (!(data7 % 1) && !isNaN(data7))) && (isFinite(data7)))){
const err28 = {instancePath:instancePath+"/limits/output_bytes",schemaPath:"#/$defs/Limits/properties/output_bytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
if(!(data7 === 5120)){
const err29 = {instancePath:instancePath+"/limits/output_bytes",schemaPath:"#/$defs/Limits/properties/output_bytes/enum",keyword:"enum",params:{allowedValues: schema47.properties.output_bytes.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
if(data4.canvas_bytes !== undefined){
let data8 = data4.canvas_bytes;
if(!(((typeof data8 == "number") && (!(data8 % 1) && !isNaN(data8))) && (isFinite(data8)))){
const err30 = {instancePath:instancePath+"/limits/canvas_bytes",schemaPath:"#/$defs/Limits/properties/canvas_bytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
if(!(data8 === 262144)){
const err31 = {instancePath:instancePath+"/limits/canvas_bytes",schemaPath:"#/$defs/Limits/properties/canvas_bytes/enum",keyword:"enum",params:{allowedValues: schema47.properties.canvas_bytes.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
}
if(data4.message_bytes !== undefined){
let data9 = data4.message_bytes;
if(!(((typeof data9 == "number") && (!(data9 % 1) && !isNaN(data9))) && (isFinite(data9)))){
const err32 = {instancePath:instancePath+"/limits/message_bytes",schemaPath:"#/$defs/Limits/properties/message_bytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
if(!(data9 === 524288)){
const err33 = {instancePath:instancePath+"/limits/message_bytes",schemaPath:"#/$defs/Limits/properties/message_bytes/enum",keyword:"enum",params:{allowedValues: schema47.properties.message_bytes.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
}
if(data4.max_active_runs !== undefined){
let data10 = data4.max_active_runs;
if(!(((typeof data10 == "number") && (!(data10 % 1) && !isNaN(data10))) && (isFinite(data10)))){
const err34 = {instancePath:instancePath+"/limits/max_active_runs",schemaPath:"#/$defs/Limits/properties/max_active_runs/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
if(!(data10 === 1)){
const err35 = {instancePath:instancePath+"/limits/max_active_runs",schemaPath:"#/$defs/Limits/properties/max_active_runs/enum",keyword:"enum",params:{allowedValues: schema47.properties.max_active_runs.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
}
if(data4.execution_budget_seconds !== undefined){
let data11 = data4.execution_budget_seconds;
if(!(((typeof data11 == "number") && (!(data11 % 1) && !isNaN(data11))) && (isFinite(data11)))){
const err36 = {instancePath:instancePath+"/limits/execution_budget_seconds",schemaPath:"#/$defs/Limits/properties/execution_budget_seconds/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
if(!(data11 === 30)){
const err37 = {instancePath:instancePath+"/limits/execution_budget_seconds",schemaPath:"#/$defs/Limits/properties/execution_budget_seconds/enum",keyword:"enum",params:{allowedValues: schema47.properties.execution_budget_seconds.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
}
if(data4.editor_ttl_seconds !== undefined){
let data12 = data4.editor_ttl_seconds;
if(!(((typeof data12 == "number") && (!(data12 % 1) && !isNaN(data12))) && (isFinite(data12)))){
const err38 = {instancePath:instancePath+"/limits/editor_ttl_seconds",schemaPath:"#/$defs/Limits/properties/editor_ttl_seconds/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
if(!(data12 === 300)){
const err39 = {instancePath:instancePath+"/limits/editor_ttl_seconds",schemaPath:"#/$defs/Limits/properties/editor_ttl_seconds/enum",keyword:"enum",params:{allowedValues: schema47.properties.editor_ttl_seconds.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
}
}
else {
const err40 = {instancePath:instancePath+"/limits",schemaPath:"#/$defs/Limits/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
}
}
else {
const err41 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
validate31.errors = vErrors;
return errors === 0;
}
validate31.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate30(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/ServiceStatus" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate30.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(!(validate31(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate31.errors : vErrors.concat(validate31.errors);
errors = vErrors.length;
}
validate30.errors = vErrors;
return errors === 0;
}
validate30.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const v_Principal = validate33;
const schema52 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/Principal","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/Principal"};
const schema53 = {"type":"object","additionalProperties":false,"properties":{"owner_id":{"$ref":"#/$defs/Identifier"},"tenant_id":{"$ref":"#/$defs/Identifier"},"user_id":{"$ref":"#/$defs/Identifier"},"space_id":{"$ref":"#/$defs/Identifier"}},"required":["owner_id","tenant_id","user_id","space_id"]};

function validate34(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate34.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.owner_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "owner_id"},message:"must have required property '"+"owner_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.tenant_id === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "tenant_id"},message:"must have required property '"+"tenant_id"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.user_id === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "user_id"},message:"must have required property '"+"user_id"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.space_id === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "space_id"},message:"must have required property '"+"space_id"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "owner_id") || (key0 === "tenant_id")) || (key0 === "user_id")) || (key0 === "space_id"))){
const err4 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.owner_id !== undefined){
let data0 = data.owner_id;
if(typeof data0 === "string"){
if(func1(data0) > 64){
const err5 = {instancePath:instancePath+"/owner_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(func1(data0) < 1){
const err6 = {instancePath:instancePath+"/owner_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(!pattern4.test(data0)){
const err7 = {instancePath:instancePath+"/owner_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
else {
const err8 = {instancePath:instancePath+"/owner_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.tenant_id !== undefined){
let data1 = data.tenant_id;
if(typeof data1 === "string"){
if(func1(data1) > 64){
const err9 = {instancePath:instancePath+"/tenant_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(func1(data1) < 1){
const err10 = {instancePath:instancePath+"/tenant_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(!pattern4.test(data1)){
const err11 = {instancePath:instancePath+"/tenant_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
else {
const err12 = {instancePath:instancePath+"/tenant_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.user_id !== undefined){
let data2 = data.user_id;
if(typeof data2 === "string"){
if(func1(data2) > 64){
const err13 = {instancePath:instancePath+"/user_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(func1(data2) < 1){
const err14 = {instancePath:instancePath+"/user_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(!pattern4.test(data2)){
const err15 = {instancePath:instancePath+"/user_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
else {
const err16 = {instancePath:instancePath+"/user_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data.space_id !== undefined){
let data3 = data.space_id;
if(typeof data3 === "string"){
if(func1(data3) > 64){
const err17 = {instancePath:instancePath+"/space_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(func1(data3) < 1){
const err18 = {instancePath:instancePath+"/space_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(!pattern4.test(data3)){
const err19 = {instancePath:instancePath+"/space_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
else {
const err20 = {instancePath:instancePath+"/space_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
}
else {
const err21 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
validate34.errors = vErrors;
return errors === 0;
}
validate34.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate33(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/Principal" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate33.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(!(validate34(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate34.errors : vErrors.concat(validate34.errors);
errors = vErrors.length;
}
validate33.errors = vErrors;
return errors === 0;
}
validate33.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const v_Workflow = validate36;
const schema58 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/Workflow","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/Workflow"};
const schema59 = {"type":"object","additionalProperties":false,"properties":{"workflow_id":{"$ref":"#/$defs/Identifier"},"name":{"type":"string","maxLength":80,"minLength":1},"revision":{"$ref":"#/$defs/Identifier"},"canvas":{"type":"string","maxLength":262144,"x-utf8-max-bytes":262144},"runnable":{"type":"boolean"},"published_version":{"$ref":"#/$defs/Version"},"updated_at_ms":{"type":"integer","minimum":0},"description":{"type":"string","maxLength":600,"description":"Human-readable workflow purpose. Optional for legacy clients/resources; omitted create value means empty. Response field is emitted only after description-v1 HTTP opt-in. Not a prompt or an instruction to execute."}},"required":["workflow_id","name","revision","canvas","runnable","updated_at_ms"],"description":"Coze-owned graph and revision. Canvas is native JSON text; safe incomplete drafts may be saved. IDs are opaque strings, including decimal Coze IDs, never JS numbers."};

function validate37(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate37.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.workflow_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "workflow_id"},message:"must have required property '"+"workflow_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.name === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "name"},message:"must have required property '"+"name"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.revision === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "revision"},message:"must have required property '"+"revision"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.canvas === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "canvas"},message:"must have required property '"+"canvas"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.runnable === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "runnable"},message:"must have required property '"+"runnable"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.updated_at_ms === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "updated_at_ms"},message:"must have required property '"+"updated_at_ms"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
for(const key0 in data){
if(!((((((((key0 === "workflow_id") || (key0 === "name")) || (key0 === "revision")) || (key0 === "canvas")) || (key0 === "runnable")) || (key0 === "published_version")) || (key0 === "updated_at_ms")) || (key0 === "description"))){
const err6 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.workflow_id !== undefined){
let data0 = data.workflow_id;
if(typeof data0 === "string"){
if(func1(data0) > 64){
const err7 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(func1(data0) < 1){
const err8 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(!pattern4.test(data0)){
const err9 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
else {
const err10 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.name !== undefined){
let data1 = data.name;
if(typeof data1 === "string"){
if(func1(data1) > 80){
const err11 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/maxLength",keyword:"maxLength",params:{limit: 80},message:"must NOT have more than 80 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(func1(data1) < 1){
const err12 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
else {
const err13 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data.revision !== undefined){
let data2 = data.revision;
if(typeof data2 === "string"){
if(func1(data2) > 64){
const err14 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(func1(data2) < 1){
const err15 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(!pattern4.test(data2)){
const err16 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
else {
const err17 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data.canvas !== undefined){
let data3 = data.canvas;
if(typeof data3 === "string"){
if(func1(data3) > 262144){
const err18 = {instancePath:instancePath+"/canvas",schemaPath:"#/properties/canvas/maxLength",keyword:"maxLength",params:{limit: 262144},message:"must NOT have more than 262144 characters"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(new TextEncoder().encode(data3).length > 262144){
const err19 = {instancePath:instancePath+"/canvas",schemaPath:"#/properties/canvas/x-utf8-max-bytes",keyword:"x-utf8-max-bytes",params:{},message:"must pass \"x-utf8-max-bytes\" keyword validation"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
else {
const err20 = {instancePath:instancePath+"/canvas",schemaPath:"#/properties/canvas/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
if(data.runnable !== undefined){
if(typeof data.runnable !== "boolean"){
const err21 = {instancePath:instancePath+"/runnable",schemaPath:"#/properties/runnable/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data.published_version !== undefined){
let data5 = data.published_version;
if(typeof data5 === "string"){
if(func1(data5) > 32){
const err22 = {instancePath:instancePath+"/published_version",schemaPath:"#/$defs/Version/maxLength",keyword:"maxLength",params:{limit: 32},message:"must NOT have more than 32 characters"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
if(!pattern6.test(data5)){
const err23 = {instancePath:instancePath+"/published_version",schemaPath:"#/$defs/Version/pattern",keyword:"pattern",params:{pattern: "^v0[.]0[.][1-9][0-9]*$"},message:"must match pattern \""+"^v0[.]0[.][1-9][0-9]*$"+"\""};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
else {
const err24 = {instancePath:instancePath+"/published_version",schemaPath:"#/$defs/Version/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
if(data.updated_at_ms !== undefined){
let data6 = data.updated_at_ms;
if(!(((typeof data6 == "number") && (!(data6 % 1) && !isNaN(data6))) && (isFinite(data6)))){
const err25 = {instancePath:instancePath+"/updated_at_ms",schemaPath:"#/properties/updated_at_ms/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
if((typeof data6 == "number") && (isFinite(data6))){
if(data6 < 0 || isNaN(data6)){
const err26 = {instancePath:instancePath+"/updated_at_ms",schemaPath:"#/properties/updated_at_ms/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
}
if(data.description !== undefined){
let data7 = data.description;
if(typeof data7 === "string"){
if(func1(data7) > 600){
const err27 = {instancePath:instancePath+"/description",schemaPath:"#/properties/description/maxLength",keyword:"maxLength",params:{limit: 600},message:"must NOT have more than 600 characters"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
else {
const err28 = {instancePath:instancePath+"/description",schemaPath:"#/properties/description/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
}
else {
const err29 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
validate37.errors = vErrors;
return errors === 0;
}
validate37.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate36(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/Workflow" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate36.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(!(validate37(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate37.errors : vErrors.concat(validate37.errors);
errors = vErrors.length;
}
validate36.errors = vErrors;
return errors === 0;
}
validate36.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const v_WorkflowList = validate39;
const schema63 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/WorkflowList","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/WorkflowList"};
const schema64 = {"type":"object","additionalProperties":false,"properties":{"items":{"type":"array","items":{"$ref":"#/$defs/WorkflowSummary"},"maxItems":50},"next_cursor":{"type":"string","maxLength":256}},"required":["items"]};
const schema65 = {"type":"object","additionalProperties":false,"properties":{"workflow_id":{"$ref":"#/$defs/Identifier"},"name":{"type":"string","maxLength":80,"minLength":1},"revision":{"$ref":"#/$defs/Identifier"},"runnable":{"type":"boolean"},"published_version":{"$ref":"#/$defs/Version"},"updated_at_ms":{"type":"integer","minimum":0},"description":{"type":"string","maxLength":600,"description":"Human-readable workflow purpose. Optional for legacy clients/resources; omitted create value means empty. Response field is emitted only after description-v1 HTTP opt-in. Not a prompt or an instruction to execute."}},"required":["workflow_id","name","revision","runnable","updated_at_ms"],"description":"Bounded list summary; read the detail endpoint for full content."};

function validate41(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate41.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.workflow_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "workflow_id"},message:"must have required property '"+"workflow_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.name === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "name"},message:"must have required property '"+"name"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.revision === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "revision"},message:"must have required property '"+"revision"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.runnable === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "runnable"},message:"must have required property '"+"runnable"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.updated_at_ms === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "updated_at_ms"},message:"must have required property '"+"updated_at_ms"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
for(const key0 in data){
if(!(((((((key0 === "workflow_id") || (key0 === "name")) || (key0 === "revision")) || (key0 === "runnable")) || (key0 === "published_version")) || (key0 === "updated_at_ms")) || (key0 === "description"))){
const err5 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.workflow_id !== undefined){
let data0 = data.workflow_id;
if(typeof data0 === "string"){
if(func1(data0) > 64){
const err6 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(func1(data0) < 1){
const err7 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(!pattern4.test(data0)){
const err8 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
else {
const err9 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.name !== undefined){
let data1 = data.name;
if(typeof data1 === "string"){
if(func1(data1) > 80){
const err10 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/maxLength",keyword:"maxLength",params:{limit: 80},message:"must NOT have more than 80 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(func1(data1) < 1){
const err11 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
else {
const err12 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.revision !== undefined){
let data2 = data.revision;
if(typeof data2 === "string"){
if(func1(data2) > 64){
const err13 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(func1(data2) < 1){
const err14 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(!pattern4.test(data2)){
const err15 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
else {
const err16 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data.runnable !== undefined){
if(typeof data.runnable !== "boolean"){
const err17 = {instancePath:instancePath+"/runnable",schemaPath:"#/properties/runnable/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data.published_version !== undefined){
let data4 = data.published_version;
if(typeof data4 === "string"){
if(func1(data4) > 32){
const err18 = {instancePath:instancePath+"/published_version",schemaPath:"#/$defs/Version/maxLength",keyword:"maxLength",params:{limit: 32},message:"must NOT have more than 32 characters"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(!pattern6.test(data4)){
const err19 = {instancePath:instancePath+"/published_version",schemaPath:"#/$defs/Version/pattern",keyword:"pattern",params:{pattern: "^v0[.]0[.][1-9][0-9]*$"},message:"must match pattern \""+"^v0[.]0[.][1-9][0-9]*$"+"\""};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
else {
const err20 = {instancePath:instancePath+"/published_version",schemaPath:"#/$defs/Version/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
if(data.updated_at_ms !== undefined){
let data5 = data.updated_at_ms;
if(!(((typeof data5 == "number") && (!(data5 % 1) && !isNaN(data5))) && (isFinite(data5)))){
const err21 = {instancePath:instancePath+"/updated_at_ms",schemaPath:"#/properties/updated_at_ms/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
if((typeof data5 == "number") && (isFinite(data5))){
if(data5 < 0 || isNaN(data5)){
const err22 = {instancePath:instancePath+"/updated_at_ms",schemaPath:"#/properties/updated_at_ms/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
}
if(data.description !== undefined){
let data6 = data.description;
if(typeof data6 === "string"){
if(func1(data6) > 600){
const err23 = {instancePath:instancePath+"/description",schemaPath:"#/properties/description/maxLength",keyword:"maxLength",params:{limit: 600},message:"must NOT have more than 600 characters"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
else {
const err24 = {instancePath:instancePath+"/description",schemaPath:"#/properties/description/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
}
else {
const err25 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
validate41.errors = vErrors;
return errors === 0;
}
validate41.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate40(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate40.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.items === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "items"},message:"must have required property '"+"items"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!((key0 === "items") || (key0 === "next_cursor"))){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.items !== undefined){
let data0 = data.items;
if(Array.isArray(data0)){
if(data0.length > 50){
const err2 = {instancePath:instancePath+"/items",schemaPath:"#/properties/items/maxItems",keyword:"maxItems",params:{limit: 50},message:"must NOT have more than 50 items"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
const len0 = data0.length;
for(let i0=0; i0<len0; i0++){
if(!(validate41(data0[i0], {instancePath:instancePath+"/items/" + i0,parentData:data0,parentDataProperty:i0,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate41.errors : vErrors.concat(validate41.errors);
errors = vErrors.length;
}
}
}
else {
const err3 = {instancePath:instancePath+"/items",schemaPath:"#/properties/items/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.next_cursor !== undefined){
let data2 = data.next_cursor;
if(typeof data2 === "string"){
if(func1(data2) > 256){
const err4 = {instancePath:instancePath+"/next_cursor",schemaPath:"#/properties/next_cursor/maxLength",keyword:"maxLength",params:{limit: 256},message:"must NOT have more than 256 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
else {
const err5 = {instancePath:instancePath+"/next_cursor",schemaPath:"#/properties/next_cursor/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
}
else {
const err6 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
validate40.errors = vErrors;
return errors === 0;
}
validate40.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate39(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/WorkflowList" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate39.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(!(validate40(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate40.errors : vErrors.concat(validate40.errors);
errors = vErrors.length;
}
validate39.errors = vErrors;
return errors === 0;
}
validate39.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const v_ListRequest = validate44;
const schema69 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/ListRequest","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/ListRequest"};
const schema70 = {"type":"object","additionalProperties":false,"properties":{"cursor":{"type":"string","maxLength":256},"limit":{"type":"integer","minimum":1,"maximum":50,"default":20}},"required":[]};

function validate44(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/ListRequest" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate44.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
for(const key0 in data){
if(!((key0 === "cursor") || (key0 === "limit"))){
const err0 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/ListRequest/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
if(data.cursor !== undefined){
let data0 = data.cursor;
if(typeof data0 === "string"){
if(func1(data0) > 256){
const err1 = {instancePath:instancePath+"/cursor",schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/ListRequest/properties/cursor/maxLength",keyword:"maxLength",params:{limit: 256},message:"must NOT have more than 256 characters"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
else {
const err2 = {instancePath:instancePath+"/cursor",schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/ListRequest/properties/cursor/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.limit !== undefined){
let data1 = data.limit;
if(!(((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1))) && (isFinite(data1)))){
const err3 = {instancePath:instancePath+"/limit",schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/ListRequest/properties/limit/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if((typeof data1 == "number") && (isFinite(data1))){
if(data1 > 50 || isNaN(data1)){
const err4 = {instancePath:instancePath+"/limit",schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/ListRequest/properties/limit/maximum",keyword:"maximum",params:{comparison: "<=", limit: 50},message:"must be <= 50"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data1 < 1 || isNaN(data1)){
const err5 = {instancePath:instancePath+"/limit",schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/ListRequest/properties/limit/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
}
}
else {
const err6 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/ListRequest/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
validate44.errors = vErrors;
return errors === 0;
}
validate44.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const v_CreateInput = validate45;
const schema71 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/CreateInput","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/CreateInput"};
const schema72 = {"type":"object","additionalProperties":false,"properties":{"name":{"type":"string","maxLength":80,"minLength":1},"description":{"type":"string","maxLength":600,"description":"Human-readable workflow purpose. Optional for legacy clients/resources; omitted create value means empty. Response field is emitted only after description-v1 HTTP opt-in. Not a prompt or an instruction to execute."}},"required":["name"]};

function validate45(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/CreateInput" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate45.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.name === undefined){
const err0 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/CreateInput/required",keyword:"required",params:{missingProperty: "name"},message:"must have required property '"+"name"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!((key0 === "name") || (key0 === "description"))){
const err1 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/CreateInput/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.name !== undefined){
let data0 = data.name;
if(typeof data0 === "string"){
if(func1(data0) > 80){
const err2 = {instancePath:instancePath+"/name",schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/CreateInput/properties/name/maxLength",keyword:"maxLength",params:{limit: 80},message:"must NOT have more than 80 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func1(data0) < 1){
const err3 = {instancePath:instancePath+"/name",schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/CreateInput/properties/name/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
else {
const err4 = {instancePath:instancePath+"/name",schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/CreateInput/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.description !== undefined){
let data1 = data.description;
if(typeof data1 === "string"){
if(func1(data1) > 600){
const err5 = {instancePath:instancePath+"/description",schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/CreateInput/properties/description/maxLength",keyword:"maxLength",params:{limit: 600},message:"must NOT have more than 600 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
else {
const err6 = {instancePath:instancePath+"/description",schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/CreateInput/properties/description/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
}
else {
const err7 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/CreateInput/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
validate45.errors = vErrors;
return errors === 0;
}
validate45.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const v_CreateRequest = validate46;
const schema73 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/CreateRequest","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/CreateRequest"};
const schema74 = {"type":"object","additionalProperties":false,"properties":{"name":{"type":"string","maxLength":80,"minLength":1},"operation_id":{"$ref":"#/$defs/OperationId"},"description":{"type":"string","maxLength":600,"description":"Human-readable workflow purpose. Optional for legacy clients/resources; omitted create value means empty. Response field is emitted only after description-v1 HTTP opt-in. Not a prompt or an instruction to execute."}},"required":["name","operation_id"]};

function validate47(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate47.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.name === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "name"},message:"must have required property '"+"name"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.operation_id === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "operation_id"},message:"must have required property '"+"operation_id"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "name") || (key0 === "operation_id")) || (key0 === "description"))){
const err2 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.name !== undefined){
let data0 = data.name;
if(typeof data0 === "string"){
if(func1(data0) > 80){
const err3 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/maxLength",keyword:"maxLength",params:{limit: 80},message:"must NOT have more than 80 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(func1(data0) < 1){
const err4 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
else {
const err5 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.operation_id !== undefined){
let data1 = data.operation_id;
if(typeof data1 === "string"){
if(func1(data1) > 36){
const err6 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/maxLength",keyword:"maxLength",params:{limit: 36},message:"must NOT have more than 36 characters"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(func1(data1) < 36){
const err7 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/minLength",keyword:"minLength",params:{limit: 36},message:"must NOT have fewer than 36 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(!pattern5.test(data1)){
const err8 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/pattern",keyword:"pattern",params:{pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},message:"must match pattern \""+"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"+"\""};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
else {
const err9 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.description !== undefined){
let data2 = data.description;
if(typeof data2 === "string"){
if(func1(data2) > 600){
const err10 = {instancePath:instancePath+"/description",schemaPath:"#/properties/description/maxLength",keyword:"maxLength",params:{limit: 600},message:"must NOT have more than 600 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
else {
const err11 = {instancePath:instancePath+"/description",schemaPath:"#/properties/description/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
}
else {
const err12 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
validate47.errors = vErrors;
return errors === 0;
}
validate47.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate46(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/CreateRequest" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate46.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(!(validate47(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate47.errors : vErrors.concat(validate47.errors);
errors = vErrors.length;
}
validate46.errors = vErrors;
return errors === 0;
}
validate46.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const v_TextInput = validate49;
const schema76 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/TextInput","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/TextInput"};
const schema77 = {"type":"object","additionalProperties":false,"properties":{"input":{"type":"string","maxLength":4096,"x-utf8-max-bytes":4096}},"required":["input"]};

function validate49(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/TextInput" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate49.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.input === undefined){
const err0 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/TextInput/required",keyword:"required",params:{missingProperty: "input"},message:"must have required property '"+"input"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "input")){
const err1 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/TextInput/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.input !== undefined){
let data0 = data.input;
if(typeof data0 === "string"){
if(func1(data0) > 4096){
const err2 = {instancePath:instancePath+"/input",schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/TextInput/properties/input/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(new TextEncoder().encode(data0).length > 4096){
const err3 = {instancePath:instancePath+"/input",schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/TextInput/properties/input/x-utf8-max-bytes",keyword:"x-utf8-max-bytes",params:{},message:"must pass \"x-utf8-max-bytes\" keyword validation"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
else {
const err4 = {instancePath:instancePath+"/input",schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/TextInput/properties/input/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
}
else {
const err5 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/TextInput/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
validate49.errors = vErrors;
return errors === 0;
}
validate49.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const v_SaveRequest = validate50;
const schema78 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/SaveRequest","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/SaveRequest"};
const schema79 = {"type":"object","additionalProperties":false,"properties":{"operation_id":{"$ref":"#/$defs/OperationId"},"expected_revision":{"$ref":"#/$defs/Identifier"},"name":{"type":"string","maxLength":80,"minLength":1},"canvas":{"type":"string","maxLength":262144,"x-utf8-max-bytes":262144}},"required":["operation_id","expected_revision","name","canvas"]};

function validate51(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate51.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.operation_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "operation_id"},message:"must have required property '"+"operation_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.expected_revision === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "expected_revision"},message:"must have required property '"+"expected_revision"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.name === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "name"},message:"must have required property '"+"name"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.canvas === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "canvas"},message:"must have required property '"+"canvas"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "operation_id") || (key0 === "expected_revision")) || (key0 === "name")) || (key0 === "canvas"))){
const err4 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.operation_id !== undefined){
let data0 = data.operation_id;
if(typeof data0 === "string"){
if(func1(data0) > 36){
const err5 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/maxLength",keyword:"maxLength",params:{limit: 36},message:"must NOT have more than 36 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(func1(data0) < 36){
const err6 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/minLength",keyword:"minLength",params:{limit: 36},message:"must NOT have fewer than 36 characters"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(!pattern5.test(data0)){
const err7 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/pattern",keyword:"pattern",params:{pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},message:"must match pattern \""+"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"+"\""};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
else {
const err8 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.expected_revision !== undefined){
let data1 = data.expected_revision;
if(typeof data1 === "string"){
if(func1(data1) > 64){
const err9 = {instancePath:instancePath+"/expected_revision",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(func1(data1) < 1){
const err10 = {instancePath:instancePath+"/expected_revision",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(!pattern4.test(data1)){
const err11 = {instancePath:instancePath+"/expected_revision",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
else {
const err12 = {instancePath:instancePath+"/expected_revision",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.name !== undefined){
let data2 = data.name;
if(typeof data2 === "string"){
if(func1(data2) > 80){
const err13 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/maxLength",keyword:"maxLength",params:{limit: 80},message:"must NOT have more than 80 characters"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(func1(data2) < 1){
const err14 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
else {
const err15 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data.canvas !== undefined){
let data3 = data.canvas;
if(typeof data3 === "string"){
if(func1(data3) > 262144){
const err16 = {instancePath:instancePath+"/canvas",schemaPath:"#/properties/canvas/maxLength",keyword:"maxLength",params:{limit: 262144},message:"must NOT have more than 262144 characters"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(new TextEncoder().encode(data3).length > 262144){
const err17 = {instancePath:instancePath+"/canvas",schemaPath:"#/properties/canvas/x-utf8-max-bytes",keyword:"x-utf8-max-bytes",params:{},message:"must pass \"x-utf8-max-bytes\" keyword validation"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
else {
const err18 = {instancePath:instancePath+"/canvas",schemaPath:"#/properties/canvas/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
}
else {
const err19 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
validate51.errors = vErrors;
return errors === 0;
}
validate51.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate50(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/SaveRequest" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate50.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(!(validate51(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate51.errors : vErrors.concat(validate51.errors);
errors = vErrors.length;
}
validate50.errors = vErrors;
return errors === 0;
}
validate50.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const v_TestRequest = validate53;
const schema82 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/TestRequest","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/TestRequest"};
const schema83 = {"type":"object","additionalProperties":false,"properties":{"operation_id":{"$ref":"#/$defs/OperationId"},"expected_revision":{"$ref":"#/$defs/Identifier"},"input":{"$ref":"#/$defs/TextInput"}},"required":["operation_id","expected_revision","input"]};

function validate54(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate54.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.operation_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "operation_id"},message:"must have required property '"+"operation_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.expected_revision === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "expected_revision"},message:"must have required property '"+"expected_revision"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.input === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "input"},message:"must have required property '"+"input"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "operation_id") || (key0 === "expected_revision")) || (key0 === "input"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.operation_id !== undefined){
let data0 = data.operation_id;
if(typeof data0 === "string"){
if(func1(data0) > 36){
const err4 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/maxLength",keyword:"maxLength",params:{limit: 36},message:"must NOT have more than 36 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(func1(data0) < 36){
const err5 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/minLength",keyword:"minLength",params:{limit: 36},message:"must NOT have fewer than 36 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(!pattern5.test(data0)){
const err6 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/pattern",keyword:"pattern",params:{pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},message:"must match pattern \""+"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"+"\""};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
else {
const err7 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.expected_revision !== undefined){
let data1 = data.expected_revision;
if(typeof data1 === "string"){
if(func1(data1) > 64){
const err8 = {instancePath:instancePath+"/expected_revision",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(func1(data1) < 1){
const err9 = {instancePath:instancePath+"/expected_revision",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(!pattern4.test(data1)){
const err10 = {instancePath:instancePath+"/expected_revision",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
else {
const err11 = {instancePath:instancePath+"/expected_revision",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.input !== undefined){
let data2 = data.input;
if(data2 && typeof data2 == "object" && !Array.isArray(data2)){
if(data2.input === undefined){
const err12 = {instancePath:instancePath+"/input",schemaPath:"#/$defs/TextInput/required",keyword:"required",params:{missingProperty: "input"},message:"must have required property '"+"input"+"'"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
for(const key1 in data2){
if(!(key1 === "input")){
const err13 = {instancePath:instancePath+"/input",schemaPath:"#/$defs/TextInput/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data2.input !== undefined){
let data3 = data2.input;
if(typeof data3 === "string"){
if(func1(data3) > 4096){
const err14 = {instancePath:instancePath+"/input/input",schemaPath:"#/$defs/TextInput/properties/input/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(new TextEncoder().encode(data3).length > 4096){
const err15 = {instancePath:instancePath+"/input/input",schemaPath:"#/$defs/TextInput/properties/input/x-utf8-max-bytes",keyword:"x-utf8-max-bytes",params:{},message:"must pass \"x-utf8-max-bytes\" keyword validation"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
else {
const err16 = {instancePath:instancePath+"/input/input",schemaPath:"#/$defs/TextInput/properties/input/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
}
else {
const err17 = {instancePath:instancePath+"/input",schemaPath:"#/$defs/TextInput/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
}
else {
const err18 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
validate54.errors = vErrors;
return errors === 0;
}
validate54.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate53(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/TestRequest" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate53.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(!(validate54(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
errors = vErrors.length;
}
validate53.errors = vErrors;
return errors === 0;
}
validate53.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const v_PublishRequest = validate56;
const schema87 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/PublishRequest","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/PublishRequest"};
const schema88 = {"type":"object","additionalProperties":false,"properties":{"operation_id":{"$ref":"#/$defs/OperationId"},"expected_revision":{"$ref":"#/$defs/Identifier"},"successful_test_run_id":{"$ref":"#/$defs/Identifier"}},"required":["operation_id","expected_revision","successful_test_run_id"]};

function validate57(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate57.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.operation_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "operation_id"},message:"must have required property '"+"operation_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.expected_revision === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "expected_revision"},message:"must have required property '"+"expected_revision"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.successful_test_run_id === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "successful_test_run_id"},message:"must have required property '"+"successful_test_run_id"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "operation_id") || (key0 === "expected_revision")) || (key0 === "successful_test_run_id"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.operation_id !== undefined){
let data0 = data.operation_id;
if(typeof data0 === "string"){
if(func1(data0) > 36){
const err4 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/maxLength",keyword:"maxLength",params:{limit: 36},message:"must NOT have more than 36 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(func1(data0) < 36){
const err5 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/minLength",keyword:"minLength",params:{limit: 36},message:"must NOT have fewer than 36 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(!pattern5.test(data0)){
const err6 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/pattern",keyword:"pattern",params:{pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},message:"must match pattern \""+"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"+"\""};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
else {
const err7 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.expected_revision !== undefined){
let data1 = data.expected_revision;
if(typeof data1 === "string"){
if(func1(data1) > 64){
const err8 = {instancePath:instancePath+"/expected_revision",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(func1(data1) < 1){
const err9 = {instancePath:instancePath+"/expected_revision",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(!pattern4.test(data1)){
const err10 = {instancePath:instancePath+"/expected_revision",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
else {
const err11 = {instancePath:instancePath+"/expected_revision",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.successful_test_run_id !== undefined){
let data2 = data.successful_test_run_id;
if(typeof data2 === "string"){
if(func1(data2) > 64){
const err12 = {instancePath:instancePath+"/successful_test_run_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(func1(data2) < 1){
const err13 = {instancePath:instancePath+"/successful_test_run_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(!pattern4.test(data2)){
const err14 = {instancePath:instancePath+"/successful_test_run_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
else {
const err15 = {instancePath:instancePath+"/successful_test_run_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
}
else {
const err16 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
validate57.errors = vErrors;
return errors === 0;
}
validate57.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate56(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/PublishRequest" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate56.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(!(validate57(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate57.errors : vErrors.concat(validate57.errors);
errors = vErrors.length;
}
validate56.errors = vErrors;
return errors === 0;
}
validate56.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const v_RunRequest = validate59;
const schema92 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/RunRequest","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/RunRequest"};
const schema93 = {"type":"object","additionalProperties":false,"properties":{"operation_id":{"$ref":"#/$defs/OperationId"},"version":{"$ref":"#/$defs/Version"},"input":{"$ref":"#/$defs/TextInput"}},"required":["operation_id","version","input"]};

function validate60(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate60.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.operation_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "operation_id"},message:"must have required property '"+"operation_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.version === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "version"},message:"must have required property '"+"version"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.input === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "input"},message:"must have required property '"+"input"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "operation_id") || (key0 === "version")) || (key0 === "input"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.operation_id !== undefined){
let data0 = data.operation_id;
if(typeof data0 === "string"){
if(func1(data0) > 36){
const err4 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/maxLength",keyword:"maxLength",params:{limit: 36},message:"must NOT have more than 36 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(func1(data0) < 36){
const err5 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/minLength",keyword:"minLength",params:{limit: 36},message:"must NOT have fewer than 36 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(!pattern5.test(data0)){
const err6 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/pattern",keyword:"pattern",params:{pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},message:"must match pattern \""+"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"+"\""};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
else {
const err7 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.version !== undefined){
let data1 = data.version;
if(typeof data1 === "string"){
if(func1(data1) > 32){
const err8 = {instancePath:instancePath+"/version",schemaPath:"#/$defs/Version/maxLength",keyword:"maxLength",params:{limit: 32},message:"must NOT have more than 32 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(!pattern6.test(data1)){
const err9 = {instancePath:instancePath+"/version",schemaPath:"#/$defs/Version/pattern",keyword:"pattern",params:{pattern: "^v0[.]0[.][1-9][0-9]*$"},message:"must match pattern \""+"^v0[.]0[.][1-9][0-9]*$"+"\""};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
else {
const err10 = {instancePath:instancePath+"/version",schemaPath:"#/$defs/Version/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.input !== undefined){
let data2 = data.input;
if(data2 && typeof data2 == "object" && !Array.isArray(data2)){
if(data2.input === undefined){
const err11 = {instancePath:instancePath+"/input",schemaPath:"#/$defs/TextInput/required",keyword:"required",params:{missingProperty: "input"},message:"must have required property '"+"input"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
for(const key1 in data2){
if(!(key1 === "input")){
const err12 = {instancePath:instancePath+"/input",schemaPath:"#/$defs/TextInput/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data2.input !== undefined){
let data3 = data2.input;
if(typeof data3 === "string"){
if(func1(data3) > 4096){
const err13 = {instancePath:instancePath+"/input/input",schemaPath:"#/$defs/TextInput/properties/input/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(new TextEncoder().encode(data3).length > 4096){
const err14 = {instancePath:instancePath+"/input/input",schemaPath:"#/$defs/TextInput/properties/input/x-utf8-max-bytes",keyword:"x-utf8-max-bytes",params:{},message:"must pass \"x-utf8-max-bytes\" keyword validation"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
else {
const err15 = {instancePath:instancePath+"/input/input",schemaPath:"#/$defs/TextInput/properties/input/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
}
else {
const err16 = {instancePath:instancePath+"/input",schemaPath:"#/$defs/TextInput/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
}
else {
const err17 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
validate60.errors = vErrors;
return errors === 0;
}
validate60.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate59(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/RunRequest" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate59.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(!(validate60(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate60.errors : vErrors.concat(validate60.errors);
errors = vErrors.length;
}
validate59.errors = vErrors;
return errors === 0;
}
validate59.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const v_RunInput = validate62;
const schema97 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/RunInput","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/RunInput"};
const schema98 = {"type":"object","additionalProperties":false,"properties":{"workflow_id":{"$ref":"#/$defs/Identifier"},"version":{"$ref":"#/$defs/Version"},"input":{"$ref":"#/$defs/TextInput"}},"required":["workflow_id","version","input"]};

function validate63(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate63.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.workflow_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "workflow_id"},message:"must have required property '"+"workflow_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.version === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "version"},message:"must have required property '"+"version"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.input === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "input"},message:"must have required property '"+"input"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "workflow_id") || (key0 === "version")) || (key0 === "input"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.workflow_id !== undefined){
let data0 = data.workflow_id;
if(typeof data0 === "string"){
if(func1(data0) > 64){
const err4 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(func1(data0) < 1){
const err5 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(!pattern4.test(data0)){
const err6 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
else {
const err7 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.version !== undefined){
let data1 = data.version;
if(typeof data1 === "string"){
if(func1(data1) > 32){
const err8 = {instancePath:instancePath+"/version",schemaPath:"#/$defs/Version/maxLength",keyword:"maxLength",params:{limit: 32},message:"must NOT have more than 32 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(!pattern6.test(data1)){
const err9 = {instancePath:instancePath+"/version",schemaPath:"#/$defs/Version/pattern",keyword:"pattern",params:{pattern: "^v0[.]0[.][1-9][0-9]*$"},message:"must match pattern \""+"^v0[.]0[.][1-9][0-9]*$"+"\""};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
else {
const err10 = {instancePath:instancePath+"/version",schemaPath:"#/$defs/Version/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.input !== undefined){
let data2 = data.input;
if(data2 && typeof data2 == "object" && !Array.isArray(data2)){
if(data2.input === undefined){
const err11 = {instancePath:instancePath+"/input",schemaPath:"#/$defs/TextInput/required",keyword:"required",params:{missingProperty: "input"},message:"must have required property '"+"input"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
for(const key1 in data2){
if(!(key1 === "input")){
const err12 = {instancePath:instancePath+"/input",schemaPath:"#/$defs/TextInput/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data2.input !== undefined){
let data3 = data2.input;
if(typeof data3 === "string"){
if(func1(data3) > 4096){
const err13 = {instancePath:instancePath+"/input/input",schemaPath:"#/$defs/TextInput/properties/input/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(new TextEncoder().encode(data3).length > 4096){
const err14 = {instancePath:instancePath+"/input/input",schemaPath:"#/$defs/TextInput/properties/input/x-utf8-max-bytes",keyword:"x-utf8-max-bytes",params:{},message:"must pass \"x-utf8-max-bytes\" keyword validation"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
else {
const err15 = {instancePath:instancePath+"/input/input",schemaPath:"#/$defs/TextInput/properties/input/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
}
else {
const err16 = {instancePath:instancePath+"/input",schemaPath:"#/$defs/TextInput/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
}
else {
const err17 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
validate63.errors = vErrors;
return errors === 0;
}
validate63.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate62(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/RunInput" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate62.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(!(validate63(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate63.errors : vErrors.concat(validate63.errors);
errors = vErrors.length;
}
validate62.errors = vErrors;
return errors === 0;
}
validate62.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const v_RunMode = validate65;
const schema102 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/RunMode","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/RunMode"};
const schema103 = {"type":"string","enum":["debug","release"]};

function validate65(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/RunMode" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate65.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(typeof data !== "string"){
const err0 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/RunMode/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(!((data === "debug") || (data === "release"))){
const err1 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/RunMode/enum",keyword:"enum",params:{allowedValues: schema103.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate65.errors = vErrors;
return errors === 0;
}
validate65.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const v_NodeResult = validate66;
const schema104 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/NodeResult","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/NodeResult"};
const schema105 = {"type":"object","additionalProperties":false,"properties":{"node_id":{"$ref":"#/$defs/Identifier"},"state":{"type":"string","maxLength":64},"output":{"type":"string","maxLength":5120,"x-utf8-max-bytes":5120},"error":{"$ref":"#/$defs/ErrorResponse"}},"required":["node_id","state"]};

function validate68(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate68.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.code === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "code"},message:"must have required property '"+"code"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.message === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "message"},message:"must have required property '"+"message"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "code") || (key0 === "message")) || (key0 === "operation_id"))){
const err2 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.code !== undefined){
let data0 = data.code;
if(typeof data0 !== "string"){
const err3 = {instancePath:instancePath+"/code",schemaPath:"#/$defs/ErrorCode/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!(((((((((((((((data0 === "profile_disabled") || (data0 === "service_unavailable")) || (data0 === "unauthorized")) || (data0 === "session_expired")) || (data0 === "resource_not_found")) || (data0 === "revision_conflict")) || (data0 === "operation_conflict")) || (data0 === "invalid_draft")) || (data0 === "input_too_large")) || (data0 === "run_busy")) || (data0 === "operation_unknown")) || (data0 === "protocol_mismatch")) || (data0 === "invalid_request")) || (data0 === "storage_unavailable")) || (data0 === "internal_error"))){
const err4 = {instancePath:instancePath+"/code",schemaPath:"#/$defs/ErrorCode/enum",keyword:"enum",params:{allowedValues: schema41.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.message !== undefined){
let data1 = data.message;
if(typeof data1 === "string"){
if(func1(data1) > 160){
const err5 = {instancePath:instancePath+"/message",schemaPath:"#/properties/message/maxLength",keyword:"maxLength",params:{limit: 160},message:"must NOT have more than 160 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
else {
const err6 = {instancePath:instancePath+"/message",schemaPath:"#/properties/message/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.operation_id !== undefined){
let data2 = data.operation_id;
if(typeof data2 === "string"){
if(func1(data2) > 36){
const err7 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/maxLength",keyword:"maxLength",params:{limit: 36},message:"must NOT have more than 36 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(func1(data2) < 36){
const err8 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/minLength",keyword:"minLength",params:{limit: 36},message:"must NOT have fewer than 36 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(!pattern5.test(data2)){
const err9 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/pattern",keyword:"pattern",params:{pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},message:"must match pattern \""+"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"+"\""};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
else {
const err10 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
}
else {
const err11 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
validate68.errors = vErrors;
return errors === 0;
}
validate68.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate67(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate67.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.node_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "node_id"},message:"must have required property '"+"node_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.state === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "state"},message:"must have required property '"+"state"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "node_id") || (key0 === "state")) || (key0 === "output")) || (key0 === "error"))){
const err2 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.node_id !== undefined){
let data0 = data.node_id;
if(typeof data0 === "string"){
if(func1(data0) > 64){
const err3 = {instancePath:instancePath+"/node_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(func1(data0) < 1){
const err4 = {instancePath:instancePath+"/node_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(!pattern4.test(data0)){
const err5 = {instancePath:instancePath+"/node_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
else {
const err6 = {instancePath:instancePath+"/node_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.state !== undefined){
let data1 = data.state;
if(typeof data1 === "string"){
if(func1(data1) > 64){
const err7 = {instancePath:instancePath+"/state",schemaPath:"#/properties/state/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
else {
const err8 = {instancePath:instancePath+"/state",schemaPath:"#/properties/state/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.output !== undefined){
let data2 = data.output;
if(typeof data2 === "string"){
if(func1(data2) > 5120){
const err9 = {instancePath:instancePath+"/output",schemaPath:"#/properties/output/maxLength",keyword:"maxLength",params:{limit: 5120},message:"must NOT have more than 5120 characters"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(new TextEncoder().encode(data2).length > 5120){
const err10 = {instancePath:instancePath+"/output",schemaPath:"#/properties/output/x-utf8-max-bytes",keyword:"x-utf8-max-bytes",params:{},message:"must pass \"x-utf8-max-bytes\" keyword validation"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
else {
const err11 = {instancePath:instancePath+"/output",schemaPath:"#/properties/output/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.error !== undefined){
if(!(validate68(data.error, {instancePath:instancePath+"/error",parentData:data,parentDataProperty:"error",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate68.errors : vErrors.concat(validate68.errors);
errors = vErrors.length;
}
}
}
else {
const err12 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
validate67.errors = vErrors;
return errors === 0;
}
validate67.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate66(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/NodeResult" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate66.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(!(validate67(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate67.errors : vErrors.concat(validate67.errors);
errors = vErrors.length;
}
validate66.errors = vErrors;
return errors === 0;
}
validate66.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const v_Run = validate71;
const schema110 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/Run","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/Run"};
const schema111 = {"type":"object","additionalProperties":false,"properties":{"run_id":{"$ref":"#/$defs/Identifier"},"workflow_id":{"$ref":"#/$defs/Identifier"},"operation_id":{"$ref":"#/$defs/OperationId"},"mode":{"$ref":"#/$defs/RunMode"},"revision":{"$ref":"#/$defs/Identifier"},"version":{"$ref":"#/$defs/Version"},"state":{"type":"string","maxLength":64,"description":"Actual engine status; new values stay visible and never imply success."},"terminal":{"type":"boolean"},"input":{"$ref":"#/$defs/TextInput"},"output":{"type":"string","maxLength":5120,"x-utf8-max-bytes":5120},"nodes":{"type":"array","items":{"$ref":"#/$defs/NodeResult"},"maxItems":3},"started_at_ms":{"type":"integer","minimum":0},"finished_at_ms":{"type":"integer","minimum":0},"error":{"$ref":"#/$defs/ErrorResponse"}},"required":["run_id","workflow_id","operation_id","mode","state","terminal","started_at_ms"]};
const func82 = Object.prototype.hasOwnProperty;

function validate73(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate73.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.node_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "node_id"},message:"must have required property '"+"node_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.state === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "state"},message:"must have required property '"+"state"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "node_id") || (key0 === "state")) || (key0 === "output")) || (key0 === "error"))){
const err2 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.node_id !== undefined){
let data0 = data.node_id;
if(typeof data0 === "string"){
if(func1(data0) > 64){
const err3 = {instancePath:instancePath+"/node_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(func1(data0) < 1){
const err4 = {instancePath:instancePath+"/node_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(!pattern4.test(data0)){
const err5 = {instancePath:instancePath+"/node_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
else {
const err6 = {instancePath:instancePath+"/node_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.state !== undefined){
let data1 = data.state;
if(typeof data1 === "string"){
if(func1(data1) > 64){
const err7 = {instancePath:instancePath+"/state",schemaPath:"#/properties/state/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
else {
const err8 = {instancePath:instancePath+"/state",schemaPath:"#/properties/state/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.output !== undefined){
let data2 = data.output;
if(typeof data2 === "string"){
if(func1(data2) > 5120){
const err9 = {instancePath:instancePath+"/output",schemaPath:"#/properties/output/maxLength",keyword:"maxLength",params:{limit: 5120},message:"must NOT have more than 5120 characters"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(new TextEncoder().encode(data2).length > 5120){
const err10 = {instancePath:instancePath+"/output",schemaPath:"#/properties/output/x-utf8-max-bytes",keyword:"x-utf8-max-bytes",params:{},message:"must pass \"x-utf8-max-bytes\" keyword validation"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
else {
const err11 = {instancePath:instancePath+"/output",schemaPath:"#/properties/output/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.error !== undefined){
if(!(validate68(data.error, {instancePath:instancePath+"/error",parentData:data,parentDataProperty:"error",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate68.errors : vErrors.concat(validate68.errors);
errors = vErrors.length;
}
}
}
else {
const err12 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
validate73.errors = vErrors;
return errors === 0;
}
validate73.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate72(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate72.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.run_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "run_id"},message:"must have required property '"+"run_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.workflow_id === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "workflow_id"},message:"must have required property '"+"workflow_id"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.operation_id === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "operation_id"},message:"must have required property '"+"operation_id"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.mode === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "mode"},message:"must have required property '"+"mode"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.state === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "state"},message:"must have required property '"+"state"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.terminal === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "terminal"},message:"must have required property '"+"terminal"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.started_at_ms === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "started_at_ms"},message:"must have required property '"+"started_at_ms"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
for(const key0 in data){
if(!(func82.call(schema111.properties, key0))){
const err7 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.run_id !== undefined){
let data0 = data.run_id;
if(typeof data0 === "string"){
if(func1(data0) > 64){
const err8 = {instancePath:instancePath+"/run_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(func1(data0) < 1){
const err9 = {instancePath:instancePath+"/run_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(!pattern4.test(data0)){
const err10 = {instancePath:instancePath+"/run_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
else {
const err11 = {instancePath:instancePath+"/run_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.workflow_id !== undefined){
let data1 = data.workflow_id;
if(typeof data1 === "string"){
if(func1(data1) > 64){
const err12 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(func1(data1) < 1){
const err13 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(!pattern4.test(data1)){
const err14 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
else {
const err15 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data.operation_id !== undefined){
let data2 = data.operation_id;
if(typeof data2 === "string"){
if(func1(data2) > 36){
const err16 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/maxLength",keyword:"maxLength",params:{limit: 36},message:"must NOT have more than 36 characters"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(func1(data2) < 36){
const err17 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/minLength",keyword:"minLength",params:{limit: 36},message:"must NOT have fewer than 36 characters"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(!pattern5.test(data2)){
const err18 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/pattern",keyword:"pattern",params:{pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},message:"must match pattern \""+"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"+"\""};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
else {
const err19 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data.mode !== undefined){
let data3 = data.mode;
if(typeof data3 !== "string"){
const err20 = {instancePath:instancePath+"/mode",schemaPath:"#/$defs/RunMode/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(!((data3 === "debug") || (data3 === "release"))){
const err21 = {instancePath:instancePath+"/mode",schemaPath:"#/$defs/RunMode/enum",keyword:"enum",params:{allowedValues: schema103.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data.revision !== undefined){
let data4 = data.revision;
if(typeof data4 === "string"){
if(func1(data4) > 64){
const err22 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
if(func1(data4) < 1){
const err23 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if(!pattern4.test(data4)){
const err24 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
else {
const err25 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data.version !== undefined){
let data5 = data.version;
if(typeof data5 === "string"){
if(func1(data5) > 32){
const err26 = {instancePath:instancePath+"/version",schemaPath:"#/$defs/Version/maxLength",keyword:"maxLength",params:{limit: 32},message:"must NOT have more than 32 characters"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
if(!pattern6.test(data5)){
const err27 = {instancePath:instancePath+"/version",schemaPath:"#/$defs/Version/pattern",keyword:"pattern",params:{pattern: "^v0[.]0[.][1-9][0-9]*$"},message:"must match pattern \""+"^v0[.]0[.][1-9][0-9]*$"+"\""};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
else {
const err28 = {instancePath:instancePath+"/version",schemaPath:"#/$defs/Version/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
if(data.state !== undefined){
let data6 = data.state;
if(typeof data6 === "string"){
if(func1(data6) > 64){
const err29 = {instancePath:instancePath+"/state",schemaPath:"#/properties/state/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
else {
const err30 = {instancePath:instancePath+"/state",schemaPath:"#/properties/state/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
if(data.terminal !== undefined){
if(typeof data.terminal !== "boolean"){
const err31 = {instancePath:instancePath+"/terminal",schemaPath:"#/properties/terminal/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
}
if(data.input !== undefined){
let data8 = data.input;
if(data8 && typeof data8 == "object" && !Array.isArray(data8)){
if(data8.input === undefined){
const err32 = {instancePath:instancePath+"/input",schemaPath:"#/$defs/TextInput/required",keyword:"required",params:{missingProperty: "input"},message:"must have required property '"+"input"+"'"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
for(const key1 in data8){
if(!(key1 === "input")){
const err33 = {instancePath:instancePath+"/input",schemaPath:"#/$defs/TextInput/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
}
if(data8.input !== undefined){
let data9 = data8.input;
if(typeof data9 === "string"){
if(func1(data9) > 4096){
const err34 = {instancePath:instancePath+"/input/input",schemaPath:"#/$defs/TextInput/properties/input/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
if(new TextEncoder().encode(data9).length > 4096){
const err35 = {instancePath:instancePath+"/input/input",schemaPath:"#/$defs/TextInput/properties/input/x-utf8-max-bytes",keyword:"x-utf8-max-bytes",params:{},message:"must pass \"x-utf8-max-bytes\" keyword validation"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
}
else {
const err36 = {instancePath:instancePath+"/input/input",schemaPath:"#/$defs/TextInput/properties/input/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
}
}
else {
const err37 = {instancePath:instancePath+"/input",schemaPath:"#/$defs/TextInput/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
}
if(data.output !== undefined){
let data10 = data.output;
if(typeof data10 === "string"){
if(func1(data10) > 5120){
const err38 = {instancePath:instancePath+"/output",schemaPath:"#/properties/output/maxLength",keyword:"maxLength",params:{limit: 5120},message:"must NOT have more than 5120 characters"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
if(new TextEncoder().encode(data10).length > 5120){
const err39 = {instancePath:instancePath+"/output",schemaPath:"#/properties/output/x-utf8-max-bytes",keyword:"x-utf8-max-bytes",params:{},message:"must pass \"x-utf8-max-bytes\" keyword validation"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
}
else {
const err40 = {instancePath:instancePath+"/output",schemaPath:"#/properties/output/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
}
if(data.nodes !== undefined){
let data11 = data.nodes;
if(Array.isArray(data11)){
if(data11.length > 3){
const err41 = {instancePath:instancePath+"/nodes",schemaPath:"#/properties/nodes/maxItems",keyword:"maxItems",params:{limit: 3},message:"must NOT have more than 3 items"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
const len0 = data11.length;
for(let i0=0; i0<len0; i0++){
if(!(validate73(data11[i0], {instancePath:instancePath+"/nodes/" + i0,parentData:data11,parentDataProperty:i0,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate73.errors : vErrors.concat(validate73.errors);
errors = vErrors.length;
}
}
}
else {
const err42 = {instancePath:instancePath+"/nodes",schemaPath:"#/properties/nodes/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
}
if(data.started_at_ms !== undefined){
let data13 = data.started_at_ms;
if(!(((typeof data13 == "number") && (!(data13 % 1) && !isNaN(data13))) && (isFinite(data13)))){
const err43 = {instancePath:instancePath+"/started_at_ms",schemaPath:"#/properties/started_at_ms/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
if((typeof data13 == "number") && (isFinite(data13))){
if(data13 < 0 || isNaN(data13)){
const err44 = {instancePath:instancePath+"/started_at_ms",schemaPath:"#/properties/started_at_ms/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
}
}
}
if(data.finished_at_ms !== undefined){
let data14 = data.finished_at_ms;
if(!(((typeof data14 == "number") && (!(data14 % 1) && !isNaN(data14))) && (isFinite(data14)))){
const err45 = {instancePath:instancePath+"/finished_at_ms",schemaPath:"#/properties/finished_at_ms/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
if((typeof data14 == "number") && (isFinite(data14))){
if(data14 < 0 || isNaN(data14)){
const err46 = {instancePath:instancePath+"/finished_at_ms",schemaPath:"#/properties/finished_at_ms/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err46];
}
else {
vErrors.push(err46);
}
errors++;
}
}
}
if(data.error !== undefined){
if(!(validate68(data.error, {instancePath:instancePath+"/error",parentData:data,parentDataProperty:"error",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate68.errors : vErrors.concat(validate68.errors);
errors = vErrors.length;
}
}
}
else {
const err47 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err47];
}
else {
vErrors.push(err47);
}
errors++;
}
validate72.errors = vErrors;
return errors === 0;
}
validate72.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate71(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/Run" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate71.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(!(validate72(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate72.errors : vErrors.concat(validate72.errors);
errors = vErrors.length;
}
validate71.errors = vErrors;
return errors === 0;
}
validate71.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const v_RunList = validate78;
const schema121 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/RunList","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/RunList"};
const schema122 = {"type":"object","additionalProperties":false,"properties":{"items":{"type":"array","items":{"$ref":"#/$defs/RunSummary"},"maxItems":50},"next_cursor":{"type":"string","maxLength":256}},"required":["items"]};
const schema123 = {"type":"object","additionalProperties":false,"properties":{"run_id":{"$ref":"#/$defs/Identifier"},"workflow_id":{"$ref":"#/$defs/Identifier"},"operation_id":{"$ref":"#/$defs/OperationId"},"mode":{"$ref":"#/$defs/RunMode"},"revision":{"$ref":"#/$defs/Identifier"},"version":{"$ref":"#/$defs/Version"},"state":{"type":"string","maxLength":64,"description":"Actual engine status; new values stay visible and never imply success."},"terminal":{"type":"boolean"},"started_at_ms":{"type":"integer","minimum":0},"finished_at_ms":{"type":"integer","minimum":0},"error":{"$ref":"#/$defs/ErrorResponse"}},"required":["run_id","workflow_id","operation_id","mode","state","terminal","started_at_ms"],"description":"Bounded list summary; read the detail endpoint for full content."};

function validate80(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate80.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.run_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "run_id"},message:"must have required property '"+"run_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.workflow_id === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "workflow_id"},message:"must have required property '"+"workflow_id"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.operation_id === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "operation_id"},message:"must have required property '"+"operation_id"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.mode === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "mode"},message:"must have required property '"+"mode"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.state === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "state"},message:"must have required property '"+"state"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.terminal === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "terminal"},message:"must have required property '"+"terminal"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.started_at_ms === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "started_at_ms"},message:"must have required property '"+"started_at_ms"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
for(const key0 in data){
if(!(func82.call(schema123.properties, key0))){
const err7 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.run_id !== undefined){
let data0 = data.run_id;
if(typeof data0 === "string"){
if(func1(data0) > 64){
const err8 = {instancePath:instancePath+"/run_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(func1(data0) < 1){
const err9 = {instancePath:instancePath+"/run_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(!pattern4.test(data0)){
const err10 = {instancePath:instancePath+"/run_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
else {
const err11 = {instancePath:instancePath+"/run_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.workflow_id !== undefined){
let data1 = data.workflow_id;
if(typeof data1 === "string"){
if(func1(data1) > 64){
const err12 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(func1(data1) < 1){
const err13 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(!pattern4.test(data1)){
const err14 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
else {
const err15 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data.operation_id !== undefined){
let data2 = data.operation_id;
if(typeof data2 === "string"){
if(func1(data2) > 36){
const err16 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/maxLength",keyword:"maxLength",params:{limit: 36},message:"must NOT have more than 36 characters"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(func1(data2) < 36){
const err17 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/minLength",keyword:"minLength",params:{limit: 36},message:"must NOT have fewer than 36 characters"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(!pattern5.test(data2)){
const err18 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/pattern",keyword:"pattern",params:{pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},message:"must match pattern \""+"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"+"\""};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
else {
const err19 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data.mode !== undefined){
let data3 = data.mode;
if(typeof data3 !== "string"){
const err20 = {instancePath:instancePath+"/mode",schemaPath:"#/$defs/RunMode/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(!((data3 === "debug") || (data3 === "release"))){
const err21 = {instancePath:instancePath+"/mode",schemaPath:"#/$defs/RunMode/enum",keyword:"enum",params:{allowedValues: schema103.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data.revision !== undefined){
let data4 = data.revision;
if(typeof data4 === "string"){
if(func1(data4) > 64){
const err22 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
if(func1(data4) < 1){
const err23 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if(!pattern4.test(data4)){
const err24 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
else {
const err25 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data.version !== undefined){
let data5 = data.version;
if(typeof data5 === "string"){
if(func1(data5) > 32){
const err26 = {instancePath:instancePath+"/version",schemaPath:"#/$defs/Version/maxLength",keyword:"maxLength",params:{limit: 32},message:"must NOT have more than 32 characters"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
if(!pattern6.test(data5)){
const err27 = {instancePath:instancePath+"/version",schemaPath:"#/$defs/Version/pattern",keyword:"pattern",params:{pattern: "^v0[.]0[.][1-9][0-9]*$"},message:"must match pattern \""+"^v0[.]0[.][1-9][0-9]*$"+"\""};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
else {
const err28 = {instancePath:instancePath+"/version",schemaPath:"#/$defs/Version/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
if(data.state !== undefined){
let data6 = data.state;
if(typeof data6 === "string"){
if(func1(data6) > 64){
const err29 = {instancePath:instancePath+"/state",schemaPath:"#/properties/state/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
else {
const err30 = {instancePath:instancePath+"/state",schemaPath:"#/properties/state/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
if(data.terminal !== undefined){
if(typeof data.terminal !== "boolean"){
const err31 = {instancePath:instancePath+"/terminal",schemaPath:"#/properties/terminal/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
}
if(data.started_at_ms !== undefined){
let data8 = data.started_at_ms;
if(!(((typeof data8 == "number") && (!(data8 % 1) && !isNaN(data8))) && (isFinite(data8)))){
const err32 = {instancePath:instancePath+"/started_at_ms",schemaPath:"#/properties/started_at_ms/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
if((typeof data8 == "number") && (isFinite(data8))){
if(data8 < 0 || isNaN(data8)){
const err33 = {instancePath:instancePath+"/started_at_ms",schemaPath:"#/properties/started_at_ms/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
}
}
if(data.finished_at_ms !== undefined){
let data9 = data.finished_at_ms;
if(!(((typeof data9 == "number") && (!(data9 % 1) && !isNaN(data9))) && (isFinite(data9)))){
const err34 = {instancePath:instancePath+"/finished_at_ms",schemaPath:"#/properties/finished_at_ms/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
if((typeof data9 == "number") && (isFinite(data9))){
if(data9 < 0 || isNaN(data9)){
const err35 = {instancePath:instancePath+"/finished_at_ms",schemaPath:"#/properties/finished_at_ms/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
}
}
if(data.error !== undefined){
if(!(validate68(data.error, {instancePath:instancePath+"/error",parentData:data,parentDataProperty:"error",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate68.errors : vErrors.concat(validate68.errors);
errors = vErrors.length;
}
}
}
else {
const err36 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
validate80.errors = vErrors;
return errors === 0;
}
validate80.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate79(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate79.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.items === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "items"},message:"must have required property '"+"items"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!((key0 === "items") || (key0 === "next_cursor"))){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.items !== undefined){
let data0 = data.items;
if(Array.isArray(data0)){
if(data0.length > 50){
const err2 = {instancePath:instancePath+"/items",schemaPath:"#/properties/items/maxItems",keyword:"maxItems",params:{limit: 50},message:"must NOT have more than 50 items"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
const len0 = data0.length;
for(let i0=0; i0<len0; i0++){
if(!(validate80(data0[i0], {instancePath:instancePath+"/items/" + i0,parentData:data0,parentDataProperty:i0,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate80.errors : vErrors.concat(validate80.errors);
errors = vErrors.length;
}
}
}
else {
const err3 = {instancePath:instancePath+"/items",schemaPath:"#/properties/items/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.next_cursor !== undefined){
let data2 = data.next_cursor;
if(typeof data2 === "string"){
if(func1(data2) > 256){
const err4 = {instancePath:instancePath+"/next_cursor",schemaPath:"#/properties/next_cursor/maxLength",keyword:"maxLength",params:{limit: 256},message:"must NOT have more than 256 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
else {
const err5 = {instancePath:instancePath+"/next_cursor",schemaPath:"#/properties/next_cursor/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
}
else {
const err6 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
validate79.errors = vErrors;
return errors === 0;
}
validate79.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate78(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/RunList" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate78.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(!(validate79(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate79.errors : vErrors.concat(validate79.errors);
errors = vErrors.length;
}
validate78.errors = vErrors;
return errors === 0;
}
validate78.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const v_OperationKind = validate84;
const schema130 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/OperationKind","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/OperationKind"};
const schema131 = {"type":"string","enum":["create","save","test","publish","run"]};

function validate84(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/OperationKind" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate84.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(typeof data !== "string"){
const err0 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/OperationKind/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(!(((((data === "create") || (data === "save")) || (data === "test")) || (data === "publish")) || (data === "run"))){
const err1 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/OperationKind/enum",keyword:"enum",params:{allowedValues: schema131.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate84.errors = vErrors;
return errors === 0;
}
validate84.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const v_OperationPhase = validate85;
const schema132 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/OperationPhase","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/OperationPhase"};
const schema133 = {"type":"string","enum":["recorded","completed","unknown","rejected"]};

function validate85(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/OperationPhase" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate85.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(typeof data !== "string"){
const err0 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/OperationPhase/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(!((((data === "recorded") || (data === "completed")) || (data === "unknown")) || (data === "rejected"))){
const err1 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/OperationPhase/enum",keyword:"enum",params:{allowedValues: schema133.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate85.errors = vErrors;
return errors === 0;
}
validate85.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const v_OperationReceipt = validate86;
const schema134 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/OperationReceipt","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/OperationReceipt"};
const schema135 = {"type":"object","additionalProperties":false,"properties":{"operation_id":{"$ref":"#/$defs/OperationId"},"kind":{"$ref":"#/$defs/OperationKind"},"phase":{"$ref":"#/$defs/OperationPhase"},"workflow_id":{"$ref":"#/$defs/Identifier"},"revision":{"$ref":"#/$defs/Identifier"},"version":{"$ref":"#/$defs/Version","description":"Version registered by this operation: the newly committed version for publish, or the selected published version for a release run. Omitted for create, save, and debug test operations; never copies Workflow.published_version as ambient resource metadata."},"run_id":{"$ref":"#/$defs/Identifier"},"error":{"$ref":"#/$defs/ErrorResponse"}},"required":["operation_id","kind","phase"],"description":"Dispatch receipt, not engine status. completed identifies committed resource/execution registration, not successful workflow execution."};

function validate87(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate87.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.operation_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "operation_id"},message:"must have required property '"+"operation_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.kind === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.phase === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "phase"},message:"must have required property '"+"phase"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!((((((((key0 === "operation_id") || (key0 === "kind")) || (key0 === "phase")) || (key0 === "workflow_id")) || (key0 === "revision")) || (key0 === "version")) || (key0 === "run_id")) || (key0 === "error"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.operation_id !== undefined){
let data0 = data.operation_id;
if(typeof data0 === "string"){
if(func1(data0) > 36){
const err4 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/maxLength",keyword:"maxLength",params:{limit: 36},message:"must NOT have more than 36 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(func1(data0) < 36){
const err5 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/minLength",keyword:"minLength",params:{limit: 36},message:"must NOT have fewer than 36 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(!pattern5.test(data0)){
const err6 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/pattern",keyword:"pattern",params:{pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},message:"must match pattern \""+"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"+"\""};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
else {
const err7 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.kind !== undefined){
let data1 = data.kind;
if(typeof data1 !== "string"){
const err8 = {instancePath:instancePath+"/kind",schemaPath:"#/$defs/OperationKind/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(!(((((data1 === "create") || (data1 === "save")) || (data1 === "test")) || (data1 === "publish")) || (data1 === "run"))){
const err9 = {instancePath:instancePath+"/kind",schemaPath:"#/$defs/OperationKind/enum",keyword:"enum",params:{allowedValues: schema131.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.phase !== undefined){
let data2 = data.phase;
if(typeof data2 !== "string"){
const err10 = {instancePath:instancePath+"/phase",schemaPath:"#/$defs/OperationPhase/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(!((((data2 === "recorded") || (data2 === "completed")) || (data2 === "unknown")) || (data2 === "rejected"))){
const err11 = {instancePath:instancePath+"/phase",schemaPath:"#/$defs/OperationPhase/enum",keyword:"enum",params:{allowedValues: schema133.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.workflow_id !== undefined){
let data3 = data.workflow_id;
if(typeof data3 === "string"){
if(func1(data3) > 64){
const err12 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(func1(data3) < 1){
const err13 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(!pattern4.test(data3)){
const err14 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
else {
const err15 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data.revision !== undefined){
let data4 = data.revision;
if(typeof data4 === "string"){
if(func1(data4) > 64){
const err16 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(func1(data4) < 1){
const err17 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(!pattern4.test(data4)){
const err18 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
else {
const err19 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data.version !== undefined){
let data5 = data.version;
if(typeof data5 === "string"){
if(func1(data5) > 32){
const err20 = {instancePath:instancePath+"/version",schemaPath:"#/$defs/Version/maxLength",keyword:"maxLength",params:{limit: 32},message:"must NOT have more than 32 characters"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(!pattern6.test(data5)){
const err21 = {instancePath:instancePath+"/version",schemaPath:"#/$defs/Version/pattern",keyword:"pattern",params:{pattern: "^v0[.]0[.][1-9][0-9]*$"},message:"must match pattern \""+"^v0[.]0[.][1-9][0-9]*$"+"\""};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
else {
const err22 = {instancePath:instancePath+"/version",schemaPath:"#/$defs/Version/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data.run_id !== undefined){
let data6 = data.run_id;
if(typeof data6 === "string"){
if(func1(data6) > 64){
const err23 = {instancePath:instancePath+"/run_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if(func1(data6) < 1){
const err24 = {instancePath:instancePath+"/run_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
if(!pattern4.test(data6)){
const err25 = {instancePath:instancePath+"/run_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
else {
const err26 = {instancePath:instancePath+"/run_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
if(data.error !== undefined){
if(!(validate68(data.error, {instancePath:instancePath+"/error",parentData:data,parentDataProperty:"error",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate68.errors : vErrors.concat(validate68.errors);
errors = vErrors.length;
}
}
}
else {
const err27 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
validate87.errors = vErrors;
return errors === 0;
}
validate87.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate86(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/OperationReceipt" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate86.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(!(validate87(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate87.errors : vErrors.concat(validate87.errors);
errors = vErrors.length;
}
validate86.errors = vErrors;
return errors === 0;
}
validate86.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const v_EditorOpenRequest = validate90;
const schema143 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/EditorOpenRequest","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/EditorOpenRequest"};
const schema144 = {"type":"object","additionalProperties":false,"properties":{"workflow_id":{"$ref":"#/$defs/Identifier"}},"required":["workflow_id"]};

function validate91(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate91.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.workflow_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "workflow_id"},message:"must have required property '"+"workflow_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "workflow_id")){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.workflow_id !== undefined){
let data0 = data.workflow_id;
if(typeof data0 === "string"){
if(func1(data0) > 64){
const err2 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func1(data0) < 1){
const err3 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern4.test(data0)){
const err4 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
else {
const err5 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
}
else {
const err6 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
validate91.errors = vErrors;
return errors === 0;
}
validate91.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate90(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/EditorOpenRequest" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate90.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(!(validate91(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate91.errors : vErrors.concat(validate91.errors);
errors = vErrors.length;
}
validate90.errors = vErrors;
return errors === 0;
}
validate90.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const v_EditorSessionSecret = validate93;
const schema146 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/EditorSessionSecret","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/EditorSessionSecret"};
const schema147 = {"type":"object","additionalProperties":false,"properties":{"session_id":{"$ref":"#/$defs/Identifier"},"workflow_id":{"$ref":"#/$defs/Identifier"},"secret":{"type":"string","maxLength":64,"minLength":64,"pattern":"^[0-9a-f]{64}$","description":"Native/API only. Never serialize this response to renderer, URL, log or MessageChannel."},"run_epoch":{"$ref":"#/$defs/RunEpoch"},"expires_at_ms":{"type":"integer","minimum":0}},"required":["session_id","workflow_id","secret","run_epoch","expires_at_ms"]};
const pattern53 = new RegExp("^[0-9a-f]{64}$", "u");

function validate94(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate94.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.session_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "session_id"},message:"must have required property '"+"session_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.workflow_id === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "workflow_id"},message:"must have required property '"+"workflow_id"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.secret === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "secret"},message:"must have required property '"+"secret"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.run_epoch === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "run_epoch"},message:"must have required property '"+"run_epoch"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.expires_at_ms === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "expires_at_ms"},message:"must have required property '"+"expires_at_ms"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
for(const key0 in data){
if(!(((((key0 === "session_id") || (key0 === "workflow_id")) || (key0 === "secret")) || (key0 === "run_epoch")) || (key0 === "expires_at_ms"))){
const err5 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.session_id !== undefined){
let data0 = data.session_id;
if(typeof data0 === "string"){
if(func1(data0) > 64){
const err6 = {instancePath:instancePath+"/session_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(func1(data0) < 1){
const err7 = {instancePath:instancePath+"/session_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(!pattern4.test(data0)){
const err8 = {instancePath:instancePath+"/session_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
else {
const err9 = {instancePath:instancePath+"/session_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.workflow_id !== undefined){
let data1 = data.workflow_id;
if(typeof data1 === "string"){
if(func1(data1) > 64){
const err10 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(func1(data1) < 1){
const err11 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(!pattern4.test(data1)){
const err12 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
else {
const err13 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data.secret !== undefined){
let data2 = data.secret;
if(typeof data2 === "string"){
if(func1(data2) > 64){
const err14 = {instancePath:instancePath+"/secret",schemaPath:"#/properties/secret/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(func1(data2) < 64){
const err15 = {instancePath:instancePath+"/secret",schemaPath:"#/properties/secret/minLength",keyword:"minLength",params:{limit: 64},message:"must NOT have fewer than 64 characters"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(!pattern53.test(data2)){
const err16 = {instancePath:instancePath+"/secret",schemaPath:"#/properties/secret/pattern",keyword:"pattern",params:{pattern: "^[0-9a-f]{64}$"},message:"must match pattern \""+"^[0-9a-f]{64}$"+"\""};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
else {
const err17 = {instancePath:instancePath+"/secret",schemaPath:"#/properties/secret/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data.run_epoch !== undefined){
let data3 = data.run_epoch;
if(typeof data3 === "string"){
if(func1(data3) > 36){
const err18 = {instancePath:instancePath+"/run_epoch",schemaPath:"#/$defs/RunEpoch/maxLength",keyword:"maxLength",params:{limit: 36},message:"must NOT have more than 36 characters"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(func1(data3) < 36){
const err19 = {instancePath:instancePath+"/run_epoch",schemaPath:"#/$defs/RunEpoch/minLength",keyword:"minLength",params:{limit: 36},message:"must NOT have fewer than 36 characters"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
if(!pattern5.test(data3)){
const err20 = {instancePath:instancePath+"/run_epoch",schemaPath:"#/$defs/RunEpoch/pattern",keyword:"pattern",params:{pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},message:"must match pattern \""+"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"+"\""};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
else {
const err21 = {instancePath:instancePath+"/run_epoch",schemaPath:"#/$defs/RunEpoch/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data.expires_at_ms !== undefined){
let data4 = data.expires_at_ms;
if(!(((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4))) && (isFinite(data4)))){
const err22 = {instancePath:instancePath+"/expires_at_ms",schemaPath:"#/properties/expires_at_ms/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
if((typeof data4 == "number") && (isFinite(data4))){
if(data4 < 0 || isNaN(data4)){
const err23 = {instancePath:instancePath+"/expires_at_ms",schemaPath:"#/properties/expires_at_ms/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
}
}
else {
const err24 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
validate94.errors = vErrors;
return errors === 0;
}
validate94.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate93(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/EditorSessionSecret" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate93.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(!(validate94(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate94.errors : vErrors.concat(validate94.errors);
errors = vErrors.length;
}
validate93.errors = vErrors;
return errors === 0;
}
validate93.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const v_EditorOpenedView = validate96;
const schema151 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/EditorOpenedView","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/EditorOpenedView"};
const schema152 = {"type":"object","additionalProperties":false,"properties":{"bridge_id":{"$ref":"#/$defs/Identifier"},"workflow":{"$ref":"#/$defs/Workflow"},"generation":{"type":"integer","minimum":1},"expires_at_ms":{"type":"integer","minimum":0},"protocol_version":{"type":"integer","enum":[1]}},"required":["bridge_id","workflow","generation","expires_at_ms","protocol_version"]};

function validate98(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate98.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.workflow_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "workflow_id"},message:"must have required property '"+"workflow_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.name === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "name"},message:"must have required property '"+"name"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.revision === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "revision"},message:"must have required property '"+"revision"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.canvas === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "canvas"},message:"must have required property '"+"canvas"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.runnable === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "runnable"},message:"must have required property '"+"runnable"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.updated_at_ms === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "updated_at_ms"},message:"must have required property '"+"updated_at_ms"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
for(const key0 in data){
if(!((((((((key0 === "workflow_id") || (key0 === "name")) || (key0 === "revision")) || (key0 === "canvas")) || (key0 === "runnable")) || (key0 === "published_version")) || (key0 === "updated_at_ms")) || (key0 === "description"))){
const err6 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.workflow_id !== undefined){
let data0 = data.workflow_id;
if(typeof data0 === "string"){
if(func1(data0) > 64){
const err7 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(func1(data0) < 1){
const err8 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(!pattern4.test(data0)){
const err9 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
else {
const err10 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.name !== undefined){
let data1 = data.name;
if(typeof data1 === "string"){
if(func1(data1) > 80){
const err11 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/maxLength",keyword:"maxLength",params:{limit: 80},message:"must NOT have more than 80 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(func1(data1) < 1){
const err12 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
else {
const err13 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data.revision !== undefined){
let data2 = data.revision;
if(typeof data2 === "string"){
if(func1(data2) > 64){
const err14 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(func1(data2) < 1){
const err15 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(!pattern4.test(data2)){
const err16 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
else {
const err17 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data.canvas !== undefined){
let data3 = data.canvas;
if(typeof data3 === "string"){
if(func1(data3) > 262144){
const err18 = {instancePath:instancePath+"/canvas",schemaPath:"#/properties/canvas/maxLength",keyword:"maxLength",params:{limit: 262144},message:"must NOT have more than 262144 characters"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(new TextEncoder().encode(data3).length > 262144){
const err19 = {instancePath:instancePath+"/canvas",schemaPath:"#/properties/canvas/x-utf8-max-bytes",keyword:"x-utf8-max-bytes",params:{},message:"must pass \"x-utf8-max-bytes\" keyword validation"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
else {
const err20 = {instancePath:instancePath+"/canvas",schemaPath:"#/properties/canvas/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
if(data.runnable !== undefined){
if(typeof data.runnable !== "boolean"){
const err21 = {instancePath:instancePath+"/runnable",schemaPath:"#/properties/runnable/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data.published_version !== undefined){
let data5 = data.published_version;
if(typeof data5 === "string"){
if(func1(data5) > 32){
const err22 = {instancePath:instancePath+"/published_version",schemaPath:"#/$defs/Version/maxLength",keyword:"maxLength",params:{limit: 32},message:"must NOT have more than 32 characters"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
if(!pattern6.test(data5)){
const err23 = {instancePath:instancePath+"/published_version",schemaPath:"#/$defs/Version/pattern",keyword:"pattern",params:{pattern: "^v0[.]0[.][1-9][0-9]*$"},message:"must match pattern \""+"^v0[.]0[.][1-9][0-9]*$"+"\""};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
else {
const err24 = {instancePath:instancePath+"/published_version",schemaPath:"#/$defs/Version/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
if(data.updated_at_ms !== undefined){
let data6 = data.updated_at_ms;
if(!(((typeof data6 == "number") && (!(data6 % 1) && !isNaN(data6))) && (isFinite(data6)))){
const err25 = {instancePath:instancePath+"/updated_at_ms",schemaPath:"#/properties/updated_at_ms/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
if((typeof data6 == "number") && (isFinite(data6))){
if(data6 < 0 || isNaN(data6)){
const err26 = {instancePath:instancePath+"/updated_at_ms",schemaPath:"#/properties/updated_at_ms/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
}
if(data.description !== undefined){
let data7 = data.description;
if(typeof data7 === "string"){
if(func1(data7) > 600){
const err27 = {instancePath:instancePath+"/description",schemaPath:"#/properties/description/maxLength",keyword:"maxLength",params:{limit: 600},message:"must NOT have more than 600 characters"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
else {
const err28 = {instancePath:instancePath+"/description",schemaPath:"#/properties/description/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
}
else {
const err29 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
validate98.errors = vErrors;
return errors === 0;
}
validate98.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate97(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate97.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.bridge_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "bridge_id"},message:"must have required property '"+"bridge_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.workflow === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "workflow"},message:"must have required property '"+"workflow"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.generation === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "generation"},message:"must have required property '"+"generation"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.expires_at_ms === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "expires_at_ms"},message:"must have required property '"+"expires_at_ms"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.protocol_version === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "protocol_version"},message:"must have required property '"+"protocol_version"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
for(const key0 in data){
if(!(((((key0 === "bridge_id") || (key0 === "workflow")) || (key0 === "generation")) || (key0 === "expires_at_ms")) || (key0 === "protocol_version"))){
const err5 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.bridge_id !== undefined){
let data0 = data.bridge_id;
if(typeof data0 === "string"){
if(func1(data0) > 64){
const err6 = {instancePath:instancePath+"/bridge_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(func1(data0) < 1){
const err7 = {instancePath:instancePath+"/bridge_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(!pattern4.test(data0)){
const err8 = {instancePath:instancePath+"/bridge_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
else {
const err9 = {instancePath:instancePath+"/bridge_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.workflow !== undefined){
if(!(validate98(data.workflow, {instancePath:instancePath+"/workflow",parentData:data,parentDataProperty:"workflow",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate98.errors : vErrors.concat(validate98.errors);
errors = vErrors.length;
}
}
if(data.generation !== undefined){
let data2 = data.generation;
if(!(((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2))) && (isFinite(data2)))){
const err10 = {instancePath:instancePath+"/generation",schemaPath:"#/properties/generation/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if((typeof data2 == "number") && (isFinite(data2))){
if(data2 < 1 || isNaN(data2)){
const err11 = {instancePath:instancePath+"/generation",schemaPath:"#/properties/generation/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
}
if(data.expires_at_ms !== undefined){
let data3 = data.expires_at_ms;
if(!(((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3))) && (isFinite(data3)))){
const err12 = {instancePath:instancePath+"/expires_at_ms",schemaPath:"#/properties/expires_at_ms/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if((typeof data3 == "number") && (isFinite(data3))){
if(data3 < 0 || isNaN(data3)){
const err13 = {instancePath:instancePath+"/expires_at_ms",schemaPath:"#/properties/expires_at_ms/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
}
if(data.protocol_version !== undefined){
let data4 = data.protocol_version;
if(!(((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4))) && (isFinite(data4)))){
const err14 = {instancePath:instancePath+"/protocol_version",schemaPath:"#/properties/protocol_version/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(!(data4 === 1)){
const err15 = {instancePath:instancePath+"/protocol_version",schemaPath:"#/properties/protocol_version/enum",keyword:"enum",params:{allowedValues: schema152.properties.protocol_version.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
}
else {
const err16 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
validate97.errors = vErrors;
return errors === 0;
}
validate97.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate96(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/EditorOpenedView" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate96.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(!(validate97(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate97.errors : vErrors.concat(validate97.errors);
errors = vErrors.length;
}
validate96.errors = vErrors;
return errors === 0;
}
validate96.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const v_Bootstrap = validate101;
const schema158 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/Bootstrap","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/Bootstrap"};
const schema159 = {"type":"object","additionalProperties":false,"properties":{"workflow":{"$ref":"#/$defs/Workflow"},"principal":{"$ref":"#/$defs/Principal"},"node_types":{"type":"array","items":{"type":"integer","enum":[1,15,2]},"maxItems":3},"limits":{"$ref":"#/$defs/Limits"}},"required":["workflow","principal","node_types","limits"]};

function validate104(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate104.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.owner_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "owner_id"},message:"must have required property '"+"owner_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.tenant_id === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "tenant_id"},message:"must have required property '"+"tenant_id"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.user_id === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "user_id"},message:"must have required property '"+"user_id"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.space_id === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "space_id"},message:"must have required property '"+"space_id"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "owner_id") || (key0 === "tenant_id")) || (key0 === "user_id")) || (key0 === "space_id"))){
const err4 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.owner_id !== undefined){
let data0 = data.owner_id;
if(typeof data0 === "string"){
if(func1(data0) > 64){
const err5 = {instancePath:instancePath+"/owner_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(func1(data0) < 1){
const err6 = {instancePath:instancePath+"/owner_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(!pattern4.test(data0)){
const err7 = {instancePath:instancePath+"/owner_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
else {
const err8 = {instancePath:instancePath+"/owner_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.tenant_id !== undefined){
let data1 = data.tenant_id;
if(typeof data1 === "string"){
if(func1(data1) > 64){
const err9 = {instancePath:instancePath+"/tenant_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(func1(data1) < 1){
const err10 = {instancePath:instancePath+"/tenant_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(!pattern4.test(data1)){
const err11 = {instancePath:instancePath+"/tenant_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
else {
const err12 = {instancePath:instancePath+"/tenant_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.user_id !== undefined){
let data2 = data.user_id;
if(typeof data2 === "string"){
if(func1(data2) > 64){
const err13 = {instancePath:instancePath+"/user_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(func1(data2) < 1){
const err14 = {instancePath:instancePath+"/user_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(!pattern4.test(data2)){
const err15 = {instancePath:instancePath+"/user_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
else {
const err16 = {instancePath:instancePath+"/user_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data.space_id !== undefined){
let data3 = data.space_id;
if(typeof data3 === "string"){
if(func1(data3) > 64){
const err17 = {instancePath:instancePath+"/space_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(func1(data3) < 1){
const err18 = {instancePath:instancePath+"/space_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(!pattern4.test(data3)){
const err19 = {instancePath:instancePath+"/space_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
else {
const err20 = {instancePath:instancePath+"/space_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
}
else {
const err21 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
validate104.errors = vErrors;
return errors === 0;
}
validate104.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate102(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate102.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.workflow === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "workflow"},message:"must have required property '"+"workflow"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.principal === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "principal"},message:"must have required property '"+"principal"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.node_types === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "node_types"},message:"must have required property '"+"node_types"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.limits === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "limits"},message:"must have required property '"+"limits"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "workflow") || (key0 === "principal")) || (key0 === "node_types")) || (key0 === "limits"))){
const err4 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.workflow !== undefined){
if(!(validate98(data.workflow, {instancePath:instancePath+"/workflow",parentData:data,parentDataProperty:"workflow",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate98.errors : vErrors.concat(validate98.errors);
errors = vErrors.length;
}
}
if(data.principal !== undefined){
if(!(validate104(data.principal, {instancePath:instancePath+"/principal",parentData:data,parentDataProperty:"principal",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate104.errors : vErrors.concat(validate104.errors);
errors = vErrors.length;
}
}
if(data.node_types !== undefined){
let data2 = data.node_types;
if(Array.isArray(data2)){
if(data2.length > 3){
const err5 = {instancePath:instancePath+"/node_types",schemaPath:"#/properties/node_types/maxItems",keyword:"maxItems",params:{limit: 3},message:"must NOT have more than 3 items"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
const len0 = data2.length;
for(let i0=0; i0<len0; i0++){
let data3 = data2[i0];
if(!(((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3))) && (isFinite(data3)))){
const err6 = {instancePath:instancePath+"/node_types/" + i0,schemaPath:"#/properties/node_types/items/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(!(((data3 === 1) || (data3 === 15)) || (data3 === 2))){
const err7 = {instancePath:instancePath+"/node_types/" + i0,schemaPath:"#/properties/node_types/items/enum",keyword:"enum",params:{allowedValues: schema159.properties.node_types.items.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
}
else {
const err8 = {instancePath:instancePath+"/node_types",schemaPath:"#/properties/node_types/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.limits !== undefined){
let data4 = data.limits;
if(data4 && typeof data4 == "object" && !Array.isArray(data4)){
if(data4.input_bytes === undefined){
const err9 = {instancePath:instancePath+"/limits",schemaPath:"#/$defs/Limits/required",keyword:"required",params:{missingProperty: "input_bytes"},message:"must have required property '"+"input_bytes"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data4.prefix_bytes === undefined){
const err10 = {instancePath:instancePath+"/limits",schemaPath:"#/$defs/Limits/required",keyword:"required",params:{missingProperty: "prefix_bytes"},message:"must have required property '"+"prefix_bytes"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data4.output_bytes === undefined){
const err11 = {instancePath:instancePath+"/limits",schemaPath:"#/$defs/Limits/required",keyword:"required",params:{missingProperty: "output_bytes"},message:"must have required property '"+"output_bytes"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(data4.canvas_bytes === undefined){
const err12 = {instancePath:instancePath+"/limits",schemaPath:"#/$defs/Limits/required",keyword:"required",params:{missingProperty: "canvas_bytes"},message:"must have required property '"+"canvas_bytes"+"'"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(data4.message_bytes === undefined){
const err13 = {instancePath:instancePath+"/limits",schemaPath:"#/$defs/Limits/required",keyword:"required",params:{missingProperty: "message_bytes"},message:"must have required property '"+"message_bytes"+"'"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(data4.max_active_runs === undefined){
const err14 = {instancePath:instancePath+"/limits",schemaPath:"#/$defs/Limits/required",keyword:"required",params:{missingProperty: "max_active_runs"},message:"must have required property '"+"max_active_runs"+"'"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(data4.execution_budget_seconds === undefined){
const err15 = {instancePath:instancePath+"/limits",schemaPath:"#/$defs/Limits/required",keyword:"required",params:{missingProperty: "execution_budget_seconds"},message:"must have required property '"+"execution_budget_seconds"+"'"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(data4.editor_ttl_seconds === undefined){
const err16 = {instancePath:instancePath+"/limits",schemaPath:"#/$defs/Limits/required",keyword:"required",params:{missingProperty: "editor_ttl_seconds"},message:"must have required property '"+"editor_ttl_seconds"+"'"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
for(const key1 in data4){
if(!((((((((key1 === "input_bytes") || (key1 === "prefix_bytes")) || (key1 === "output_bytes")) || (key1 === "canvas_bytes")) || (key1 === "message_bytes")) || (key1 === "max_active_runs")) || (key1 === "execution_budget_seconds")) || (key1 === "editor_ttl_seconds"))){
const err17 = {instancePath:instancePath+"/limits",schemaPath:"#/$defs/Limits/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data4.input_bytes !== undefined){
let data5 = data4.input_bytes;
if(!(((typeof data5 == "number") && (!(data5 % 1) && !isNaN(data5))) && (isFinite(data5)))){
const err18 = {instancePath:instancePath+"/limits/input_bytes",schemaPath:"#/$defs/Limits/properties/input_bytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(!(data5 === 4096)){
const err19 = {instancePath:instancePath+"/limits/input_bytes",schemaPath:"#/$defs/Limits/properties/input_bytes/enum",keyword:"enum",params:{allowedValues: schema47.properties.input_bytes.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data4.prefix_bytes !== undefined){
let data6 = data4.prefix_bytes;
if(!(((typeof data6 == "number") && (!(data6 % 1) && !isNaN(data6))) && (isFinite(data6)))){
const err20 = {instancePath:instancePath+"/limits/prefix_bytes",schemaPath:"#/$defs/Limits/properties/prefix_bytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(!(data6 === 1024)){
const err21 = {instancePath:instancePath+"/limits/prefix_bytes",schemaPath:"#/$defs/Limits/properties/prefix_bytes/enum",keyword:"enum",params:{allowedValues: schema47.properties.prefix_bytes.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data4.output_bytes !== undefined){
let data7 = data4.output_bytes;
if(!(((typeof data7 == "number") && (!(data7 % 1) && !isNaN(data7))) && (isFinite(data7)))){
const err22 = {instancePath:instancePath+"/limits/output_bytes",schemaPath:"#/$defs/Limits/properties/output_bytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
if(!(data7 === 5120)){
const err23 = {instancePath:instancePath+"/limits/output_bytes",schemaPath:"#/$defs/Limits/properties/output_bytes/enum",keyword:"enum",params:{allowedValues: schema47.properties.output_bytes.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
if(data4.canvas_bytes !== undefined){
let data8 = data4.canvas_bytes;
if(!(((typeof data8 == "number") && (!(data8 % 1) && !isNaN(data8))) && (isFinite(data8)))){
const err24 = {instancePath:instancePath+"/limits/canvas_bytes",schemaPath:"#/$defs/Limits/properties/canvas_bytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
if(!(data8 === 262144)){
const err25 = {instancePath:instancePath+"/limits/canvas_bytes",schemaPath:"#/$defs/Limits/properties/canvas_bytes/enum",keyword:"enum",params:{allowedValues: schema47.properties.canvas_bytes.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data4.message_bytes !== undefined){
let data9 = data4.message_bytes;
if(!(((typeof data9 == "number") && (!(data9 % 1) && !isNaN(data9))) && (isFinite(data9)))){
const err26 = {instancePath:instancePath+"/limits/message_bytes",schemaPath:"#/$defs/Limits/properties/message_bytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
if(!(data9 === 524288)){
const err27 = {instancePath:instancePath+"/limits/message_bytes",schemaPath:"#/$defs/Limits/properties/message_bytes/enum",keyword:"enum",params:{allowedValues: schema47.properties.message_bytes.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
if(data4.max_active_runs !== undefined){
let data10 = data4.max_active_runs;
if(!(((typeof data10 == "number") && (!(data10 % 1) && !isNaN(data10))) && (isFinite(data10)))){
const err28 = {instancePath:instancePath+"/limits/max_active_runs",schemaPath:"#/$defs/Limits/properties/max_active_runs/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
if(!(data10 === 1)){
const err29 = {instancePath:instancePath+"/limits/max_active_runs",schemaPath:"#/$defs/Limits/properties/max_active_runs/enum",keyword:"enum",params:{allowedValues: schema47.properties.max_active_runs.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
if(data4.execution_budget_seconds !== undefined){
let data11 = data4.execution_budget_seconds;
if(!(((typeof data11 == "number") && (!(data11 % 1) && !isNaN(data11))) && (isFinite(data11)))){
const err30 = {instancePath:instancePath+"/limits/execution_budget_seconds",schemaPath:"#/$defs/Limits/properties/execution_budget_seconds/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
if(!(data11 === 30)){
const err31 = {instancePath:instancePath+"/limits/execution_budget_seconds",schemaPath:"#/$defs/Limits/properties/execution_budget_seconds/enum",keyword:"enum",params:{allowedValues: schema47.properties.execution_budget_seconds.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
}
if(data4.editor_ttl_seconds !== undefined){
let data12 = data4.editor_ttl_seconds;
if(!(((typeof data12 == "number") && (!(data12 % 1) && !isNaN(data12))) && (isFinite(data12)))){
const err32 = {instancePath:instancePath+"/limits/editor_ttl_seconds",schemaPath:"#/$defs/Limits/properties/editor_ttl_seconds/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
if(!(data12 === 300)){
const err33 = {instancePath:instancePath+"/limits/editor_ttl_seconds",schemaPath:"#/$defs/Limits/properties/editor_ttl_seconds/enum",keyword:"enum",params:{allowedValues: schema47.properties.editor_ttl_seconds.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
}
}
else {
const err34 = {instancePath:instancePath+"/limits",schemaPath:"#/$defs/Limits/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
}
}
else {
const err35 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
validate102.errors = vErrors;
return errors === 0;
}
validate102.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate101(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/Bootstrap" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate101.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(!(validate102(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate102.errors : vErrors.concat(validate102.errors);
errors = vErrors.length;
}
validate101.errors = vErrors;
return errors === 0;
}
validate101.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const v_EditorOperation = validate107;
const schema166 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/EditorOperation","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/EditorOperation"};
const schema167 = {"type":"string","enum":["bootstrap","read_draft","save_draft","test_draft","publish_internal","read_run","read_operation"]};

function validate107(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/EditorOperation" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate107.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(typeof data !== "string"){
const err0 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/EditorOperation/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(!(((((((data === "bootstrap") || (data === "read_draft")) || (data === "save_draft")) || (data === "test_draft")) || (data === "publish_internal")) || (data === "read_run")) || (data === "read_operation"))){
const err1 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/EditorOperation/enum",keyword:"enum",params:{allowedValues: schema167.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate107.errors = vErrors;
return errors === 0;
}
validate107.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const v_EditorExchangeInput = validate108;
const schema168 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/EditorExchangeInput","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/EditorExchangeInput"};
const schema169 = {"type":"object","additionalProperties":false,"properties":{"bridge_id":{"$ref":"#/$defs/Identifier"},"generation":{"type":"integer","minimum":1},"protocol_version":{"type":"integer","enum":[1]},"request_id":{"$ref":"#/$defs/Identifier"},"operation":{"$ref":"#/$defs/EditorOperation"},"expected_revision":{"$ref":"#/$defs/Identifier"},"name":{"type":"string","maxLength":80,"minLength":1},"canvas":{"type":"string","maxLength":262144,"x-utf8-max-bytes":262144},"input":{"$ref":"#/$defs/TextInput"},"successful_test_run_id":{"$ref":"#/$defs/Identifier"},"run_id":{"$ref":"#/$defs/Identifier"},"operation_id":{"$ref":"#/$defs/OperationId"}},"required":["bridge_id","generation","protocol_version","request_id","operation"],"description":"Native generates write operation IDs. operation_id input is only a read_operation lookup. No actor, secret, URL, headers or arbitrary command.","x-operation-required":{"save_draft":["expected_revision","name","canvas"],"test_draft":["expected_revision","input"],"publish_internal":["expected_revision","successful_test_run_id"],"read_run":["run_id"],"read_operation":["operation_id"]},"x-operation-restrict-fields":true,"x-operation-optional":{},"allOf":[{"if":{"properties":{"operation":{"const":"bootstrap"}}},"then":{"required":[],"properties":{"expected_revision":false,"name":false,"canvas":false,"input":false,"successful_test_run_id":false,"run_id":false,"operation_id":false}}},{"if":{"properties":{"operation":{"const":"read_draft"}}},"then":{"required":[],"properties":{"expected_revision":false,"name":false,"canvas":false,"input":false,"successful_test_run_id":false,"run_id":false,"operation_id":false}}},{"if":{"properties":{"operation":{"const":"save_draft"}}},"then":{"required":["expected_revision","name","canvas"],"properties":{"input":false,"successful_test_run_id":false,"run_id":false,"operation_id":false}}},{"if":{"properties":{"operation":{"const":"test_draft"}}},"then":{"required":["expected_revision","input"],"properties":{"name":false,"canvas":false,"successful_test_run_id":false,"run_id":false,"operation_id":false}}},{"if":{"properties":{"operation":{"const":"publish_internal"}}},"then":{"required":["expected_revision","successful_test_run_id"],"properties":{"name":false,"canvas":false,"input":false,"run_id":false,"operation_id":false}}},{"if":{"properties":{"operation":{"const":"read_run"}}},"then":{"required":["run_id"],"properties":{"expected_revision":false,"name":false,"canvas":false,"input":false,"successful_test_run_id":false,"operation_id":false}}},{"if":{"properties":{"operation":{"const":"read_operation"}}},"then":{"required":["operation_id"],"properties":{"expected_revision":false,"name":false,"canvas":false,"input":false,"successful_test_run_id":false,"run_id":false}}}]};

function validate109(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate109.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
const _errs2 = errors;
let valid1 = true;
const _errs3 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.operation !== undefined){
if("bootstrap" !== data.operation){
const err0 = {};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
}
var _valid0 = _errs3 === errors;
errors = _errs2;
if(vErrors !== null){
if(_errs2){
vErrors.length = _errs2;
}
else {
vErrors = null;
}
}
if(_valid0){
const _errs5 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.expected_revision !== undefined){
const err1 = {instancePath:instancePath+"/expected_revision",schemaPath:"#/allOf/0/then/properties/expected_revision/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.name !== undefined){
const err2 = {instancePath:instancePath+"/name",schemaPath:"#/allOf/0/then/properties/name/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.canvas !== undefined){
const err3 = {instancePath:instancePath+"/canvas",schemaPath:"#/allOf/0/then/properties/canvas/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.input !== undefined){
const err4 = {instancePath:instancePath+"/input",schemaPath:"#/allOf/0/then/properties/input/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.successful_test_run_id !== undefined){
const err5 = {instancePath:instancePath+"/successful_test_run_id",schemaPath:"#/allOf/0/then/properties/successful_test_run_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.run_id !== undefined){
const err6 = {instancePath:instancePath+"/run_id",schemaPath:"#/allOf/0/then/properties/run_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data.operation_id !== undefined){
const err7 = {instancePath:instancePath+"/operation_id",schemaPath:"#/allOf/0/then/properties/operation_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
var _valid0 = _errs5 === errors;
valid1 = _valid0;
if(valid1){
var props0 = {};
props0.expected_revision = true;
props0.name = true;
props0.canvas = true;
props0.input = true;
props0.successful_test_run_id = true;
props0.run_id = true;
props0.operation_id = true;
props0.operation = true;
}
}
if(!valid1){
const err8 = {instancePath,schemaPath:"#/allOf/0/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
const _errs7 = errors;
let valid4 = true;
const _errs8 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.operation !== undefined){
if("read_draft" !== data.operation){
const err9 = {};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
}
var _valid1 = _errs8 === errors;
errors = _errs7;
if(vErrors !== null){
if(_errs7){
vErrors.length = _errs7;
}
else {
vErrors = null;
}
}
if(_valid1){
const _errs10 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.expected_revision !== undefined){
const err10 = {instancePath:instancePath+"/expected_revision",schemaPath:"#/allOf/1/then/properties/expected_revision/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data.name !== undefined){
const err11 = {instancePath:instancePath+"/name",schemaPath:"#/allOf/1/then/properties/name/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(data.canvas !== undefined){
const err12 = {instancePath:instancePath+"/canvas",schemaPath:"#/allOf/1/then/properties/canvas/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(data.input !== undefined){
const err13 = {instancePath:instancePath+"/input",schemaPath:"#/allOf/1/then/properties/input/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(data.successful_test_run_id !== undefined){
const err14 = {instancePath:instancePath+"/successful_test_run_id",schemaPath:"#/allOf/1/then/properties/successful_test_run_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(data.run_id !== undefined){
const err15 = {instancePath:instancePath+"/run_id",schemaPath:"#/allOf/1/then/properties/run_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(data.operation_id !== undefined){
const err16 = {instancePath:instancePath+"/operation_id",schemaPath:"#/allOf/1/then/properties/operation_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
var _valid1 = _errs10 === errors;
valid4 = _valid1;
if(valid4){
var props1 = {};
props1.expected_revision = true;
props1.name = true;
props1.canvas = true;
props1.input = true;
props1.successful_test_run_id = true;
props1.run_id = true;
props1.operation_id = true;
props1.operation = true;
}
}
if(!valid4){
const err17 = {instancePath,schemaPath:"#/allOf/1/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(props0 !== true && props1 !== undefined){
if(props1 === true){
props0 = true;
}
else {
props0 = props0 || {};
Object.assign(props0, props1);
}
}
const _errs12 = errors;
let valid7 = true;
const _errs13 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.operation !== undefined){
if("save_draft" !== data.operation){
const err18 = {};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
}
var _valid2 = _errs13 === errors;
errors = _errs12;
if(vErrors !== null){
if(_errs12){
vErrors.length = _errs12;
}
else {
vErrors = null;
}
}
if(_valid2){
const _errs15 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.expected_revision === undefined){
const err19 = {instancePath,schemaPath:"#/allOf/2/then/required",keyword:"required",params:{missingProperty: "expected_revision"},message:"must have required property '"+"expected_revision"+"'"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
if(data.name === undefined){
const err20 = {instancePath,schemaPath:"#/allOf/2/then/required",keyword:"required",params:{missingProperty: "name"},message:"must have required property '"+"name"+"'"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(data.canvas === undefined){
const err21 = {instancePath,schemaPath:"#/allOf/2/then/required",keyword:"required",params:{missingProperty: "canvas"},message:"must have required property '"+"canvas"+"'"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
if(data.input !== undefined){
const err22 = {instancePath:instancePath+"/input",schemaPath:"#/allOf/2/then/properties/input/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
if(data.successful_test_run_id !== undefined){
const err23 = {instancePath:instancePath+"/successful_test_run_id",schemaPath:"#/allOf/2/then/properties/successful_test_run_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if(data.run_id !== undefined){
const err24 = {instancePath:instancePath+"/run_id",schemaPath:"#/allOf/2/then/properties/run_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
if(data.operation_id !== undefined){
const err25 = {instancePath:instancePath+"/operation_id",schemaPath:"#/allOf/2/then/properties/operation_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
var _valid2 = _errs15 === errors;
valid7 = _valid2;
if(valid7){
var props2 = {};
props2.input = true;
props2.successful_test_run_id = true;
props2.run_id = true;
props2.operation_id = true;
props2.operation = true;
}
}
if(!valid7){
const err26 = {instancePath,schemaPath:"#/allOf/2/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
if(props0 !== true && props2 !== undefined){
if(props2 === true){
props0 = true;
}
else {
props0 = props0 || {};
Object.assign(props0, props2);
}
}
const _errs17 = errors;
let valid10 = true;
const _errs18 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.operation !== undefined){
if("test_draft" !== data.operation){
const err27 = {};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
}
var _valid3 = _errs18 === errors;
errors = _errs17;
if(vErrors !== null){
if(_errs17){
vErrors.length = _errs17;
}
else {
vErrors = null;
}
}
if(_valid3){
const _errs20 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.expected_revision === undefined){
const err28 = {instancePath,schemaPath:"#/allOf/3/then/required",keyword:"required",params:{missingProperty: "expected_revision"},message:"must have required property '"+"expected_revision"+"'"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
if(data.input === undefined){
const err29 = {instancePath,schemaPath:"#/allOf/3/then/required",keyword:"required",params:{missingProperty: "input"},message:"must have required property '"+"input"+"'"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
if(data.name !== undefined){
const err30 = {instancePath:instancePath+"/name",schemaPath:"#/allOf/3/then/properties/name/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
if(data.canvas !== undefined){
const err31 = {instancePath:instancePath+"/canvas",schemaPath:"#/allOf/3/then/properties/canvas/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
if(data.successful_test_run_id !== undefined){
const err32 = {instancePath:instancePath+"/successful_test_run_id",schemaPath:"#/allOf/3/then/properties/successful_test_run_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
if(data.run_id !== undefined){
const err33 = {instancePath:instancePath+"/run_id",schemaPath:"#/allOf/3/then/properties/run_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
if(data.operation_id !== undefined){
const err34 = {instancePath:instancePath+"/operation_id",schemaPath:"#/allOf/3/then/properties/operation_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
}
var _valid3 = _errs20 === errors;
valid10 = _valid3;
if(valid10){
var props3 = {};
props3.name = true;
props3.canvas = true;
props3.successful_test_run_id = true;
props3.run_id = true;
props3.operation_id = true;
props3.operation = true;
}
}
if(!valid10){
const err35 = {instancePath,schemaPath:"#/allOf/3/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
if(props0 !== true && props3 !== undefined){
if(props3 === true){
props0 = true;
}
else {
props0 = props0 || {};
Object.assign(props0, props3);
}
}
const _errs22 = errors;
let valid13 = true;
const _errs23 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.operation !== undefined){
if("publish_internal" !== data.operation){
const err36 = {};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
}
}
var _valid4 = _errs23 === errors;
errors = _errs22;
if(vErrors !== null){
if(_errs22){
vErrors.length = _errs22;
}
else {
vErrors = null;
}
}
if(_valid4){
const _errs25 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.expected_revision === undefined){
const err37 = {instancePath,schemaPath:"#/allOf/4/then/required",keyword:"required",params:{missingProperty: "expected_revision"},message:"must have required property '"+"expected_revision"+"'"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
if(data.successful_test_run_id === undefined){
const err38 = {instancePath,schemaPath:"#/allOf/4/then/required",keyword:"required",params:{missingProperty: "successful_test_run_id"},message:"must have required property '"+"successful_test_run_id"+"'"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
if(data.name !== undefined){
const err39 = {instancePath:instancePath+"/name",schemaPath:"#/allOf/4/then/properties/name/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
if(data.canvas !== undefined){
const err40 = {instancePath:instancePath+"/canvas",schemaPath:"#/allOf/4/then/properties/canvas/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
if(data.input !== undefined){
const err41 = {instancePath:instancePath+"/input",schemaPath:"#/allOf/4/then/properties/input/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
if(data.run_id !== undefined){
const err42 = {instancePath:instancePath+"/run_id",schemaPath:"#/allOf/4/then/properties/run_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
if(data.operation_id !== undefined){
const err43 = {instancePath:instancePath+"/operation_id",schemaPath:"#/allOf/4/then/properties/operation_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
}
var _valid4 = _errs25 === errors;
valid13 = _valid4;
if(valid13){
var props4 = {};
props4.name = true;
props4.canvas = true;
props4.input = true;
props4.run_id = true;
props4.operation_id = true;
props4.operation = true;
}
}
if(!valid13){
const err44 = {instancePath,schemaPath:"#/allOf/4/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
}
if(props0 !== true && props4 !== undefined){
if(props4 === true){
props0 = true;
}
else {
props0 = props0 || {};
Object.assign(props0, props4);
}
}
const _errs27 = errors;
let valid16 = true;
const _errs28 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.operation !== undefined){
if("read_run" !== data.operation){
const err45 = {};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
}
}
var _valid5 = _errs28 === errors;
errors = _errs27;
if(vErrors !== null){
if(_errs27){
vErrors.length = _errs27;
}
else {
vErrors = null;
}
}
if(_valid5){
const _errs30 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.run_id === undefined){
const err46 = {instancePath,schemaPath:"#/allOf/5/then/required",keyword:"required",params:{missingProperty: "run_id"},message:"must have required property '"+"run_id"+"'"};
if(vErrors === null){
vErrors = [err46];
}
else {
vErrors.push(err46);
}
errors++;
}
if(data.expected_revision !== undefined){
const err47 = {instancePath:instancePath+"/expected_revision",schemaPath:"#/allOf/5/then/properties/expected_revision/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err47];
}
else {
vErrors.push(err47);
}
errors++;
}
if(data.name !== undefined){
const err48 = {instancePath:instancePath+"/name",schemaPath:"#/allOf/5/then/properties/name/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err48];
}
else {
vErrors.push(err48);
}
errors++;
}
if(data.canvas !== undefined){
const err49 = {instancePath:instancePath+"/canvas",schemaPath:"#/allOf/5/then/properties/canvas/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err49];
}
else {
vErrors.push(err49);
}
errors++;
}
if(data.input !== undefined){
const err50 = {instancePath:instancePath+"/input",schemaPath:"#/allOf/5/then/properties/input/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err50];
}
else {
vErrors.push(err50);
}
errors++;
}
if(data.successful_test_run_id !== undefined){
const err51 = {instancePath:instancePath+"/successful_test_run_id",schemaPath:"#/allOf/5/then/properties/successful_test_run_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err51];
}
else {
vErrors.push(err51);
}
errors++;
}
if(data.operation_id !== undefined){
const err52 = {instancePath:instancePath+"/operation_id",schemaPath:"#/allOf/5/then/properties/operation_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err52];
}
else {
vErrors.push(err52);
}
errors++;
}
}
var _valid5 = _errs30 === errors;
valid16 = _valid5;
if(valid16){
var props5 = {};
props5.expected_revision = true;
props5.name = true;
props5.canvas = true;
props5.input = true;
props5.successful_test_run_id = true;
props5.operation_id = true;
props5.operation = true;
}
}
if(!valid16){
const err53 = {instancePath,schemaPath:"#/allOf/5/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err53];
}
else {
vErrors.push(err53);
}
errors++;
}
if(props0 !== true && props5 !== undefined){
if(props5 === true){
props0 = true;
}
else {
props0 = props0 || {};
Object.assign(props0, props5);
}
}
const _errs32 = errors;
let valid19 = true;
const _errs33 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.operation !== undefined){
if("read_operation" !== data.operation){
const err54 = {};
if(vErrors === null){
vErrors = [err54];
}
else {
vErrors.push(err54);
}
errors++;
}
}
}
var _valid6 = _errs33 === errors;
errors = _errs32;
if(vErrors !== null){
if(_errs32){
vErrors.length = _errs32;
}
else {
vErrors = null;
}
}
if(_valid6){
const _errs35 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.operation_id === undefined){
const err55 = {instancePath,schemaPath:"#/allOf/6/then/required",keyword:"required",params:{missingProperty: "operation_id"},message:"must have required property '"+"operation_id"+"'"};
if(vErrors === null){
vErrors = [err55];
}
else {
vErrors.push(err55);
}
errors++;
}
if(data.expected_revision !== undefined){
const err56 = {instancePath:instancePath+"/expected_revision",schemaPath:"#/allOf/6/then/properties/expected_revision/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err56];
}
else {
vErrors.push(err56);
}
errors++;
}
if(data.name !== undefined){
const err57 = {instancePath:instancePath+"/name",schemaPath:"#/allOf/6/then/properties/name/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err57];
}
else {
vErrors.push(err57);
}
errors++;
}
if(data.canvas !== undefined){
const err58 = {instancePath:instancePath+"/canvas",schemaPath:"#/allOf/6/then/properties/canvas/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err58];
}
else {
vErrors.push(err58);
}
errors++;
}
if(data.input !== undefined){
const err59 = {instancePath:instancePath+"/input",schemaPath:"#/allOf/6/then/properties/input/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err59];
}
else {
vErrors.push(err59);
}
errors++;
}
if(data.successful_test_run_id !== undefined){
const err60 = {instancePath:instancePath+"/successful_test_run_id",schemaPath:"#/allOf/6/then/properties/successful_test_run_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err60];
}
else {
vErrors.push(err60);
}
errors++;
}
if(data.run_id !== undefined){
const err61 = {instancePath:instancePath+"/run_id",schemaPath:"#/allOf/6/then/properties/run_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err61];
}
else {
vErrors.push(err61);
}
errors++;
}
}
var _valid6 = _errs35 === errors;
valid19 = _valid6;
if(valid19){
var props6 = {};
props6.expected_revision = true;
props6.name = true;
props6.canvas = true;
props6.input = true;
props6.successful_test_run_id = true;
props6.run_id = true;
props6.operation = true;
}
}
if(!valid19){
const err62 = {instancePath,schemaPath:"#/allOf/6/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err62];
}
else {
vErrors.push(err62);
}
errors++;
}
if(props0 !== true && props6 !== undefined){
if(props6 === true){
props0 = true;
}
else {
props0 = props0 || {};
Object.assign(props0, props6);
}
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.bridge_id === undefined){
const err63 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "bridge_id"},message:"must have required property '"+"bridge_id"+"'"};
if(vErrors === null){
vErrors = [err63];
}
else {
vErrors.push(err63);
}
errors++;
}
if(data.generation === undefined){
const err64 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "generation"},message:"must have required property '"+"generation"+"'"};
if(vErrors === null){
vErrors = [err64];
}
else {
vErrors.push(err64);
}
errors++;
}
if(data.protocol_version === undefined){
const err65 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "protocol_version"},message:"must have required property '"+"protocol_version"+"'"};
if(vErrors === null){
vErrors = [err65];
}
else {
vErrors.push(err65);
}
errors++;
}
if(data.request_id === undefined){
const err66 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "request_id"},message:"must have required property '"+"request_id"+"'"};
if(vErrors === null){
vErrors = [err66];
}
else {
vErrors.push(err66);
}
errors++;
}
if(data.operation === undefined){
const err67 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "operation"},message:"must have required property '"+"operation"+"'"};
if(vErrors === null){
vErrors = [err67];
}
else {
vErrors.push(err67);
}
errors++;
}
for(const key0 in data){
if(!(func82.call(schema169.properties, key0))){
const err68 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err68];
}
else {
vErrors.push(err68);
}
errors++;
}
}
if(data.bridge_id !== undefined){
let data47 = data.bridge_id;
if(typeof data47 === "string"){
if(func1(data47) > 64){
const err69 = {instancePath:instancePath+"/bridge_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err69];
}
else {
vErrors.push(err69);
}
errors++;
}
if(func1(data47) < 1){
const err70 = {instancePath:instancePath+"/bridge_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err70];
}
else {
vErrors.push(err70);
}
errors++;
}
if(!pattern4.test(data47)){
const err71 = {instancePath:instancePath+"/bridge_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err71];
}
else {
vErrors.push(err71);
}
errors++;
}
}
else {
const err72 = {instancePath:instancePath+"/bridge_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err72];
}
else {
vErrors.push(err72);
}
errors++;
}
}
if(data.generation !== undefined){
let data48 = data.generation;
if(!(((typeof data48 == "number") && (!(data48 % 1) && !isNaN(data48))) && (isFinite(data48)))){
const err73 = {instancePath:instancePath+"/generation",schemaPath:"#/properties/generation/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err73];
}
else {
vErrors.push(err73);
}
errors++;
}
if((typeof data48 == "number") && (isFinite(data48))){
if(data48 < 1 || isNaN(data48)){
const err74 = {instancePath:instancePath+"/generation",schemaPath:"#/properties/generation/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err74];
}
else {
vErrors.push(err74);
}
errors++;
}
}
}
if(data.protocol_version !== undefined){
let data49 = data.protocol_version;
if(!(((typeof data49 == "number") && (!(data49 % 1) && !isNaN(data49))) && (isFinite(data49)))){
const err75 = {instancePath:instancePath+"/protocol_version",schemaPath:"#/properties/protocol_version/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err75];
}
else {
vErrors.push(err75);
}
errors++;
}
if(!(data49 === 1)){
const err76 = {instancePath:instancePath+"/protocol_version",schemaPath:"#/properties/protocol_version/enum",keyword:"enum",params:{allowedValues: schema169.properties.protocol_version.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err76];
}
else {
vErrors.push(err76);
}
errors++;
}
}
if(data.request_id !== undefined){
let data50 = data.request_id;
if(typeof data50 === "string"){
if(func1(data50) > 64){
const err77 = {instancePath:instancePath+"/request_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err77];
}
else {
vErrors.push(err77);
}
errors++;
}
if(func1(data50) < 1){
const err78 = {instancePath:instancePath+"/request_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err78];
}
else {
vErrors.push(err78);
}
errors++;
}
if(!pattern4.test(data50)){
const err79 = {instancePath:instancePath+"/request_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err79];
}
else {
vErrors.push(err79);
}
errors++;
}
}
else {
const err80 = {instancePath:instancePath+"/request_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err80];
}
else {
vErrors.push(err80);
}
errors++;
}
}
if(data.operation !== undefined){
let data51 = data.operation;
if(typeof data51 !== "string"){
const err81 = {instancePath:instancePath+"/operation",schemaPath:"#/$defs/EditorOperation/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err81];
}
else {
vErrors.push(err81);
}
errors++;
}
if(!(((((((data51 === "bootstrap") || (data51 === "read_draft")) || (data51 === "save_draft")) || (data51 === "test_draft")) || (data51 === "publish_internal")) || (data51 === "read_run")) || (data51 === "read_operation"))){
const err82 = {instancePath:instancePath+"/operation",schemaPath:"#/$defs/EditorOperation/enum",keyword:"enum",params:{allowedValues: schema167.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err82];
}
else {
vErrors.push(err82);
}
errors++;
}
}
if(data.expected_revision !== undefined){
let data52 = data.expected_revision;
if(typeof data52 === "string"){
if(func1(data52) > 64){
const err83 = {instancePath:instancePath+"/expected_revision",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err83];
}
else {
vErrors.push(err83);
}
errors++;
}
if(func1(data52) < 1){
const err84 = {instancePath:instancePath+"/expected_revision",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err84];
}
else {
vErrors.push(err84);
}
errors++;
}
if(!pattern4.test(data52)){
const err85 = {instancePath:instancePath+"/expected_revision",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err85];
}
else {
vErrors.push(err85);
}
errors++;
}
}
else {
const err86 = {instancePath:instancePath+"/expected_revision",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err86];
}
else {
vErrors.push(err86);
}
errors++;
}
}
if(data.name !== undefined){
let data53 = data.name;
if(typeof data53 === "string"){
if(func1(data53) > 80){
const err87 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/maxLength",keyword:"maxLength",params:{limit: 80},message:"must NOT have more than 80 characters"};
if(vErrors === null){
vErrors = [err87];
}
else {
vErrors.push(err87);
}
errors++;
}
if(func1(data53) < 1){
const err88 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err88];
}
else {
vErrors.push(err88);
}
errors++;
}
}
else {
const err89 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err89];
}
else {
vErrors.push(err89);
}
errors++;
}
}
if(data.canvas !== undefined){
let data54 = data.canvas;
if(typeof data54 === "string"){
if(func1(data54) > 262144){
const err90 = {instancePath:instancePath+"/canvas",schemaPath:"#/properties/canvas/maxLength",keyword:"maxLength",params:{limit: 262144},message:"must NOT have more than 262144 characters"};
if(vErrors === null){
vErrors = [err90];
}
else {
vErrors.push(err90);
}
errors++;
}
if(new TextEncoder().encode(data54).length > 262144){
const err91 = {instancePath:instancePath+"/canvas",schemaPath:"#/properties/canvas/x-utf8-max-bytes",keyword:"x-utf8-max-bytes",params:{},message:"must pass \"x-utf8-max-bytes\" keyword validation"};
if(vErrors === null){
vErrors = [err91];
}
else {
vErrors.push(err91);
}
errors++;
}
}
else {
const err92 = {instancePath:instancePath+"/canvas",schemaPath:"#/properties/canvas/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err92];
}
else {
vErrors.push(err92);
}
errors++;
}
}
if(data.input !== undefined){
let data55 = data.input;
if(data55 && typeof data55 == "object" && !Array.isArray(data55)){
if(data55.input === undefined){
const err93 = {instancePath:instancePath+"/input",schemaPath:"#/$defs/TextInput/required",keyword:"required",params:{missingProperty: "input"},message:"must have required property '"+"input"+"'"};
if(vErrors === null){
vErrors = [err93];
}
else {
vErrors.push(err93);
}
errors++;
}
for(const key1 in data55){
if(!(key1 === "input")){
const err94 = {instancePath:instancePath+"/input",schemaPath:"#/$defs/TextInput/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err94];
}
else {
vErrors.push(err94);
}
errors++;
}
}
if(data55.input !== undefined){
let data56 = data55.input;
if(typeof data56 === "string"){
if(func1(data56) > 4096){
const err95 = {instancePath:instancePath+"/input/input",schemaPath:"#/$defs/TextInput/properties/input/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err95];
}
else {
vErrors.push(err95);
}
errors++;
}
if(new TextEncoder().encode(data56).length > 4096){
const err96 = {instancePath:instancePath+"/input/input",schemaPath:"#/$defs/TextInput/properties/input/x-utf8-max-bytes",keyword:"x-utf8-max-bytes",params:{},message:"must pass \"x-utf8-max-bytes\" keyword validation"};
if(vErrors === null){
vErrors = [err96];
}
else {
vErrors.push(err96);
}
errors++;
}
}
else {
const err97 = {instancePath:instancePath+"/input/input",schemaPath:"#/$defs/TextInput/properties/input/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err97];
}
else {
vErrors.push(err97);
}
errors++;
}
}
}
else {
const err98 = {instancePath:instancePath+"/input",schemaPath:"#/$defs/TextInput/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err98];
}
else {
vErrors.push(err98);
}
errors++;
}
}
if(data.successful_test_run_id !== undefined){
let data57 = data.successful_test_run_id;
if(typeof data57 === "string"){
if(func1(data57) > 64){
const err99 = {instancePath:instancePath+"/successful_test_run_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err99];
}
else {
vErrors.push(err99);
}
errors++;
}
if(func1(data57) < 1){
const err100 = {instancePath:instancePath+"/successful_test_run_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err100];
}
else {
vErrors.push(err100);
}
errors++;
}
if(!pattern4.test(data57)){
const err101 = {instancePath:instancePath+"/successful_test_run_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err101];
}
else {
vErrors.push(err101);
}
errors++;
}
}
else {
const err102 = {instancePath:instancePath+"/successful_test_run_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err102];
}
else {
vErrors.push(err102);
}
errors++;
}
}
if(data.run_id !== undefined){
let data58 = data.run_id;
if(typeof data58 === "string"){
if(func1(data58) > 64){
const err103 = {instancePath:instancePath+"/run_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err103];
}
else {
vErrors.push(err103);
}
errors++;
}
if(func1(data58) < 1){
const err104 = {instancePath:instancePath+"/run_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err104];
}
else {
vErrors.push(err104);
}
errors++;
}
if(!pattern4.test(data58)){
const err105 = {instancePath:instancePath+"/run_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err105];
}
else {
vErrors.push(err105);
}
errors++;
}
}
else {
const err106 = {instancePath:instancePath+"/run_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err106];
}
else {
vErrors.push(err106);
}
errors++;
}
}
if(data.operation_id !== undefined){
let data59 = data.operation_id;
if(typeof data59 === "string"){
if(func1(data59) > 36){
const err107 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/maxLength",keyword:"maxLength",params:{limit: 36},message:"must NOT have more than 36 characters"};
if(vErrors === null){
vErrors = [err107];
}
else {
vErrors.push(err107);
}
errors++;
}
if(func1(data59) < 36){
const err108 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/minLength",keyword:"minLength",params:{limit: 36},message:"must NOT have fewer than 36 characters"};
if(vErrors === null){
vErrors = [err108];
}
else {
vErrors.push(err108);
}
errors++;
}
if(!pattern5.test(data59)){
const err109 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/pattern",keyword:"pattern",params:{pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},message:"must match pattern \""+"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"+"\""};
if(vErrors === null){
vErrors = [err109];
}
else {
vErrors.push(err109);
}
errors++;
}
}
else {
const err110 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err110];
}
else {
vErrors.push(err110);
}
errors++;
}
}
}
else {
const err111 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err111];
}
else {
vErrors.push(err111);
}
errors++;
}
validate109.errors = vErrors;
return errors === 0;
}
validate109.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate108(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/EditorExchangeInput" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate108.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(!(validate109(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate109.errors : vErrors.concat(validate109.errors);
errors = vErrors.length;
}
validate108.errors = vErrors;
return errors === 0;
}
validate108.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const v_EditorExchangeResult = validate111;
const schema178 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/EditorExchangeResult","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/EditorExchangeResult"};
const schema179 = {"type":"object","additionalProperties":false,"properties":{"request_id":{"$ref":"#/$defs/Identifier"},"operation_id":{"$ref":"#/$defs/OperationId"},"bootstrap":{"$ref":"#/$defs/Bootstrap"},"workflow":{"$ref":"#/$defs/Workflow"},"run":{"$ref":"#/$defs/Run"},"receipt":{"$ref":"#/$defs/OperationReceipt"}},"required":["request_id"]};

function validate113(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate113.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.workflow === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "workflow"},message:"must have required property '"+"workflow"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.principal === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "principal"},message:"must have required property '"+"principal"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.node_types === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "node_types"},message:"must have required property '"+"node_types"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.limits === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "limits"},message:"must have required property '"+"limits"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "workflow") || (key0 === "principal")) || (key0 === "node_types")) || (key0 === "limits"))){
const err4 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.workflow !== undefined){
if(!(validate98(data.workflow, {instancePath:instancePath+"/workflow",parentData:data,parentDataProperty:"workflow",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate98.errors : vErrors.concat(validate98.errors);
errors = vErrors.length;
}
}
if(data.principal !== undefined){
if(!(validate104(data.principal, {instancePath:instancePath+"/principal",parentData:data,parentDataProperty:"principal",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate104.errors : vErrors.concat(validate104.errors);
errors = vErrors.length;
}
}
if(data.node_types !== undefined){
let data2 = data.node_types;
if(Array.isArray(data2)){
if(data2.length > 3){
const err5 = {instancePath:instancePath+"/node_types",schemaPath:"#/properties/node_types/maxItems",keyword:"maxItems",params:{limit: 3},message:"must NOT have more than 3 items"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
const len0 = data2.length;
for(let i0=0; i0<len0; i0++){
let data3 = data2[i0];
if(!(((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3))) && (isFinite(data3)))){
const err6 = {instancePath:instancePath+"/node_types/" + i0,schemaPath:"#/properties/node_types/items/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(!(((data3 === 1) || (data3 === 15)) || (data3 === 2))){
const err7 = {instancePath:instancePath+"/node_types/" + i0,schemaPath:"#/properties/node_types/items/enum",keyword:"enum",params:{allowedValues: schema159.properties.node_types.items.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
}
else {
const err8 = {instancePath:instancePath+"/node_types",schemaPath:"#/properties/node_types/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.limits !== undefined){
let data4 = data.limits;
if(data4 && typeof data4 == "object" && !Array.isArray(data4)){
if(data4.input_bytes === undefined){
const err9 = {instancePath:instancePath+"/limits",schemaPath:"#/$defs/Limits/required",keyword:"required",params:{missingProperty: "input_bytes"},message:"must have required property '"+"input_bytes"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data4.prefix_bytes === undefined){
const err10 = {instancePath:instancePath+"/limits",schemaPath:"#/$defs/Limits/required",keyword:"required",params:{missingProperty: "prefix_bytes"},message:"must have required property '"+"prefix_bytes"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data4.output_bytes === undefined){
const err11 = {instancePath:instancePath+"/limits",schemaPath:"#/$defs/Limits/required",keyword:"required",params:{missingProperty: "output_bytes"},message:"must have required property '"+"output_bytes"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(data4.canvas_bytes === undefined){
const err12 = {instancePath:instancePath+"/limits",schemaPath:"#/$defs/Limits/required",keyword:"required",params:{missingProperty: "canvas_bytes"},message:"must have required property '"+"canvas_bytes"+"'"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(data4.message_bytes === undefined){
const err13 = {instancePath:instancePath+"/limits",schemaPath:"#/$defs/Limits/required",keyword:"required",params:{missingProperty: "message_bytes"},message:"must have required property '"+"message_bytes"+"'"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(data4.max_active_runs === undefined){
const err14 = {instancePath:instancePath+"/limits",schemaPath:"#/$defs/Limits/required",keyword:"required",params:{missingProperty: "max_active_runs"},message:"must have required property '"+"max_active_runs"+"'"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(data4.execution_budget_seconds === undefined){
const err15 = {instancePath:instancePath+"/limits",schemaPath:"#/$defs/Limits/required",keyword:"required",params:{missingProperty: "execution_budget_seconds"},message:"must have required property '"+"execution_budget_seconds"+"'"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(data4.editor_ttl_seconds === undefined){
const err16 = {instancePath:instancePath+"/limits",schemaPath:"#/$defs/Limits/required",keyword:"required",params:{missingProperty: "editor_ttl_seconds"},message:"must have required property '"+"editor_ttl_seconds"+"'"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
for(const key1 in data4){
if(!((((((((key1 === "input_bytes") || (key1 === "prefix_bytes")) || (key1 === "output_bytes")) || (key1 === "canvas_bytes")) || (key1 === "message_bytes")) || (key1 === "max_active_runs")) || (key1 === "execution_budget_seconds")) || (key1 === "editor_ttl_seconds"))){
const err17 = {instancePath:instancePath+"/limits",schemaPath:"#/$defs/Limits/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data4.input_bytes !== undefined){
let data5 = data4.input_bytes;
if(!(((typeof data5 == "number") && (!(data5 % 1) && !isNaN(data5))) && (isFinite(data5)))){
const err18 = {instancePath:instancePath+"/limits/input_bytes",schemaPath:"#/$defs/Limits/properties/input_bytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(!(data5 === 4096)){
const err19 = {instancePath:instancePath+"/limits/input_bytes",schemaPath:"#/$defs/Limits/properties/input_bytes/enum",keyword:"enum",params:{allowedValues: schema47.properties.input_bytes.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data4.prefix_bytes !== undefined){
let data6 = data4.prefix_bytes;
if(!(((typeof data6 == "number") && (!(data6 % 1) && !isNaN(data6))) && (isFinite(data6)))){
const err20 = {instancePath:instancePath+"/limits/prefix_bytes",schemaPath:"#/$defs/Limits/properties/prefix_bytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(!(data6 === 1024)){
const err21 = {instancePath:instancePath+"/limits/prefix_bytes",schemaPath:"#/$defs/Limits/properties/prefix_bytes/enum",keyword:"enum",params:{allowedValues: schema47.properties.prefix_bytes.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data4.output_bytes !== undefined){
let data7 = data4.output_bytes;
if(!(((typeof data7 == "number") && (!(data7 % 1) && !isNaN(data7))) && (isFinite(data7)))){
const err22 = {instancePath:instancePath+"/limits/output_bytes",schemaPath:"#/$defs/Limits/properties/output_bytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
if(!(data7 === 5120)){
const err23 = {instancePath:instancePath+"/limits/output_bytes",schemaPath:"#/$defs/Limits/properties/output_bytes/enum",keyword:"enum",params:{allowedValues: schema47.properties.output_bytes.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
if(data4.canvas_bytes !== undefined){
let data8 = data4.canvas_bytes;
if(!(((typeof data8 == "number") && (!(data8 % 1) && !isNaN(data8))) && (isFinite(data8)))){
const err24 = {instancePath:instancePath+"/limits/canvas_bytes",schemaPath:"#/$defs/Limits/properties/canvas_bytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
if(!(data8 === 262144)){
const err25 = {instancePath:instancePath+"/limits/canvas_bytes",schemaPath:"#/$defs/Limits/properties/canvas_bytes/enum",keyword:"enum",params:{allowedValues: schema47.properties.canvas_bytes.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data4.message_bytes !== undefined){
let data9 = data4.message_bytes;
if(!(((typeof data9 == "number") && (!(data9 % 1) && !isNaN(data9))) && (isFinite(data9)))){
const err26 = {instancePath:instancePath+"/limits/message_bytes",schemaPath:"#/$defs/Limits/properties/message_bytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
if(!(data9 === 524288)){
const err27 = {instancePath:instancePath+"/limits/message_bytes",schemaPath:"#/$defs/Limits/properties/message_bytes/enum",keyword:"enum",params:{allowedValues: schema47.properties.message_bytes.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
if(data4.max_active_runs !== undefined){
let data10 = data4.max_active_runs;
if(!(((typeof data10 == "number") && (!(data10 % 1) && !isNaN(data10))) && (isFinite(data10)))){
const err28 = {instancePath:instancePath+"/limits/max_active_runs",schemaPath:"#/$defs/Limits/properties/max_active_runs/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
if(!(data10 === 1)){
const err29 = {instancePath:instancePath+"/limits/max_active_runs",schemaPath:"#/$defs/Limits/properties/max_active_runs/enum",keyword:"enum",params:{allowedValues: schema47.properties.max_active_runs.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
if(data4.execution_budget_seconds !== undefined){
let data11 = data4.execution_budget_seconds;
if(!(((typeof data11 == "number") && (!(data11 % 1) && !isNaN(data11))) && (isFinite(data11)))){
const err30 = {instancePath:instancePath+"/limits/execution_budget_seconds",schemaPath:"#/$defs/Limits/properties/execution_budget_seconds/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
if(!(data11 === 30)){
const err31 = {instancePath:instancePath+"/limits/execution_budget_seconds",schemaPath:"#/$defs/Limits/properties/execution_budget_seconds/enum",keyword:"enum",params:{allowedValues: schema47.properties.execution_budget_seconds.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
}
if(data4.editor_ttl_seconds !== undefined){
let data12 = data4.editor_ttl_seconds;
if(!(((typeof data12 == "number") && (!(data12 % 1) && !isNaN(data12))) && (isFinite(data12)))){
const err32 = {instancePath:instancePath+"/limits/editor_ttl_seconds",schemaPath:"#/$defs/Limits/properties/editor_ttl_seconds/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
if(!(data12 === 300)){
const err33 = {instancePath:instancePath+"/limits/editor_ttl_seconds",schemaPath:"#/$defs/Limits/properties/editor_ttl_seconds/enum",keyword:"enum",params:{allowedValues: schema47.properties.editor_ttl_seconds.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
}
}
else {
const err34 = {instancePath:instancePath+"/limits",schemaPath:"#/$defs/Limits/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
}
}
else {
const err35 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
validate113.errors = vErrors;
return errors === 0;
}
validate113.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate118(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate118.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.run_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "run_id"},message:"must have required property '"+"run_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.workflow_id === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "workflow_id"},message:"must have required property '"+"workflow_id"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.operation_id === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "operation_id"},message:"must have required property '"+"operation_id"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.mode === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "mode"},message:"must have required property '"+"mode"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.state === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "state"},message:"must have required property '"+"state"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.terminal === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "terminal"},message:"must have required property '"+"terminal"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.started_at_ms === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "started_at_ms"},message:"must have required property '"+"started_at_ms"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
for(const key0 in data){
if(!(func82.call(schema111.properties, key0))){
const err7 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.run_id !== undefined){
let data0 = data.run_id;
if(typeof data0 === "string"){
if(func1(data0) > 64){
const err8 = {instancePath:instancePath+"/run_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(func1(data0) < 1){
const err9 = {instancePath:instancePath+"/run_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(!pattern4.test(data0)){
const err10 = {instancePath:instancePath+"/run_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
else {
const err11 = {instancePath:instancePath+"/run_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.workflow_id !== undefined){
let data1 = data.workflow_id;
if(typeof data1 === "string"){
if(func1(data1) > 64){
const err12 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(func1(data1) < 1){
const err13 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(!pattern4.test(data1)){
const err14 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
else {
const err15 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data.operation_id !== undefined){
let data2 = data.operation_id;
if(typeof data2 === "string"){
if(func1(data2) > 36){
const err16 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/maxLength",keyword:"maxLength",params:{limit: 36},message:"must NOT have more than 36 characters"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(func1(data2) < 36){
const err17 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/minLength",keyword:"minLength",params:{limit: 36},message:"must NOT have fewer than 36 characters"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(!pattern5.test(data2)){
const err18 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/pattern",keyword:"pattern",params:{pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},message:"must match pattern \""+"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"+"\""};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
else {
const err19 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data.mode !== undefined){
let data3 = data.mode;
if(typeof data3 !== "string"){
const err20 = {instancePath:instancePath+"/mode",schemaPath:"#/$defs/RunMode/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(!((data3 === "debug") || (data3 === "release"))){
const err21 = {instancePath:instancePath+"/mode",schemaPath:"#/$defs/RunMode/enum",keyword:"enum",params:{allowedValues: schema103.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data.revision !== undefined){
let data4 = data.revision;
if(typeof data4 === "string"){
if(func1(data4) > 64){
const err22 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
if(func1(data4) < 1){
const err23 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if(!pattern4.test(data4)){
const err24 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
else {
const err25 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data.version !== undefined){
let data5 = data.version;
if(typeof data5 === "string"){
if(func1(data5) > 32){
const err26 = {instancePath:instancePath+"/version",schemaPath:"#/$defs/Version/maxLength",keyword:"maxLength",params:{limit: 32},message:"must NOT have more than 32 characters"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
if(!pattern6.test(data5)){
const err27 = {instancePath:instancePath+"/version",schemaPath:"#/$defs/Version/pattern",keyword:"pattern",params:{pattern: "^v0[.]0[.][1-9][0-9]*$"},message:"must match pattern \""+"^v0[.]0[.][1-9][0-9]*$"+"\""};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
else {
const err28 = {instancePath:instancePath+"/version",schemaPath:"#/$defs/Version/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
if(data.state !== undefined){
let data6 = data.state;
if(typeof data6 === "string"){
if(func1(data6) > 64){
const err29 = {instancePath:instancePath+"/state",schemaPath:"#/properties/state/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
else {
const err30 = {instancePath:instancePath+"/state",schemaPath:"#/properties/state/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
if(data.terminal !== undefined){
if(typeof data.terminal !== "boolean"){
const err31 = {instancePath:instancePath+"/terminal",schemaPath:"#/properties/terminal/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
}
if(data.input !== undefined){
let data8 = data.input;
if(data8 && typeof data8 == "object" && !Array.isArray(data8)){
if(data8.input === undefined){
const err32 = {instancePath:instancePath+"/input",schemaPath:"#/$defs/TextInput/required",keyword:"required",params:{missingProperty: "input"},message:"must have required property '"+"input"+"'"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
for(const key1 in data8){
if(!(key1 === "input")){
const err33 = {instancePath:instancePath+"/input",schemaPath:"#/$defs/TextInput/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
}
if(data8.input !== undefined){
let data9 = data8.input;
if(typeof data9 === "string"){
if(func1(data9) > 4096){
const err34 = {instancePath:instancePath+"/input/input",schemaPath:"#/$defs/TextInput/properties/input/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
if(new TextEncoder().encode(data9).length > 4096){
const err35 = {instancePath:instancePath+"/input/input",schemaPath:"#/$defs/TextInput/properties/input/x-utf8-max-bytes",keyword:"x-utf8-max-bytes",params:{},message:"must pass \"x-utf8-max-bytes\" keyword validation"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
}
else {
const err36 = {instancePath:instancePath+"/input/input",schemaPath:"#/$defs/TextInput/properties/input/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
}
}
else {
const err37 = {instancePath:instancePath+"/input",schemaPath:"#/$defs/TextInput/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
}
if(data.output !== undefined){
let data10 = data.output;
if(typeof data10 === "string"){
if(func1(data10) > 5120){
const err38 = {instancePath:instancePath+"/output",schemaPath:"#/properties/output/maxLength",keyword:"maxLength",params:{limit: 5120},message:"must NOT have more than 5120 characters"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
if(new TextEncoder().encode(data10).length > 5120){
const err39 = {instancePath:instancePath+"/output",schemaPath:"#/properties/output/x-utf8-max-bytes",keyword:"x-utf8-max-bytes",params:{},message:"must pass \"x-utf8-max-bytes\" keyword validation"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
}
else {
const err40 = {instancePath:instancePath+"/output",schemaPath:"#/properties/output/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
}
if(data.nodes !== undefined){
let data11 = data.nodes;
if(Array.isArray(data11)){
if(data11.length > 3){
const err41 = {instancePath:instancePath+"/nodes",schemaPath:"#/properties/nodes/maxItems",keyword:"maxItems",params:{limit: 3},message:"must NOT have more than 3 items"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
const len0 = data11.length;
for(let i0=0; i0<len0; i0++){
if(!(validate73(data11[i0], {instancePath:instancePath+"/nodes/" + i0,parentData:data11,parentDataProperty:i0,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate73.errors : vErrors.concat(validate73.errors);
errors = vErrors.length;
}
}
}
else {
const err42 = {instancePath:instancePath+"/nodes",schemaPath:"#/properties/nodes/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
}
if(data.started_at_ms !== undefined){
let data13 = data.started_at_ms;
if(!(((typeof data13 == "number") && (!(data13 % 1) && !isNaN(data13))) && (isFinite(data13)))){
const err43 = {instancePath:instancePath+"/started_at_ms",schemaPath:"#/properties/started_at_ms/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
if((typeof data13 == "number") && (isFinite(data13))){
if(data13 < 0 || isNaN(data13)){
const err44 = {instancePath:instancePath+"/started_at_ms",schemaPath:"#/properties/started_at_ms/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
}
}
}
if(data.finished_at_ms !== undefined){
let data14 = data.finished_at_ms;
if(!(((typeof data14 == "number") && (!(data14 % 1) && !isNaN(data14))) && (isFinite(data14)))){
const err45 = {instancePath:instancePath+"/finished_at_ms",schemaPath:"#/properties/finished_at_ms/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
if((typeof data14 == "number") && (isFinite(data14))){
if(data14 < 0 || isNaN(data14)){
const err46 = {instancePath:instancePath+"/finished_at_ms",schemaPath:"#/properties/finished_at_ms/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err46];
}
else {
vErrors.push(err46);
}
errors++;
}
}
}
if(data.error !== undefined){
if(!(validate68(data.error, {instancePath:instancePath+"/error",parentData:data,parentDataProperty:"error",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate68.errors : vErrors.concat(validate68.errors);
errors = vErrors.length;
}
}
}
else {
const err47 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err47];
}
else {
vErrors.push(err47);
}
errors++;
}
validate118.errors = vErrors;
return errors === 0;
}
validate118.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate122(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate122.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.operation_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "operation_id"},message:"must have required property '"+"operation_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.kind === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.phase === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "phase"},message:"must have required property '"+"phase"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!((((((((key0 === "operation_id") || (key0 === "kind")) || (key0 === "phase")) || (key0 === "workflow_id")) || (key0 === "revision")) || (key0 === "version")) || (key0 === "run_id")) || (key0 === "error"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.operation_id !== undefined){
let data0 = data.operation_id;
if(typeof data0 === "string"){
if(func1(data0) > 36){
const err4 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/maxLength",keyword:"maxLength",params:{limit: 36},message:"must NOT have more than 36 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(func1(data0) < 36){
const err5 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/minLength",keyword:"minLength",params:{limit: 36},message:"must NOT have fewer than 36 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(!pattern5.test(data0)){
const err6 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/pattern",keyword:"pattern",params:{pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},message:"must match pattern \""+"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"+"\""};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
else {
const err7 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.kind !== undefined){
let data1 = data.kind;
if(typeof data1 !== "string"){
const err8 = {instancePath:instancePath+"/kind",schemaPath:"#/$defs/OperationKind/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(!(((((data1 === "create") || (data1 === "save")) || (data1 === "test")) || (data1 === "publish")) || (data1 === "run"))){
const err9 = {instancePath:instancePath+"/kind",schemaPath:"#/$defs/OperationKind/enum",keyword:"enum",params:{allowedValues: schema131.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.phase !== undefined){
let data2 = data.phase;
if(typeof data2 !== "string"){
const err10 = {instancePath:instancePath+"/phase",schemaPath:"#/$defs/OperationPhase/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(!((((data2 === "recorded") || (data2 === "completed")) || (data2 === "unknown")) || (data2 === "rejected"))){
const err11 = {instancePath:instancePath+"/phase",schemaPath:"#/$defs/OperationPhase/enum",keyword:"enum",params:{allowedValues: schema133.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.workflow_id !== undefined){
let data3 = data.workflow_id;
if(typeof data3 === "string"){
if(func1(data3) > 64){
const err12 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(func1(data3) < 1){
const err13 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(!pattern4.test(data3)){
const err14 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
else {
const err15 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data.revision !== undefined){
let data4 = data.revision;
if(typeof data4 === "string"){
if(func1(data4) > 64){
const err16 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(func1(data4) < 1){
const err17 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(!pattern4.test(data4)){
const err18 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
else {
const err19 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data.version !== undefined){
let data5 = data.version;
if(typeof data5 === "string"){
if(func1(data5) > 32){
const err20 = {instancePath:instancePath+"/version",schemaPath:"#/$defs/Version/maxLength",keyword:"maxLength",params:{limit: 32},message:"must NOT have more than 32 characters"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(!pattern6.test(data5)){
const err21 = {instancePath:instancePath+"/version",schemaPath:"#/$defs/Version/pattern",keyword:"pattern",params:{pattern: "^v0[.]0[.][1-9][0-9]*$"},message:"must match pattern \""+"^v0[.]0[.][1-9][0-9]*$"+"\""};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
else {
const err22 = {instancePath:instancePath+"/version",schemaPath:"#/$defs/Version/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data.run_id !== undefined){
let data6 = data.run_id;
if(typeof data6 === "string"){
if(func1(data6) > 64){
const err23 = {instancePath:instancePath+"/run_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if(func1(data6) < 1){
const err24 = {instancePath:instancePath+"/run_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
if(!pattern4.test(data6)){
const err25 = {instancePath:instancePath+"/run_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
else {
const err26 = {instancePath:instancePath+"/run_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
if(data.error !== undefined){
if(!(validate68(data.error, {instancePath:instancePath+"/error",parentData:data,parentDataProperty:"error",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate68.errors : vErrors.concat(validate68.errors);
errors = vErrors.length;
}
}
}
else {
const err27 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
validate122.errors = vErrors;
return errors === 0;
}
validate122.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate112(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate112.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.request_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "request_id"},message:"must have required property '"+"request_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!((((((key0 === "request_id") || (key0 === "operation_id")) || (key0 === "bootstrap")) || (key0 === "workflow")) || (key0 === "run")) || (key0 === "receipt"))){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.request_id !== undefined){
let data0 = data.request_id;
if(typeof data0 === "string"){
if(func1(data0) > 64){
const err2 = {instancePath:instancePath+"/request_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func1(data0) < 1){
const err3 = {instancePath:instancePath+"/request_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern4.test(data0)){
const err4 = {instancePath:instancePath+"/request_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
else {
const err5 = {instancePath:instancePath+"/request_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.operation_id !== undefined){
let data1 = data.operation_id;
if(typeof data1 === "string"){
if(func1(data1) > 36){
const err6 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/maxLength",keyword:"maxLength",params:{limit: 36},message:"must NOT have more than 36 characters"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(func1(data1) < 36){
const err7 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/minLength",keyword:"minLength",params:{limit: 36},message:"must NOT have fewer than 36 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(!pattern5.test(data1)){
const err8 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/pattern",keyword:"pattern",params:{pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},message:"must match pattern \""+"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"+"\""};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
else {
const err9 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.bootstrap !== undefined){
if(!(validate113(data.bootstrap, {instancePath:instancePath+"/bootstrap",parentData:data,parentDataProperty:"bootstrap",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate113.errors : vErrors.concat(validate113.errors);
errors = vErrors.length;
}
}
if(data.workflow !== undefined){
if(!(validate98(data.workflow, {instancePath:instancePath+"/workflow",parentData:data,parentDataProperty:"workflow",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate98.errors : vErrors.concat(validate98.errors);
errors = vErrors.length;
}
}
if(data.run !== undefined){
if(!(validate118(data.run, {instancePath:instancePath+"/run",parentData:data,parentDataProperty:"run",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate118.errors : vErrors.concat(validate118.errors);
errors = vErrors.length;
}
}
if(data.receipt !== undefined){
if(!(validate122(data.receipt, {instancePath:instancePath+"/receipt",parentData:data,parentDataProperty:"receipt",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate122.errors : vErrors.concat(validate122.errors);
errors = vErrors.length;
}
}
}
else {
const err10 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
validate112.errors = vErrors;
return errors === 0;
}
validate112.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate111(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/EditorExchangeResult" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate111.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(!(validate112(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate112.errors : vErrors.concat(validate112.errors);
errors = vErrors.length;
}
validate111.errors = vErrors;
return errors === 0;
}
validate111.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const v_EditorCloseInput = validate126;
const schema200 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/EditorCloseInput","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/EditorCloseInput"};
const schema201 = {"type":"object","additionalProperties":false,"properties":{"bridge_id":{"$ref":"#/$defs/Identifier"}},"required":["bridge_id"]};

function validate127(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate127.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.bridge_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "bridge_id"},message:"must have required property '"+"bridge_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "bridge_id")){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.bridge_id !== undefined){
let data0 = data.bridge_id;
if(typeof data0 === "string"){
if(func1(data0) > 64){
const err2 = {instancePath:instancePath+"/bridge_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func1(data0) < 1){
const err3 = {instancePath:instancePath+"/bridge_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern4.test(data0)){
const err4 = {instancePath:instancePath+"/bridge_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
else {
const err5 = {instancePath:instancePath+"/bridge_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
}
else {
const err6 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
validate127.errors = vErrors;
return errors === 0;
}
validate127.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate126(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/EditorCloseInput" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate126.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(!(validate127(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate127.errors : vErrors.concat(validate127.errors);
errors = vErrors.length;
}
validate126.errors = vErrors;
return errors === 0;
}
validate126.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const v_RunQueryKind = validate129;
const schema203 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/RunQueryKind","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/RunQueryKind"};
const schema204 = {"type":"string","enum":["run","history","operation"]};

function validate129(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/RunQueryKind" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate129.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(typeof data !== "string"){
const err0 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/RunQueryKind/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(!(((data === "run") || (data === "history")) || (data === "operation"))){
const err1 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/RunQueryKind/enum",keyword:"enum",params:{allowedValues: schema204.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate129.errors = vErrors;
return errors === 0;
}
validate129.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const v_RunQueryInput = validate130;
const schema205 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/RunQueryInput","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/RunQueryInput"};
const schema206 = {"type":"object","additionalProperties":false,"properties":{"kind":{"$ref":"#/$defs/RunQueryKind"},"workflow_id":{"$ref":"#/$defs/Identifier"},"run_id":{"$ref":"#/$defs/Identifier"},"operation_id":{"$ref":"#/$defs/OperationId"},"cursor":{"type":"string","maxLength":256},"limit":{"type":"integer","minimum":1,"maximum":50,"default":20}},"required":["kind"],"x-operation-field":"kind","x-operation-required":{"run":["workflow_id","run_id"],"history":["workflow_id"],"operation":["operation_id"]},"x-operation-restrict-fields":true,"x-operation-optional":{"history":["cursor","limit"]},"allOf":[{"if":{"properties":{"kind":{"const":"run"}}},"then":{"required":["workflow_id","run_id"],"properties":{"operation_id":false,"cursor":false,"limit":false}}},{"if":{"properties":{"kind":{"const":"history"}}},"then":{"required":["workflow_id"],"properties":{"run_id":false,"operation_id":false}}},{"if":{"properties":{"kind":{"const":"operation"}}},"then":{"required":["operation_id"],"properties":{"workflow_id":false,"run_id":false,"cursor":false,"limit":false}}}]};

function validate131(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate131.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
const _errs2 = errors;
let valid1 = true;
const _errs3 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.kind !== undefined){
if("run" !== data.kind){
const err0 = {};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
}
var _valid0 = _errs3 === errors;
errors = _errs2;
if(vErrors !== null){
if(_errs2){
vErrors.length = _errs2;
}
else {
vErrors = null;
}
}
if(_valid0){
const _errs5 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.workflow_id === undefined){
const err1 = {instancePath,schemaPath:"#/allOf/0/then/required",keyword:"required",params:{missingProperty: "workflow_id"},message:"must have required property '"+"workflow_id"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.run_id === undefined){
const err2 = {instancePath,schemaPath:"#/allOf/0/then/required",keyword:"required",params:{missingProperty: "run_id"},message:"must have required property '"+"run_id"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.operation_id !== undefined){
const err3 = {instancePath:instancePath+"/operation_id",schemaPath:"#/allOf/0/then/properties/operation_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.cursor !== undefined){
const err4 = {instancePath:instancePath+"/cursor",schemaPath:"#/allOf/0/then/properties/cursor/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.limit !== undefined){
const err5 = {instancePath:instancePath+"/limit",schemaPath:"#/allOf/0/then/properties/limit/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
var _valid0 = _errs5 === errors;
valid1 = _valid0;
if(valid1){
var props0 = {};
props0.operation_id = true;
props0.cursor = true;
props0.limit = true;
props0.kind = true;
}
}
if(!valid1){
const err6 = {instancePath,schemaPath:"#/allOf/0/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
const _errs7 = errors;
let valid4 = true;
const _errs8 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.kind !== undefined){
if("history" !== data.kind){
const err7 = {};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
}
var _valid1 = _errs8 === errors;
errors = _errs7;
if(vErrors !== null){
if(_errs7){
vErrors.length = _errs7;
}
else {
vErrors = null;
}
}
if(_valid1){
const _errs10 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.workflow_id === undefined){
const err8 = {instancePath,schemaPath:"#/allOf/1/then/required",keyword:"required",params:{missingProperty: "workflow_id"},message:"must have required property '"+"workflow_id"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data.run_id !== undefined){
const err9 = {instancePath:instancePath+"/run_id",schemaPath:"#/allOf/1/then/properties/run_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data.operation_id !== undefined){
const err10 = {instancePath:instancePath+"/operation_id",schemaPath:"#/allOf/1/then/properties/operation_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
var _valid1 = _errs10 === errors;
valid4 = _valid1;
if(valid4){
var props1 = {};
props1.run_id = true;
props1.operation_id = true;
props1.kind = true;
}
}
if(!valid4){
const err11 = {instancePath,schemaPath:"#/allOf/1/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(props0 !== true && props1 !== undefined){
if(props1 === true){
props0 = true;
}
else {
props0 = props0 || {};
Object.assign(props0, props1);
}
}
const _errs12 = errors;
let valid7 = true;
const _errs13 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.kind !== undefined){
if("operation" !== data.kind){
const err12 = {};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
}
var _valid2 = _errs13 === errors;
errors = _errs12;
if(vErrors !== null){
if(_errs12){
vErrors.length = _errs12;
}
else {
vErrors = null;
}
}
if(_valid2){
const _errs15 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.operation_id === undefined){
const err13 = {instancePath,schemaPath:"#/allOf/2/then/required",keyword:"required",params:{missingProperty: "operation_id"},message:"must have required property '"+"operation_id"+"'"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(data.workflow_id !== undefined){
const err14 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/allOf/2/then/properties/workflow_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(data.run_id !== undefined){
const err15 = {instancePath:instancePath+"/run_id",schemaPath:"#/allOf/2/then/properties/run_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(data.cursor !== undefined){
const err16 = {instancePath:instancePath+"/cursor",schemaPath:"#/allOf/2/then/properties/cursor/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(data.limit !== undefined){
const err17 = {instancePath:instancePath+"/limit",schemaPath:"#/allOf/2/then/properties/limit/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
var _valid2 = _errs15 === errors;
valid7 = _valid2;
if(valid7){
var props2 = {};
props2.workflow_id = true;
props2.run_id = true;
props2.cursor = true;
props2.limit = true;
props2.kind = true;
}
}
if(!valid7){
const err18 = {instancePath,schemaPath:"#/allOf/2/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(props0 !== true && props2 !== undefined){
if(props2 === true){
props0 = true;
}
else {
props0 = props0 || {};
Object.assign(props0, props2);
}
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.kind === undefined){
const err19 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
for(const key0 in data){
if(!((((((key0 === "kind") || (key0 === "workflow_id")) || (key0 === "run_id")) || (key0 === "operation_id")) || (key0 === "cursor")) || (key0 === "limit"))){
const err20 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
if(data.kind !== undefined){
let data12 = data.kind;
if(typeof data12 !== "string"){
const err21 = {instancePath:instancePath+"/kind",schemaPath:"#/$defs/RunQueryKind/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
if(!(((data12 === "run") || (data12 === "history")) || (data12 === "operation"))){
const err22 = {instancePath:instancePath+"/kind",schemaPath:"#/$defs/RunQueryKind/enum",keyword:"enum",params:{allowedValues: schema204.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data.workflow_id !== undefined){
let data13 = data.workflow_id;
if(typeof data13 === "string"){
if(func1(data13) > 64){
const err23 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if(func1(data13) < 1){
const err24 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
if(!pattern4.test(data13)){
const err25 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
else {
const err26 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
if(data.run_id !== undefined){
let data14 = data.run_id;
if(typeof data14 === "string"){
if(func1(data14) > 64){
const err27 = {instancePath:instancePath+"/run_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
if(func1(data14) < 1){
const err28 = {instancePath:instancePath+"/run_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
if(!pattern4.test(data14)){
const err29 = {instancePath:instancePath+"/run_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
else {
const err30 = {instancePath:instancePath+"/run_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
if(data.operation_id !== undefined){
let data15 = data.operation_id;
if(typeof data15 === "string"){
if(func1(data15) > 36){
const err31 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/maxLength",keyword:"maxLength",params:{limit: 36},message:"must NOT have more than 36 characters"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
if(func1(data15) < 36){
const err32 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/minLength",keyword:"minLength",params:{limit: 36},message:"must NOT have fewer than 36 characters"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
if(!pattern5.test(data15)){
const err33 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/pattern",keyword:"pattern",params:{pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},message:"must match pattern \""+"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"+"\""};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
}
else {
const err34 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
}
if(data.cursor !== undefined){
let data16 = data.cursor;
if(typeof data16 === "string"){
if(func1(data16) > 256){
const err35 = {instancePath:instancePath+"/cursor",schemaPath:"#/properties/cursor/maxLength",keyword:"maxLength",params:{limit: 256},message:"must NOT have more than 256 characters"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
}
else {
const err36 = {instancePath:instancePath+"/cursor",schemaPath:"#/properties/cursor/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
}
if(data.limit !== undefined){
let data17 = data.limit;
if(!(((typeof data17 == "number") && (!(data17 % 1) && !isNaN(data17))) && (isFinite(data17)))){
const err37 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
if((typeof data17 == "number") && (isFinite(data17))){
if(data17 > 50 || isNaN(data17)){
const err38 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/maximum",keyword:"maximum",params:{comparison: "<=", limit: 50},message:"must be <= 50"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
if(data17 < 1 || isNaN(data17)){
const err39 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
}
}
}
else {
const err40 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
validate131.errors = vErrors;
return errors === 0;
}
validate131.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate130(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/RunQueryInput" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate130.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(!(validate131(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate131.errors : vErrors.concat(validate131.errors);
errors = vErrors.length;
}
validate130.errors = vErrors;
return errors === 0;
}
validate130.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const v_RunQueryResult = validate133;
const schema211 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/RunQueryResult","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/RunQueryResult"};
const schema212 = {"type":"object","additionalProperties":false,"properties":{"run":{"$ref":"#/$defs/Run"},"history":{"$ref":"#/$defs/RunList"},"receipt":{"$ref":"#/$defs/OperationReceipt"}},"required":[]};

function validate136(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate136.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.items === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "items"},message:"must have required property '"+"items"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!((key0 === "items") || (key0 === "next_cursor"))){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.items !== undefined){
let data0 = data.items;
if(Array.isArray(data0)){
if(data0.length > 50){
const err2 = {instancePath:instancePath+"/items",schemaPath:"#/properties/items/maxItems",keyword:"maxItems",params:{limit: 50},message:"must NOT have more than 50 items"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
const len0 = data0.length;
for(let i0=0; i0<len0; i0++){
if(!(validate80(data0[i0], {instancePath:instancePath+"/items/" + i0,parentData:data0,parentDataProperty:i0,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate80.errors : vErrors.concat(validate80.errors);
errors = vErrors.length;
}
}
}
else {
const err3 = {instancePath:instancePath+"/items",schemaPath:"#/properties/items/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.next_cursor !== undefined){
let data2 = data.next_cursor;
if(typeof data2 === "string"){
if(func1(data2) > 256){
const err4 = {instancePath:instancePath+"/next_cursor",schemaPath:"#/properties/next_cursor/maxLength",keyword:"maxLength",params:{limit: 256},message:"must NOT have more than 256 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
else {
const err5 = {instancePath:instancePath+"/next_cursor",schemaPath:"#/properties/next_cursor/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
}
else {
const err6 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
validate136.errors = vErrors;
return errors === 0;
}
validate136.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate134(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate134.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
for(const key0 in data){
if(!(((key0 === "run") || (key0 === "history")) || (key0 === "receipt"))){
const err0 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
if(data.run !== undefined){
if(!(validate118(data.run, {instancePath:instancePath+"/run",parentData:data,parentDataProperty:"run",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate118.errors : vErrors.concat(validate118.errors);
errors = vErrors.length;
}
}
if(data.history !== undefined){
if(!(validate136(data.history, {instancePath:instancePath+"/history",parentData:data,parentDataProperty:"history",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate136.errors : vErrors.concat(validate136.errors);
errors = vErrors.length;
}
}
if(data.receipt !== undefined){
if(!(validate122(data.receipt, {instancePath:instancePath+"/receipt",parentData:data,parentDataProperty:"receipt",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate122.errors : vErrors.concat(validate122.errors);
errors = vErrors.length;
}
}
}
else {
const err1 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate134.errors = vErrors;
return errors === 0;
}
validate134.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate133(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/RunQueryResult" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate133.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(!(validate134(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate134.errors : vErrors.concat(validate134.errors);
errors = vErrors.length;
}
validate133.errors = vErrors;
return errors === 0;
}
validate133.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const v_CloseResult = validate141;
const schema214 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/CloseResult","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/CloseResult"};
const schema215 = {"type":"object","additionalProperties":false,"properties":{"closed":{"type":"boolean"}},"required":["closed"]};

function validate141(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/CloseResult" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate141.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.closed === undefined){
const err0 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/CloseResult/required",keyword:"required",params:{missingProperty: "closed"},message:"must have required property '"+"closed"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "closed")){
const err1 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/CloseResult/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.closed !== undefined){
if(typeof data.closed !== "boolean"){
const err2 = {instancePath:instancePath+"/closed",schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/CloseResult/properties/closed/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
}
else {
const err3 = {instancePath,schemaPath:"https://schemas.yijie.ai/workflow-local/v1#/$defs/CloseResult/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
validate141.errors = vErrors;
return errors === 0;
}
validate141.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const v_WorkflowSummary = validate142;
const schema216 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/WorkflowSummary","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/WorkflowSummary"};

function validate143(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate143.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.workflow_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "workflow_id"},message:"must have required property '"+"workflow_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.name === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "name"},message:"must have required property '"+"name"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.revision === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "revision"},message:"must have required property '"+"revision"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.runnable === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "runnable"},message:"must have required property '"+"runnable"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.updated_at_ms === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "updated_at_ms"},message:"must have required property '"+"updated_at_ms"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
for(const key0 in data){
if(!(((((((key0 === "workflow_id") || (key0 === "name")) || (key0 === "revision")) || (key0 === "runnable")) || (key0 === "published_version")) || (key0 === "updated_at_ms")) || (key0 === "description"))){
const err5 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.workflow_id !== undefined){
let data0 = data.workflow_id;
if(typeof data0 === "string"){
if(func1(data0) > 64){
const err6 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(func1(data0) < 1){
const err7 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(!pattern4.test(data0)){
const err8 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
else {
const err9 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.name !== undefined){
let data1 = data.name;
if(typeof data1 === "string"){
if(func1(data1) > 80){
const err10 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/maxLength",keyword:"maxLength",params:{limit: 80},message:"must NOT have more than 80 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(func1(data1) < 1){
const err11 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
else {
const err12 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.revision !== undefined){
let data2 = data.revision;
if(typeof data2 === "string"){
if(func1(data2) > 64){
const err13 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(func1(data2) < 1){
const err14 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(!pattern4.test(data2)){
const err15 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
else {
const err16 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data.runnable !== undefined){
if(typeof data.runnable !== "boolean"){
const err17 = {instancePath:instancePath+"/runnable",schemaPath:"#/properties/runnable/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data.published_version !== undefined){
let data4 = data.published_version;
if(typeof data4 === "string"){
if(func1(data4) > 32){
const err18 = {instancePath:instancePath+"/published_version",schemaPath:"#/$defs/Version/maxLength",keyword:"maxLength",params:{limit: 32},message:"must NOT have more than 32 characters"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(!pattern6.test(data4)){
const err19 = {instancePath:instancePath+"/published_version",schemaPath:"#/$defs/Version/pattern",keyword:"pattern",params:{pattern: "^v0[.]0[.][1-9][0-9]*$"},message:"must match pattern \""+"^v0[.]0[.][1-9][0-9]*$"+"\""};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
else {
const err20 = {instancePath:instancePath+"/published_version",schemaPath:"#/$defs/Version/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
if(data.updated_at_ms !== undefined){
let data5 = data.updated_at_ms;
if(!(((typeof data5 == "number") && (!(data5 % 1) && !isNaN(data5))) && (isFinite(data5)))){
const err21 = {instancePath:instancePath+"/updated_at_ms",schemaPath:"#/properties/updated_at_ms/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
if((typeof data5 == "number") && (isFinite(data5))){
if(data5 < 0 || isNaN(data5)){
const err22 = {instancePath:instancePath+"/updated_at_ms",schemaPath:"#/properties/updated_at_ms/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
}
if(data.description !== undefined){
let data6 = data.description;
if(typeof data6 === "string"){
if(func1(data6) > 600){
const err23 = {instancePath:instancePath+"/description",schemaPath:"#/properties/description/maxLength",keyword:"maxLength",params:{limit: 600},message:"must NOT have more than 600 characters"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
else {
const err24 = {instancePath:instancePath+"/description",schemaPath:"#/properties/description/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
}
else {
const err25 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
validate143.errors = vErrors;
return errors === 0;
}
validate143.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate142(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/WorkflowSummary" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate142.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(!(validate143(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate143.errors : vErrors.concat(validate143.errors);
errors = vErrors.length;
}
validate142.errors = vErrors;
return errors === 0;
}
validate142.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const v_RunSummary = validate145;
const schema221 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/RunSummary","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/RunSummary"};

function validate146(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate146.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.run_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "run_id"},message:"must have required property '"+"run_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.workflow_id === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "workflow_id"},message:"must have required property '"+"workflow_id"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.operation_id === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "operation_id"},message:"must have required property '"+"operation_id"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.mode === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "mode"},message:"must have required property '"+"mode"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.state === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "state"},message:"must have required property '"+"state"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.terminal === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "terminal"},message:"must have required property '"+"terminal"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.started_at_ms === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "started_at_ms"},message:"must have required property '"+"started_at_ms"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
for(const key0 in data){
if(!(func82.call(schema123.properties, key0))){
const err7 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.run_id !== undefined){
let data0 = data.run_id;
if(typeof data0 === "string"){
if(func1(data0) > 64){
const err8 = {instancePath:instancePath+"/run_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(func1(data0) < 1){
const err9 = {instancePath:instancePath+"/run_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(!pattern4.test(data0)){
const err10 = {instancePath:instancePath+"/run_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
else {
const err11 = {instancePath:instancePath+"/run_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.workflow_id !== undefined){
let data1 = data.workflow_id;
if(typeof data1 === "string"){
if(func1(data1) > 64){
const err12 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(func1(data1) < 1){
const err13 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(!pattern4.test(data1)){
const err14 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
else {
const err15 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data.operation_id !== undefined){
let data2 = data.operation_id;
if(typeof data2 === "string"){
if(func1(data2) > 36){
const err16 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/maxLength",keyword:"maxLength",params:{limit: 36},message:"must NOT have more than 36 characters"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(func1(data2) < 36){
const err17 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/minLength",keyword:"minLength",params:{limit: 36},message:"must NOT have fewer than 36 characters"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(!pattern5.test(data2)){
const err18 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/pattern",keyword:"pattern",params:{pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},message:"must match pattern \""+"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"+"\""};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
else {
const err19 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data.mode !== undefined){
let data3 = data.mode;
if(typeof data3 !== "string"){
const err20 = {instancePath:instancePath+"/mode",schemaPath:"#/$defs/RunMode/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(!((data3 === "debug") || (data3 === "release"))){
const err21 = {instancePath:instancePath+"/mode",schemaPath:"#/$defs/RunMode/enum",keyword:"enum",params:{allowedValues: schema103.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data.revision !== undefined){
let data4 = data.revision;
if(typeof data4 === "string"){
if(func1(data4) > 64){
const err22 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
if(func1(data4) < 1){
const err23 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if(!pattern4.test(data4)){
const err24 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
else {
const err25 = {instancePath:instancePath+"/revision",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data.version !== undefined){
let data5 = data.version;
if(typeof data5 === "string"){
if(func1(data5) > 32){
const err26 = {instancePath:instancePath+"/version",schemaPath:"#/$defs/Version/maxLength",keyword:"maxLength",params:{limit: 32},message:"must NOT have more than 32 characters"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
if(!pattern6.test(data5)){
const err27 = {instancePath:instancePath+"/version",schemaPath:"#/$defs/Version/pattern",keyword:"pattern",params:{pattern: "^v0[.]0[.][1-9][0-9]*$"},message:"must match pattern \""+"^v0[.]0[.][1-9][0-9]*$"+"\""};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
else {
const err28 = {instancePath:instancePath+"/version",schemaPath:"#/$defs/Version/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
if(data.state !== undefined){
let data6 = data.state;
if(typeof data6 === "string"){
if(func1(data6) > 64){
const err29 = {instancePath:instancePath+"/state",schemaPath:"#/properties/state/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
else {
const err30 = {instancePath:instancePath+"/state",schemaPath:"#/properties/state/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
if(data.terminal !== undefined){
if(typeof data.terminal !== "boolean"){
const err31 = {instancePath:instancePath+"/terminal",schemaPath:"#/properties/terminal/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
}
if(data.started_at_ms !== undefined){
let data8 = data.started_at_ms;
if(!(((typeof data8 == "number") && (!(data8 % 1) && !isNaN(data8))) && (isFinite(data8)))){
const err32 = {instancePath:instancePath+"/started_at_ms",schemaPath:"#/properties/started_at_ms/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
if((typeof data8 == "number") && (isFinite(data8))){
if(data8 < 0 || isNaN(data8)){
const err33 = {instancePath:instancePath+"/started_at_ms",schemaPath:"#/properties/started_at_ms/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
}
}
if(data.finished_at_ms !== undefined){
let data9 = data.finished_at_ms;
if(!(((typeof data9 == "number") && (!(data9 % 1) && !isNaN(data9))) && (isFinite(data9)))){
const err34 = {instancePath:instancePath+"/finished_at_ms",schemaPath:"#/properties/finished_at_ms/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
if((typeof data9 == "number") && (isFinite(data9))){
if(data9 < 0 || isNaN(data9)){
const err35 = {instancePath:instancePath+"/finished_at_ms",schemaPath:"#/properties/finished_at_ms/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
}
}
if(data.error !== undefined){
if(!(validate68(data.error, {instancePath:instancePath+"/error",parentData:data,parentDataProperty:"error",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate68.errors : vErrors.concat(validate68.errors);
errors = vErrors.length;
}
}
}
else {
const err36 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
validate146.errors = vErrors;
return errors === 0;
}
validate146.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate145(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/RunSummary" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate145.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(!(validate146(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate146.errors : vErrors.concat(validate146.errors);
errors = vErrors.length;
}
validate145.errors = vErrors;
return errors === 0;
}
validate145.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const v_DeleteInput = validate149;
const schema229 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/DeleteInput","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/DeleteInput"};
const schema230 = {"type":"object","additionalProperties":false,"properties":{"workflow_id":{"$ref":"#/$defs/Identifier"},"expected_revision":{"$ref":"#/$defs/Identifier"}},"required":["workflow_id","expected_revision"],"description":"Native overview deletion after explicit UI confirmation. The original ID and revision are retained for all retries."};

function validate150(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate150.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.workflow_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "workflow_id"},message:"must have required property '"+"workflow_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.expected_revision === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "expected_revision"},message:"must have required property '"+"expected_revision"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!((key0 === "workflow_id") || (key0 === "expected_revision"))){
const err2 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.workflow_id !== undefined){
let data0 = data.workflow_id;
if(typeof data0 === "string"){
if(func1(data0) > 64){
const err3 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(func1(data0) < 1){
const err4 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(!pattern4.test(data0)){
const err5 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
else {
const err6 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.expected_revision !== undefined){
let data1 = data.expected_revision;
if(typeof data1 === "string"){
if(func1(data1) > 64){
const err7 = {instancePath:instancePath+"/expected_revision",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(func1(data1) < 1){
const err8 = {instancePath:instancePath+"/expected_revision",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(!pattern4.test(data1)){
const err9 = {instancePath:instancePath+"/expected_revision",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
else {
const err10 = {instancePath:instancePath+"/expected_revision",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
}
else {
const err11 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
validate150.errors = vErrors;
return errors === 0;
}
validate150.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate149(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/DeleteInput" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate149.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(!(validate150(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate150.errors : vErrors.concat(validate150.errors);
errors = vErrors.length;
}
validate149.errors = vErrors;
return errors === 0;
}
validate149.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const v_DeleteRequest = validate152;
const schema233 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/DeleteRequest","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/DeleteRequest"};
const schema234 = {"type":"object","additionalProperties":false,"properties":{"expected_revision":{"$ref":"#/$defs/Identifier"}},"required":["expected_revision"],"description":"Idempotent, revision-bound soft deletion. Repeating this exact ID/revision returns the same deletion result. No operation ID or OperationKind extension; audits are per attempt. A changed revision returns revision_conflict and requires a fresh user confirmation. Active execution returns run_busy. No physical graph/version/history deletion."};

function validate153(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate153.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.expected_revision === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "expected_revision"},message:"must have required property '"+"expected_revision"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "expected_revision")){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.expected_revision !== undefined){
let data0 = data.expected_revision;
if(typeof data0 === "string"){
if(func1(data0) > 64){
const err2 = {instancePath:instancePath+"/expected_revision",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func1(data0) < 1){
const err3 = {instancePath:instancePath+"/expected_revision",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern4.test(data0)){
const err4 = {instancePath:instancePath+"/expected_revision",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
else {
const err5 = {instancePath:instancePath+"/expected_revision",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
}
else {
const err6 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
validate153.errors = vErrors;
return errors === 0;
}
validate153.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate152(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/DeleteRequest" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate152.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(!(validate153(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate153.errors : vErrors.concat(validate153.errors);
errors = vErrors.length;
}
validate152.errors = vErrors;
return errors === 0;
}
validate152.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const v_DeleteResult = validate155;
const schema236 = {"$id":"https://schemas.yijie.ai/browser/workflow-local/DeleteResult","$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/DeleteResult"};
const schema237 = {"type":"object","additionalProperties":false,"properties":{"workflow_id":{"$ref":"#/$defs/Identifier"},"deleted":{"type":"boolean","enum":[true]}},"required":["workflow_id","deleted"],"description":"Confirmed soft deletion of the named owned resource. It no longer appears in normal lists and cannot be opened/saved/published/run. Existing API editor sessions are revoked. Durable graph/version/history and ownership rows are retained. Ambiguous failures must retry the original ID/revision, not infer success or change targets."};

function validate156(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate156.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.workflow_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "workflow_id"},message:"must have required property '"+"workflow_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.deleted === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "deleted"},message:"must have required property '"+"deleted"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!((key0 === "workflow_id") || (key0 === "deleted"))){
const err2 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.workflow_id !== undefined){
let data0 = data.workflow_id;
if(typeof data0 === "string"){
if(func1(data0) > 64){
const err3 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(func1(data0) < 1){
const err4 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(!pattern4.test(data0)){
const err5 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
else {
const err6 = {instancePath:instancePath+"/workflow_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.deleted !== undefined){
let data1 = data.deleted;
if(typeof data1 !== "boolean"){
const err7 = {instancePath:instancePath+"/deleted",schemaPath:"#/properties/deleted/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(!(data1 === true)){
const err8 = {instancePath:instancePath+"/deleted",schemaPath:"#/properties/deleted/enum",keyword:"enum",params:{allowedValues: schema237.properties.deleted.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
}
else {
const err9 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
validate156.errors = vErrors;
return errors === 0;
}
validate156.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate155(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/browser/workflow-local/DeleteResult" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate155.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(!(validate156(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate156.errors : vErrors.concat(validate156.errors);
errors = vErrors.length;
}
validate155.errors = vErrors;
return errors === 0;
}
validate155.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const validateBridge = validate158;
const schema239 = {"type":"object","additionalProperties":false,"properties":{"protocol_version":{"const":1},"request_id":{"type":"string","maxLength":64,"minLength":1},"kind":{"type":"string","enum":["connect","ready","request","response","dirty_changed","request_close","request_history"]},"bridge_id":{"type":"string","maxLength":64,"minLength":1},"generation":{"type":"integer","minimum":1},"dirty":{"type":"boolean","description":"当前 editor 页包含离开会失去的本地内容或待确认操作查询上下文。true 包含可保存草稿差异、仅保留于本页内存且尚不支持持久保存的 UI 设计状态、尚待核对的操作上下文；false 表示当前 producer 确认这些保护条件均不存在。此标志只驱动宿主应用内离开确认，不代表内容已发送或已保存、内容可被 save_draft 接受、执行权限、操作终态或原生窗口及应用退出已被拦截。consumer 不得据此自动保存、试运行、发布或取消既有操作。"},"request":{"$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/EditorExchangeInput"},"response":{"$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/EditorExchangeResult"},"error":{"$ref":"https://schemas.yijie.ai/workflow-local/v1#/$defs/ErrorResponse"}},"required":["protocol_version","request_id","kind"],"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"https://schemas.yijie.ai/workflow-editor/bridge-v1.schema.json","title":"WorkflowEditorBridgeV1","description":"Source MessageChannel envelope; data DTOs reference the authoritative workflow-local OpenAPI components.","allOf":[{"if":{"properties":{"kind":{"const":"connect"}}},"then":{"required":["bridge_id","generation"]}},{"if":{"properties":{"kind":{"const":"ready"}}},"then":{"required":["bridge_id","generation"]}},{"if":{"properties":{"kind":{"const":"request"}}},"then":{"required":["bridge_id","generation","request"]}},{"if":{"properties":{"kind":{"const":"response"}}},"then":{"required":["bridge_id","generation"],"oneOf":[{"required":["response"],"not":{"required":["error"]}},{"required":["error"],"not":{"required":["response"]}}]}},{"if":{"properties":{"kind":{"const":"dirty_changed"}}},"then":{"required":["bridge_id","generation","dirty"]},"description":"只作用于当前已 ready 的 port、bridge_id 和 generation；重连必须重新发送当前保护值，切换连接不能清空仍存在的保护条件。保护位不用于阻止用户明确运行已有的服务端发布版本。"},{"if":{"properties":{"kind":{"const":"request_close"}}},"then":{"required":["bridge_id","generation"]},"description":"请求宿主尝试应用内页面导航，由宿主统一确认本页内容处置并正常关闭编辑会话；请求本身不保存内容、不取消既有操作，也不保证原生窗口或应用退出被拦截。"},{"if":{"properties":{"kind":{"const":"request_history"}}},"then":{"required":["bridge_id","generation"],"properties":{"dirty":false,"request":false,"response":false,"error":false}},"description":"请求在当前页面打开已有历史面板；不离开或替换当前编辑图，不隐含保存或执行操作。"}]};

function validate159(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate159.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
const _errs2 = errors;
let valid1 = true;
const _errs3 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.operation !== undefined){
if("bootstrap" !== data.operation){
const err0 = {};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
}
var _valid0 = _errs3 === errors;
errors = _errs2;
if(vErrors !== null){
if(_errs2){
vErrors.length = _errs2;
}
else {
vErrors = null;
}
}
if(_valid0){
const _errs5 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.expected_revision !== undefined){
const err1 = {instancePath:instancePath+"/expected_revision",schemaPath:"#/allOf/0/then/properties/expected_revision/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.name !== undefined){
const err2 = {instancePath:instancePath+"/name",schemaPath:"#/allOf/0/then/properties/name/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.canvas !== undefined){
const err3 = {instancePath:instancePath+"/canvas",schemaPath:"#/allOf/0/then/properties/canvas/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.input !== undefined){
const err4 = {instancePath:instancePath+"/input",schemaPath:"#/allOf/0/then/properties/input/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.successful_test_run_id !== undefined){
const err5 = {instancePath:instancePath+"/successful_test_run_id",schemaPath:"#/allOf/0/then/properties/successful_test_run_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.run_id !== undefined){
const err6 = {instancePath:instancePath+"/run_id",schemaPath:"#/allOf/0/then/properties/run_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data.operation_id !== undefined){
const err7 = {instancePath:instancePath+"/operation_id",schemaPath:"#/allOf/0/then/properties/operation_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
var _valid0 = _errs5 === errors;
valid1 = _valid0;
if(valid1){
var props0 = {};
props0.expected_revision = true;
props0.name = true;
props0.canvas = true;
props0.input = true;
props0.successful_test_run_id = true;
props0.run_id = true;
props0.operation_id = true;
props0.operation = true;
}
}
if(!valid1){
const err8 = {instancePath,schemaPath:"#/allOf/0/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
const _errs7 = errors;
let valid4 = true;
const _errs8 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.operation !== undefined){
if("read_draft" !== data.operation){
const err9 = {};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
}
var _valid1 = _errs8 === errors;
errors = _errs7;
if(vErrors !== null){
if(_errs7){
vErrors.length = _errs7;
}
else {
vErrors = null;
}
}
if(_valid1){
const _errs10 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.expected_revision !== undefined){
const err10 = {instancePath:instancePath+"/expected_revision",schemaPath:"#/allOf/1/then/properties/expected_revision/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data.name !== undefined){
const err11 = {instancePath:instancePath+"/name",schemaPath:"#/allOf/1/then/properties/name/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(data.canvas !== undefined){
const err12 = {instancePath:instancePath+"/canvas",schemaPath:"#/allOf/1/then/properties/canvas/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(data.input !== undefined){
const err13 = {instancePath:instancePath+"/input",schemaPath:"#/allOf/1/then/properties/input/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(data.successful_test_run_id !== undefined){
const err14 = {instancePath:instancePath+"/successful_test_run_id",schemaPath:"#/allOf/1/then/properties/successful_test_run_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(data.run_id !== undefined){
const err15 = {instancePath:instancePath+"/run_id",schemaPath:"#/allOf/1/then/properties/run_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(data.operation_id !== undefined){
const err16 = {instancePath:instancePath+"/operation_id",schemaPath:"#/allOf/1/then/properties/operation_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
var _valid1 = _errs10 === errors;
valid4 = _valid1;
if(valid4){
var props1 = {};
props1.expected_revision = true;
props1.name = true;
props1.canvas = true;
props1.input = true;
props1.successful_test_run_id = true;
props1.run_id = true;
props1.operation_id = true;
props1.operation = true;
}
}
if(!valid4){
const err17 = {instancePath,schemaPath:"#/allOf/1/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(props0 !== true && props1 !== undefined){
if(props1 === true){
props0 = true;
}
else {
props0 = props0 || {};
Object.assign(props0, props1);
}
}
const _errs12 = errors;
let valid7 = true;
const _errs13 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.operation !== undefined){
if("save_draft" !== data.operation){
const err18 = {};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
}
var _valid2 = _errs13 === errors;
errors = _errs12;
if(vErrors !== null){
if(_errs12){
vErrors.length = _errs12;
}
else {
vErrors = null;
}
}
if(_valid2){
const _errs15 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.expected_revision === undefined){
const err19 = {instancePath,schemaPath:"#/allOf/2/then/required",keyword:"required",params:{missingProperty: "expected_revision"},message:"must have required property '"+"expected_revision"+"'"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
if(data.name === undefined){
const err20 = {instancePath,schemaPath:"#/allOf/2/then/required",keyword:"required",params:{missingProperty: "name"},message:"must have required property '"+"name"+"'"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(data.canvas === undefined){
const err21 = {instancePath,schemaPath:"#/allOf/2/then/required",keyword:"required",params:{missingProperty: "canvas"},message:"must have required property '"+"canvas"+"'"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
if(data.input !== undefined){
const err22 = {instancePath:instancePath+"/input",schemaPath:"#/allOf/2/then/properties/input/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
if(data.successful_test_run_id !== undefined){
const err23 = {instancePath:instancePath+"/successful_test_run_id",schemaPath:"#/allOf/2/then/properties/successful_test_run_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if(data.run_id !== undefined){
const err24 = {instancePath:instancePath+"/run_id",schemaPath:"#/allOf/2/then/properties/run_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
if(data.operation_id !== undefined){
const err25 = {instancePath:instancePath+"/operation_id",schemaPath:"#/allOf/2/then/properties/operation_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
var _valid2 = _errs15 === errors;
valid7 = _valid2;
if(valid7){
var props2 = {};
props2.input = true;
props2.successful_test_run_id = true;
props2.run_id = true;
props2.operation_id = true;
props2.operation = true;
}
}
if(!valid7){
const err26 = {instancePath,schemaPath:"#/allOf/2/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
if(props0 !== true && props2 !== undefined){
if(props2 === true){
props0 = true;
}
else {
props0 = props0 || {};
Object.assign(props0, props2);
}
}
const _errs17 = errors;
let valid10 = true;
const _errs18 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.operation !== undefined){
if("test_draft" !== data.operation){
const err27 = {};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
}
var _valid3 = _errs18 === errors;
errors = _errs17;
if(vErrors !== null){
if(_errs17){
vErrors.length = _errs17;
}
else {
vErrors = null;
}
}
if(_valid3){
const _errs20 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.expected_revision === undefined){
const err28 = {instancePath,schemaPath:"#/allOf/3/then/required",keyword:"required",params:{missingProperty: "expected_revision"},message:"must have required property '"+"expected_revision"+"'"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
if(data.input === undefined){
const err29 = {instancePath,schemaPath:"#/allOf/3/then/required",keyword:"required",params:{missingProperty: "input"},message:"must have required property '"+"input"+"'"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
if(data.name !== undefined){
const err30 = {instancePath:instancePath+"/name",schemaPath:"#/allOf/3/then/properties/name/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
if(data.canvas !== undefined){
const err31 = {instancePath:instancePath+"/canvas",schemaPath:"#/allOf/3/then/properties/canvas/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
if(data.successful_test_run_id !== undefined){
const err32 = {instancePath:instancePath+"/successful_test_run_id",schemaPath:"#/allOf/3/then/properties/successful_test_run_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
if(data.run_id !== undefined){
const err33 = {instancePath:instancePath+"/run_id",schemaPath:"#/allOf/3/then/properties/run_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
if(data.operation_id !== undefined){
const err34 = {instancePath:instancePath+"/operation_id",schemaPath:"#/allOf/3/then/properties/operation_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
}
var _valid3 = _errs20 === errors;
valid10 = _valid3;
if(valid10){
var props3 = {};
props3.name = true;
props3.canvas = true;
props3.successful_test_run_id = true;
props3.run_id = true;
props3.operation_id = true;
props3.operation = true;
}
}
if(!valid10){
const err35 = {instancePath,schemaPath:"#/allOf/3/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
if(props0 !== true && props3 !== undefined){
if(props3 === true){
props0 = true;
}
else {
props0 = props0 || {};
Object.assign(props0, props3);
}
}
const _errs22 = errors;
let valid13 = true;
const _errs23 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.operation !== undefined){
if("publish_internal" !== data.operation){
const err36 = {};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
}
}
var _valid4 = _errs23 === errors;
errors = _errs22;
if(vErrors !== null){
if(_errs22){
vErrors.length = _errs22;
}
else {
vErrors = null;
}
}
if(_valid4){
const _errs25 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.expected_revision === undefined){
const err37 = {instancePath,schemaPath:"#/allOf/4/then/required",keyword:"required",params:{missingProperty: "expected_revision"},message:"must have required property '"+"expected_revision"+"'"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
if(data.successful_test_run_id === undefined){
const err38 = {instancePath,schemaPath:"#/allOf/4/then/required",keyword:"required",params:{missingProperty: "successful_test_run_id"},message:"must have required property '"+"successful_test_run_id"+"'"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
if(data.name !== undefined){
const err39 = {instancePath:instancePath+"/name",schemaPath:"#/allOf/4/then/properties/name/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
if(data.canvas !== undefined){
const err40 = {instancePath:instancePath+"/canvas",schemaPath:"#/allOf/4/then/properties/canvas/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
if(data.input !== undefined){
const err41 = {instancePath:instancePath+"/input",schemaPath:"#/allOf/4/then/properties/input/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
if(data.run_id !== undefined){
const err42 = {instancePath:instancePath+"/run_id",schemaPath:"#/allOf/4/then/properties/run_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
if(data.operation_id !== undefined){
const err43 = {instancePath:instancePath+"/operation_id",schemaPath:"#/allOf/4/then/properties/operation_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
}
var _valid4 = _errs25 === errors;
valid13 = _valid4;
if(valid13){
var props4 = {};
props4.name = true;
props4.canvas = true;
props4.input = true;
props4.run_id = true;
props4.operation_id = true;
props4.operation = true;
}
}
if(!valid13){
const err44 = {instancePath,schemaPath:"#/allOf/4/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
}
if(props0 !== true && props4 !== undefined){
if(props4 === true){
props0 = true;
}
else {
props0 = props0 || {};
Object.assign(props0, props4);
}
}
const _errs27 = errors;
let valid16 = true;
const _errs28 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.operation !== undefined){
if("read_run" !== data.operation){
const err45 = {};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
}
}
var _valid5 = _errs28 === errors;
errors = _errs27;
if(vErrors !== null){
if(_errs27){
vErrors.length = _errs27;
}
else {
vErrors = null;
}
}
if(_valid5){
const _errs30 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.run_id === undefined){
const err46 = {instancePath,schemaPath:"#/allOf/5/then/required",keyword:"required",params:{missingProperty: "run_id"},message:"must have required property '"+"run_id"+"'"};
if(vErrors === null){
vErrors = [err46];
}
else {
vErrors.push(err46);
}
errors++;
}
if(data.expected_revision !== undefined){
const err47 = {instancePath:instancePath+"/expected_revision",schemaPath:"#/allOf/5/then/properties/expected_revision/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err47];
}
else {
vErrors.push(err47);
}
errors++;
}
if(data.name !== undefined){
const err48 = {instancePath:instancePath+"/name",schemaPath:"#/allOf/5/then/properties/name/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err48];
}
else {
vErrors.push(err48);
}
errors++;
}
if(data.canvas !== undefined){
const err49 = {instancePath:instancePath+"/canvas",schemaPath:"#/allOf/5/then/properties/canvas/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err49];
}
else {
vErrors.push(err49);
}
errors++;
}
if(data.input !== undefined){
const err50 = {instancePath:instancePath+"/input",schemaPath:"#/allOf/5/then/properties/input/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err50];
}
else {
vErrors.push(err50);
}
errors++;
}
if(data.successful_test_run_id !== undefined){
const err51 = {instancePath:instancePath+"/successful_test_run_id",schemaPath:"#/allOf/5/then/properties/successful_test_run_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err51];
}
else {
vErrors.push(err51);
}
errors++;
}
if(data.operation_id !== undefined){
const err52 = {instancePath:instancePath+"/operation_id",schemaPath:"#/allOf/5/then/properties/operation_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err52];
}
else {
vErrors.push(err52);
}
errors++;
}
}
var _valid5 = _errs30 === errors;
valid16 = _valid5;
if(valid16){
var props5 = {};
props5.expected_revision = true;
props5.name = true;
props5.canvas = true;
props5.input = true;
props5.successful_test_run_id = true;
props5.operation_id = true;
props5.operation = true;
}
}
if(!valid16){
const err53 = {instancePath,schemaPath:"#/allOf/5/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err53];
}
else {
vErrors.push(err53);
}
errors++;
}
if(props0 !== true && props5 !== undefined){
if(props5 === true){
props0 = true;
}
else {
props0 = props0 || {};
Object.assign(props0, props5);
}
}
const _errs32 = errors;
let valid19 = true;
const _errs33 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.operation !== undefined){
if("read_operation" !== data.operation){
const err54 = {};
if(vErrors === null){
vErrors = [err54];
}
else {
vErrors.push(err54);
}
errors++;
}
}
}
var _valid6 = _errs33 === errors;
errors = _errs32;
if(vErrors !== null){
if(_errs32){
vErrors.length = _errs32;
}
else {
vErrors = null;
}
}
if(_valid6){
const _errs35 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.operation_id === undefined){
const err55 = {instancePath,schemaPath:"#/allOf/6/then/required",keyword:"required",params:{missingProperty: "operation_id"},message:"must have required property '"+"operation_id"+"'"};
if(vErrors === null){
vErrors = [err55];
}
else {
vErrors.push(err55);
}
errors++;
}
if(data.expected_revision !== undefined){
const err56 = {instancePath:instancePath+"/expected_revision",schemaPath:"#/allOf/6/then/properties/expected_revision/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err56];
}
else {
vErrors.push(err56);
}
errors++;
}
if(data.name !== undefined){
const err57 = {instancePath:instancePath+"/name",schemaPath:"#/allOf/6/then/properties/name/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err57];
}
else {
vErrors.push(err57);
}
errors++;
}
if(data.canvas !== undefined){
const err58 = {instancePath:instancePath+"/canvas",schemaPath:"#/allOf/6/then/properties/canvas/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err58];
}
else {
vErrors.push(err58);
}
errors++;
}
if(data.input !== undefined){
const err59 = {instancePath:instancePath+"/input",schemaPath:"#/allOf/6/then/properties/input/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err59];
}
else {
vErrors.push(err59);
}
errors++;
}
if(data.successful_test_run_id !== undefined){
const err60 = {instancePath:instancePath+"/successful_test_run_id",schemaPath:"#/allOf/6/then/properties/successful_test_run_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err60];
}
else {
vErrors.push(err60);
}
errors++;
}
if(data.run_id !== undefined){
const err61 = {instancePath:instancePath+"/run_id",schemaPath:"#/allOf/6/then/properties/run_id/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err61];
}
else {
vErrors.push(err61);
}
errors++;
}
}
var _valid6 = _errs35 === errors;
valid19 = _valid6;
if(valid19){
var props6 = {};
props6.expected_revision = true;
props6.name = true;
props6.canvas = true;
props6.input = true;
props6.successful_test_run_id = true;
props6.run_id = true;
props6.operation = true;
}
}
if(!valid19){
const err62 = {instancePath,schemaPath:"#/allOf/6/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err62];
}
else {
vErrors.push(err62);
}
errors++;
}
if(props0 !== true && props6 !== undefined){
if(props6 === true){
props0 = true;
}
else {
props0 = props0 || {};
Object.assign(props0, props6);
}
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.bridge_id === undefined){
const err63 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "bridge_id"},message:"must have required property '"+"bridge_id"+"'"};
if(vErrors === null){
vErrors = [err63];
}
else {
vErrors.push(err63);
}
errors++;
}
if(data.generation === undefined){
const err64 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "generation"},message:"must have required property '"+"generation"+"'"};
if(vErrors === null){
vErrors = [err64];
}
else {
vErrors.push(err64);
}
errors++;
}
if(data.protocol_version === undefined){
const err65 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "protocol_version"},message:"must have required property '"+"protocol_version"+"'"};
if(vErrors === null){
vErrors = [err65];
}
else {
vErrors.push(err65);
}
errors++;
}
if(data.request_id === undefined){
const err66 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "request_id"},message:"must have required property '"+"request_id"+"'"};
if(vErrors === null){
vErrors = [err66];
}
else {
vErrors.push(err66);
}
errors++;
}
if(data.operation === undefined){
const err67 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "operation"},message:"must have required property '"+"operation"+"'"};
if(vErrors === null){
vErrors = [err67];
}
else {
vErrors.push(err67);
}
errors++;
}
for(const key0 in data){
if(!(func82.call(schema169.properties, key0))){
const err68 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err68];
}
else {
vErrors.push(err68);
}
errors++;
}
}
if(data.bridge_id !== undefined){
let data47 = data.bridge_id;
if(typeof data47 === "string"){
if(func1(data47) > 64){
const err69 = {instancePath:instancePath+"/bridge_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err69];
}
else {
vErrors.push(err69);
}
errors++;
}
if(func1(data47) < 1){
const err70 = {instancePath:instancePath+"/bridge_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err70];
}
else {
vErrors.push(err70);
}
errors++;
}
if(!pattern4.test(data47)){
const err71 = {instancePath:instancePath+"/bridge_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err71];
}
else {
vErrors.push(err71);
}
errors++;
}
}
else {
const err72 = {instancePath:instancePath+"/bridge_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err72];
}
else {
vErrors.push(err72);
}
errors++;
}
}
if(data.generation !== undefined){
let data48 = data.generation;
if(!(((typeof data48 == "number") && (!(data48 % 1) && !isNaN(data48))) && (isFinite(data48)))){
const err73 = {instancePath:instancePath+"/generation",schemaPath:"#/properties/generation/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err73];
}
else {
vErrors.push(err73);
}
errors++;
}
if((typeof data48 == "number") && (isFinite(data48))){
if(data48 < 1 || isNaN(data48)){
const err74 = {instancePath:instancePath+"/generation",schemaPath:"#/properties/generation/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err74];
}
else {
vErrors.push(err74);
}
errors++;
}
}
}
if(data.protocol_version !== undefined){
let data49 = data.protocol_version;
if(!(((typeof data49 == "number") && (!(data49 % 1) && !isNaN(data49))) && (isFinite(data49)))){
const err75 = {instancePath:instancePath+"/protocol_version",schemaPath:"#/properties/protocol_version/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err75];
}
else {
vErrors.push(err75);
}
errors++;
}
if(!(data49 === 1)){
const err76 = {instancePath:instancePath+"/protocol_version",schemaPath:"#/properties/protocol_version/enum",keyword:"enum",params:{allowedValues: schema169.properties.protocol_version.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err76];
}
else {
vErrors.push(err76);
}
errors++;
}
}
if(data.request_id !== undefined){
let data50 = data.request_id;
if(typeof data50 === "string"){
if(func1(data50) > 64){
const err77 = {instancePath:instancePath+"/request_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err77];
}
else {
vErrors.push(err77);
}
errors++;
}
if(func1(data50) < 1){
const err78 = {instancePath:instancePath+"/request_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err78];
}
else {
vErrors.push(err78);
}
errors++;
}
if(!pattern4.test(data50)){
const err79 = {instancePath:instancePath+"/request_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err79];
}
else {
vErrors.push(err79);
}
errors++;
}
}
else {
const err80 = {instancePath:instancePath+"/request_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err80];
}
else {
vErrors.push(err80);
}
errors++;
}
}
if(data.operation !== undefined){
let data51 = data.operation;
if(typeof data51 !== "string"){
const err81 = {instancePath:instancePath+"/operation",schemaPath:"#/$defs/EditorOperation/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err81];
}
else {
vErrors.push(err81);
}
errors++;
}
if(!(((((((data51 === "bootstrap") || (data51 === "read_draft")) || (data51 === "save_draft")) || (data51 === "test_draft")) || (data51 === "publish_internal")) || (data51 === "read_run")) || (data51 === "read_operation"))){
const err82 = {instancePath:instancePath+"/operation",schemaPath:"#/$defs/EditorOperation/enum",keyword:"enum",params:{allowedValues: schema167.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err82];
}
else {
vErrors.push(err82);
}
errors++;
}
}
if(data.expected_revision !== undefined){
let data52 = data.expected_revision;
if(typeof data52 === "string"){
if(func1(data52) > 64){
const err83 = {instancePath:instancePath+"/expected_revision",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err83];
}
else {
vErrors.push(err83);
}
errors++;
}
if(func1(data52) < 1){
const err84 = {instancePath:instancePath+"/expected_revision",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err84];
}
else {
vErrors.push(err84);
}
errors++;
}
if(!pattern4.test(data52)){
const err85 = {instancePath:instancePath+"/expected_revision",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err85];
}
else {
vErrors.push(err85);
}
errors++;
}
}
else {
const err86 = {instancePath:instancePath+"/expected_revision",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err86];
}
else {
vErrors.push(err86);
}
errors++;
}
}
if(data.name !== undefined){
let data53 = data.name;
if(typeof data53 === "string"){
if(func1(data53) > 80){
const err87 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/maxLength",keyword:"maxLength",params:{limit: 80},message:"must NOT have more than 80 characters"};
if(vErrors === null){
vErrors = [err87];
}
else {
vErrors.push(err87);
}
errors++;
}
if(func1(data53) < 1){
const err88 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err88];
}
else {
vErrors.push(err88);
}
errors++;
}
}
else {
const err89 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err89];
}
else {
vErrors.push(err89);
}
errors++;
}
}
if(data.canvas !== undefined){
let data54 = data.canvas;
if(typeof data54 === "string"){
if(func1(data54) > 262144){
const err90 = {instancePath:instancePath+"/canvas",schemaPath:"#/properties/canvas/maxLength",keyword:"maxLength",params:{limit: 262144},message:"must NOT have more than 262144 characters"};
if(vErrors === null){
vErrors = [err90];
}
else {
vErrors.push(err90);
}
errors++;
}
if(new TextEncoder().encode(data54).length > 262144){
const err91 = {instancePath:instancePath+"/canvas",schemaPath:"#/properties/canvas/x-utf8-max-bytes",keyword:"x-utf8-max-bytes",params:{},message:"must pass \"x-utf8-max-bytes\" keyword validation"};
if(vErrors === null){
vErrors = [err91];
}
else {
vErrors.push(err91);
}
errors++;
}
}
else {
const err92 = {instancePath:instancePath+"/canvas",schemaPath:"#/properties/canvas/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err92];
}
else {
vErrors.push(err92);
}
errors++;
}
}
if(data.input !== undefined){
let data55 = data.input;
if(data55 && typeof data55 == "object" && !Array.isArray(data55)){
if(data55.input === undefined){
const err93 = {instancePath:instancePath+"/input",schemaPath:"#/$defs/TextInput/required",keyword:"required",params:{missingProperty: "input"},message:"must have required property '"+"input"+"'"};
if(vErrors === null){
vErrors = [err93];
}
else {
vErrors.push(err93);
}
errors++;
}
for(const key1 in data55){
if(!(key1 === "input")){
const err94 = {instancePath:instancePath+"/input",schemaPath:"#/$defs/TextInput/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err94];
}
else {
vErrors.push(err94);
}
errors++;
}
}
if(data55.input !== undefined){
let data56 = data55.input;
if(typeof data56 === "string"){
if(func1(data56) > 4096){
const err95 = {instancePath:instancePath+"/input/input",schemaPath:"#/$defs/TextInput/properties/input/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err95];
}
else {
vErrors.push(err95);
}
errors++;
}
if(new TextEncoder().encode(data56).length > 4096){
const err96 = {instancePath:instancePath+"/input/input",schemaPath:"#/$defs/TextInput/properties/input/x-utf8-max-bytes",keyword:"x-utf8-max-bytes",params:{},message:"must pass \"x-utf8-max-bytes\" keyword validation"};
if(vErrors === null){
vErrors = [err96];
}
else {
vErrors.push(err96);
}
errors++;
}
}
else {
const err97 = {instancePath:instancePath+"/input/input",schemaPath:"#/$defs/TextInput/properties/input/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err97];
}
else {
vErrors.push(err97);
}
errors++;
}
}
}
else {
const err98 = {instancePath:instancePath+"/input",schemaPath:"#/$defs/TextInput/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err98];
}
else {
vErrors.push(err98);
}
errors++;
}
}
if(data.successful_test_run_id !== undefined){
let data57 = data.successful_test_run_id;
if(typeof data57 === "string"){
if(func1(data57) > 64){
const err99 = {instancePath:instancePath+"/successful_test_run_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err99];
}
else {
vErrors.push(err99);
}
errors++;
}
if(func1(data57) < 1){
const err100 = {instancePath:instancePath+"/successful_test_run_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err100];
}
else {
vErrors.push(err100);
}
errors++;
}
if(!pattern4.test(data57)){
const err101 = {instancePath:instancePath+"/successful_test_run_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err101];
}
else {
vErrors.push(err101);
}
errors++;
}
}
else {
const err102 = {instancePath:instancePath+"/successful_test_run_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err102];
}
else {
vErrors.push(err102);
}
errors++;
}
}
if(data.run_id !== undefined){
let data58 = data.run_id;
if(typeof data58 === "string"){
if(func1(data58) > 64){
const err103 = {instancePath:instancePath+"/run_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err103];
}
else {
vErrors.push(err103);
}
errors++;
}
if(func1(data58) < 1){
const err104 = {instancePath:instancePath+"/run_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err104];
}
else {
vErrors.push(err104);
}
errors++;
}
if(!pattern4.test(data58)){
const err105 = {instancePath:instancePath+"/run_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err105];
}
else {
vErrors.push(err105);
}
errors++;
}
}
else {
const err106 = {instancePath:instancePath+"/run_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err106];
}
else {
vErrors.push(err106);
}
errors++;
}
}
if(data.operation_id !== undefined){
let data59 = data.operation_id;
if(typeof data59 === "string"){
if(func1(data59) > 36){
const err107 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/maxLength",keyword:"maxLength",params:{limit: 36},message:"must NOT have more than 36 characters"};
if(vErrors === null){
vErrors = [err107];
}
else {
vErrors.push(err107);
}
errors++;
}
if(func1(data59) < 36){
const err108 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/minLength",keyword:"minLength",params:{limit: 36},message:"must NOT have fewer than 36 characters"};
if(vErrors === null){
vErrors = [err108];
}
else {
vErrors.push(err108);
}
errors++;
}
if(!pattern5.test(data59)){
const err109 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/pattern",keyword:"pattern",params:{pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},message:"must match pattern \""+"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"+"\""};
if(vErrors === null){
vErrors = [err109];
}
else {
vErrors.push(err109);
}
errors++;
}
}
else {
const err110 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err110];
}
else {
vErrors.push(err110);
}
errors++;
}
}
}
else {
const err111 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err111];
}
else {
vErrors.push(err111);
}
errors++;
}
validate159.errors = vErrors;
return errors === 0;
}
validate159.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate161(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate161.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.request_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "request_id"},message:"must have required property '"+"request_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!((((((key0 === "request_id") || (key0 === "operation_id")) || (key0 === "bootstrap")) || (key0 === "workflow")) || (key0 === "run")) || (key0 === "receipt"))){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.request_id !== undefined){
let data0 = data.request_id;
if(typeof data0 === "string"){
if(func1(data0) > 64){
const err2 = {instancePath:instancePath+"/request_id",schemaPath:"#/$defs/Identifier/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func1(data0) < 1){
const err3 = {instancePath:instancePath+"/request_id",schemaPath:"#/$defs/Identifier/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!pattern4.test(data0)){
const err4 = {instancePath:instancePath+"/request_id",schemaPath:"#/$defs/Identifier/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9_-]+$"},message:"must match pattern \""+"^[A-Za-z0-9_-]+$"+"\""};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
else {
const err5 = {instancePath:instancePath+"/request_id",schemaPath:"#/$defs/Identifier/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.operation_id !== undefined){
let data1 = data.operation_id;
if(typeof data1 === "string"){
if(func1(data1) > 36){
const err6 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/maxLength",keyword:"maxLength",params:{limit: 36},message:"must NOT have more than 36 characters"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(func1(data1) < 36){
const err7 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/minLength",keyword:"minLength",params:{limit: 36},message:"must NOT have fewer than 36 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(!pattern5.test(data1)){
const err8 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/pattern",keyword:"pattern",params:{pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},message:"must match pattern \""+"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"+"\""};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
else {
const err9 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.bootstrap !== undefined){
if(!(validate113(data.bootstrap, {instancePath:instancePath+"/bootstrap",parentData:data,parentDataProperty:"bootstrap",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate113.errors : vErrors.concat(validate113.errors);
errors = vErrors.length;
}
}
if(data.workflow !== undefined){
if(!(validate98(data.workflow, {instancePath:instancePath+"/workflow",parentData:data,parentDataProperty:"workflow",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate98.errors : vErrors.concat(validate98.errors);
errors = vErrors.length;
}
}
if(data.run !== undefined){
if(!(validate118(data.run, {instancePath:instancePath+"/run",parentData:data,parentDataProperty:"run",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate118.errors : vErrors.concat(validate118.errors);
errors = vErrors.length;
}
}
if(data.receipt !== undefined){
if(!(validate122(data.receipt, {instancePath:instancePath+"/receipt",parentData:data,parentDataProperty:"receipt",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate122.errors : vErrors.concat(validate122.errors);
errors = vErrors.length;
}
}
}
else {
const err10 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
validate161.errors = vErrors;
return errors === 0;
}
validate161.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate167(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate167.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.code === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "code"},message:"must have required property '"+"code"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.message === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "message"},message:"must have required property '"+"message"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "code") || (key0 === "message")) || (key0 === "operation_id"))){
const err2 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.code !== undefined){
let data0 = data.code;
if(typeof data0 !== "string"){
const err3 = {instancePath:instancePath+"/code",schemaPath:"#/$defs/ErrorCode/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(!(((((((((((((((data0 === "profile_disabled") || (data0 === "service_unavailable")) || (data0 === "unauthorized")) || (data0 === "session_expired")) || (data0 === "resource_not_found")) || (data0 === "revision_conflict")) || (data0 === "operation_conflict")) || (data0 === "invalid_draft")) || (data0 === "input_too_large")) || (data0 === "run_busy")) || (data0 === "operation_unknown")) || (data0 === "protocol_mismatch")) || (data0 === "invalid_request")) || (data0 === "storage_unavailable")) || (data0 === "internal_error"))){
const err4 = {instancePath:instancePath+"/code",schemaPath:"#/$defs/ErrorCode/enum",keyword:"enum",params:{allowedValues: schema41.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.message !== undefined){
let data1 = data.message;
if(typeof data1 === "string"){
if(func1(data1) > 160){
const err5 = {instancePath:instancePath+"/message",schemaPath:"#/properties/message/maxLength",keyword:"maxLength",params:{limit: 160},message:"must NOT have more than 160 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
else {
const err6 = {instancePath:instancePath+"/message",schemaPath:"#/properties/message/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.operation_id !== undefined){
let data2 = data.operation_id;
if(typeof data2 === "string"){
if(func1(data2) > 36){
const err7 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/maxLength",keyword:"maxLength",params:{limit: 36},message:"must NOT have more than 36 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(func1(data2) < 36){
const err8 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/minLength",keyword:"minLength",params:{limit: 36},message:"must NOT have fewer than 36 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(!pattern5.test(data2)){
const err9 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/pattern",keyword:"pattern",params:{pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},message:"must match pattern \""+"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"+"\""};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
else {
const err10 = {instancePath:instancePath+"/operation_id",schemaPath:"#/$defs/OperationId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
}
else {
const err11 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
validate167.errors = vErrors;
return errors === 0;
}
validate167.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate158(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://schemas.yijie.ai/workflow-editor/bridge-v1.schema.json" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate158.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
const _errs2 = errors;
let valid1 = true;
const _errs3 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.kind !== undefined){
if("connect" !== data.kind){
const err0 = {};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
}
var _valid0 = _errs3 === errors;
errors = _errs2;
if(vErrors !== null){
if(_errs2){
vErrors.length = _errs2;
}
else {
vErrors = null;
}
}
if(_valid0){
const _errs5 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.bridge_id === undefined){
const err1 = {instancePath,schemaPath:"#/allOf/0/then/required",keyword:"required",params:{missingProperty: "bridge_id"},message:"must have required property '"+"bridge_id"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.generation === undefined){
const err2 = {instancePath,schemaPath:"#/allOf/0/then/required",keyword:"required",params:{missingProperty: "generation"},message:"must have required property '"+"generation"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
var _valid0 = _errs5 === errors;
valid1 = _valid0;
}
if(!valid1){
const err3 = {instancePath,schemaPath:"#/allOf/0/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
const _errs7 = errors;
let valid3 = true;
const _errs8 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.kind !== undefined){
if("ready" !== data.kind){
const err4 = {};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
}
var _valid1 = _errs8 === errors;
errors = _errs7;
if(vErrors !== null){
if(_errs7){
vErrors.length = _errs7;
}
else {
vErrors = null;
}
}
if(_valid1){
const _errs10 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.bridge_id === undefined){
const err5 = {instancePath,schemaPath:"#/allOf/1/then/required",keyword:"required",params:{missingProperty: "bridge_id"},message:"must have required property '"+"bridge_id"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.generation === undefined){
const err6 = {instancePath,schemaPath:"#/allOf/1/then/required",keyword:"required",params:{missingProperty: "generation"},message:"must have required property '"+"generation"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
var _valid1 = _errs10 === errors;
valid3 = _valid1;
}
if(!valid3){
const err7 = {instancePath,schemaPath:"#/allOf/1/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
const _errs12 = errors;
let valid5 = true;
const _errs13 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.kind !== undefined){
if("request" !== data.kind){
const err8 = {};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
}
var _valid2 = _errs13 === errors;
errors = _errs12;
if(vErrors !== null){
if(_errs12){
vErrors.length = _errs12;
}
else {
vErrors = null;
}
}
if(_valid2){
const _errs15 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.bridge_id === undefined){
const err9 = {instancePath,schemaPath:"#/allOf/2/then/required",keyword:"required",params:{missingProperty: "bridge_id"},message:"must have required property '"+"bridge_id"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data.generation === undefined){
const err10 = {instancePath,schemaPath:"#/allOf/2/then/required",keyword:"required",params:{missingProperty: "generation"},message:"must have required property '"+"generation"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data.request === undefined){
const err11 = {instancePath,schemaPath:"#/allOf/2/then/required",keyword:"required",params:{missingProperty: "request"},message:"must have required property '"+"request"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
var _valid2 = _errs15 === errors;
valid5 = _valid2;
}
if(!valid5){
const err12 = {instancePath,schemaPath:"#/allOf/2/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
const _errs17 = errors;
let valid7 = true;
const _errs18 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.kind !== undefined){
if("response" !== data.kind){
const err13 = {};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
}
var _valid3 = _errs18 === errors;
errors = _errs17;
if(vErrors !== null){
if(_errs17){
vErrors.length = _errs17;
}
else {
vErrors = null;
}
}
if(_valid3){
const _errs20 = errors;
const _errs21 = errors;
let valid9 = false;
let passing0 = null;
const _errs22 = errors;
const _errs23 = errors;
const _errs24 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
let missing0;
if((data.error === undefined) && (missing0 = "error")){
const err14 = {};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
var valid10 = _errs24 === errors;
if(valid10){
const err15 = {instancePath,schemaPath:"#/allOf/3/then/oneOf/0/not",keyword:"not",params:{},message:"must NOT be valid"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
else {
errors = _errs23;
if(vErrors !== null){
if(_errs23){
vErrors.length = _errs23;
}
else {
vErrors = null;
}
}
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.response === undefined){
const err16 = {instancePath,schemaPath:"#/allOf/3/then/oneOf/0/required",keyword:"required",params:{missingProperty: "response"},message:"must have required property '"+"response"+"'"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
var _valid4 = _errs22 === errors;
if(_valid4){
valid9 = true;
passing0 = 0;
}
const _errs25 = errors;
const _errs26 = errors;
const _errs27 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
let missing1;
if((data.response === undefined) && (missing1 = "response")){
const err17 = {};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
var valid11 = _errs27 === errors;
if(valid11){
const err18 = {instancePath,schemaPath:"#/allOf/3/then/oneOf/1/not",keyword:"not",params:{},message:"must NOT be valid"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
else {
errors = _errs26;
if(vErrors !== null){
if(_errs26){
vErrors.length = _errs26;
}
else {
vErrors = null;
}
}
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.error === undefined){
const err19 = {instancePath,schemaPath:"#/allOf/3/then/oneOf/1/required",keyword:"required",params:{missingProperty: "error"},message:"must have required property '"+"error"+"'"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
var _valid4 = _errs25 === errors;
if(_valid4 && valid9){
valid9 = false;
passing0 = [passing0, 1];
}
else {
if(_valid4){
valid9 = true;
passing0 = 1;
}
}
if(!valid9){
const err20 = {instancePath,schemaPath:"#/allOf/3/then/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
else {
errors = _errs21;
if(vErrors !== null){
if(_errs21){
vErrors.length = _errs21;
}
else {
vErrors = null;
}
}
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.bridge_id === undefined){
const err21 = {instancePath,schemaPath:"#/allOf/3/then/required",keyword:"required",params:{missingProperty: "bridge_id"},message:"must have required property '"+"bridge_id"+"'"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
if(data.generation === undefined){
const err22 = {instancePath,schemaPath:"#/allOf/3/then/required",keyword:"required",params:{missingProperty: "generation"},message:"must have required property '"+"generation"+"'"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
var _valid3 = _errs20 === errors;
valid7 = _valid3;
}
if(!valid7){
const err23 = {instancePath,schemaPath:"#/allOf/3/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
const _errs29 = errors;
let valid12 = true;
const _errs30 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.kind !== undefined){
if("dirty_changed" !== data.kind){
const err24 = {};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
}
var _valid5 = _errs30 === errors;
errors = _errs29;
if(vErrors !== null){
if(_errs29){
vErrors.length = _errs29;
}
else {
vErrors = null;
}
}
if(_valid5){
const _errs32 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.bridge_id === undefined){
const err25 = {instancePath,schemaPath:"#/allOf/4/then/required",keyword:"required",params:{missingProperty: "bridge_id"},message:"must have required property '"+"bridge_id"+"'"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
if(data.generation === undefined){
const err26 = {instancePath,schemaPath:"#/allOf/4/then/required",keyword:"required",params:{missingProperty: "generation"},message:"must have required property '"+"generation"+"'"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
if(data.dirty === undefined){
const err27 = {instancePath,schemaPath:"#/allOf/4/then/required",keyword:"required",params:{missingProperty: "dirty"},message:"must have required property '"+"dirty"+"'"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
var _valid5 = _errs32 === errors;
valid12 = _valid5;
}
if(!valid12){
const err28 = {instancePath,schemaPath:"#/allOf/4/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
const _errs34 = errors;
let valid14 = true;
const _errs35 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.kind !== undefined){
if("request_close" !== data.kind){
const err29 = {};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
}
var _valid6 = _errs35 === errors;
errors = _errs34;
if(vErrors !== null){
if(_errs34){
vErrors.length = _errs34;
}
else {
vErrors = null;
}
}
if(_valid6){
const _errs37 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.bridge_id === undefined){
const err30 = {instancePath,schemaPath:"#/allOf/5/then/required",keyword:"required",params:{missingProperty: "bridge_id"},message:"must have required property '"+"bridge_id"+"'"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
if(data.generation === undefined){
const err31 = {instancePath,schemaPath:"#/allOf/5/then/required",keyword:"required",params:{missingProperty: "generation"},message:"must have required property '"+"generation"+"'"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
}
var _valid6 = _errs37 === errors;
valid14 = _valid6;
}
if(!valid14){
const err32 = {instancePath,schemaPath:"#/allOf/5/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
const _errs39 = errors;
let valid16 = true;
const _errs40 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.kind !== undefined){
if("request_history" !== data.kind){
const err33 = {};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
}
}
var _valid7 = _errs40 === errors;
errors = _errs39;
if(vErrors !== null){
if(_errs39){
vErrors.length = _errs39;
}
else {
vErrors = null;
}
}
if(_valid7){
const _errs42 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.bridge_id === undefined){
const err34 = {instancePath,schemaPath:"#/allOf/6/then/required",keyword:"required",params:{missingProperty: "bridge_id"},message:"must have required property '"+"bridge_id"+"'"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
if(data.generation === undefined){
const err35 = {instancePath,schemaPath:"#/allOf/6/then/required",keyword:"required",params:{missingProperty: "generation"},message:"must have required property '"+"generation"+"'"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
if(data.dirty !== undefined){
const err36 = {instancePath:instancePath+"/dirty",schemaPath:"#/allOf/6/then/properties/dirty/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
if(data.request !== undefined){
const err37 = {instancePath:instancePath+"/request",schemaPath:"#/allOf/6/then/properties/request/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
if(data.response !== undefined){
const err38 = {instancePath:instancePath+"/response",schemaPath:"#/allOf/6/then/properties/response/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
if(data.error !== undefined){
const err39 = {instancePath:instancePath+"/error",schemaPath:"#/allOf/6/then/properties/error/false schema",keyword:"false schema",params:{},message:"boolean schema is false"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
}
var _valid7 = _errs42 === errors;
valid16 = _valid7;
if(valid16){
var props0 = {};
props0.dirty = true;
props0.request = true;
props0.response = true;
props0.error = true;
props0.kind = true;
}
}
if(!valid16){
const err40 = {instancePath,schemaPath:"#/allOf/6/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
if(props0 !== true){
props0 = props0 || {};
props0.kind = true;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.protocol_version === undefined){
const err41 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "protocol_version"},message:"must have required property '"+"protocol_version"+"'"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
if(data.request_id === undefined){
const err42 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "request_id"},message:"must have required property '"+"request_id"+"'"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
if(data.kind === undefined){
const err43 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
for(const key0 in data){
if(!(func82.call(schema239.properties, key0))){
const err44 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
}
}
if(data.protocol_version !== undefined){
if(1 !== data.protocol_version){
const err45 = {instancePath:instancePath+"/protocol_version",schemaPath:"#/properties/protocol_version/const",keyword:"const",params:{allowedValue: 1},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
}
if(data.request_id !== undefined){
let data12 = data.request_id;
if(typeof data12 === "string"){
if(func1(data12) > 64){
const err46 = {instancePath:instancePath+"/request_id",schemaPath:"#/properties/request_id/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err46];
}
else {
vErrors.push(err46);
}
errors++;
}
if(func1(data12) < 1){
const err47 = {instancePath:instancePath+"/request_id",schemaPath:"#/properties/request_id/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err47];
}
else {
vErrors.push(err47);
}
errors++;
}
}
else {
const err48 = {instancePath:instancePath+"/request_id",schemaPath:"#/properties/request_id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err48];
}
else {
vErrors.push(err48);
}
errors++;
}
}
if(data.kind !== undefined){
let data13 = data.kind;
if(typeof data13 !== "string"){
const err49 = {instancePath:instancePath+"/kind",schemaPath:"#/properties/kind/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err49];
}
else {
vErrors.push(err49);
}
errors++;
}
if(!(((((((data13 === "connect") || (data13 === "ready")) || (data13 === "request")) || (data13 === "response")) || (data13 === "dirty_changed")) || (data13 === "request_close")) || (data13 === "request_history"))){
const err50 = {instancePath:instancePath+"/kind",schemaPath:"#/properties/kind/enum",keyword:"enum",params:{allowedValues: schema239.properties.kind.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err50];
}
else {
vErrors.push(err50);
}
errors++;
}
}
if(data.bridge_id !== undefined){
let data14 = data.bridge_id;
if(typeof data14 === "string"){
if(func1(data14) > 64){
const err51 = {instancePath:instancePath+"/bridge_id",schemaPath:"#/properties/bridge_id/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err51];
}
else {
vErrors.push(err51);
}
errors++;
}
if(func1(data14) < 1){
const err52 = {instancePath:instancePath+"/bridge_id",schemaPath:"#/properties/bridge_id/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err52];
}
else {
vErrors.push(err52);
}
errors++;
}
}
else {
const err53 = {instancePath:instancePath+"/bridge_id",schemaPath:"#/properties/bridge_id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err53];
}
else {
vErrors.push(err53);
}
errors++;
}
}
if(data.generation !== undefined){
let data15 = data.generation;
if(!(((typeof data15 == "number") && (!(data15 % 1) && !isNaN(data15))) && (isFinite(data15)))){
const err54 = {instancePath:instancePath+"/generation",schemaPath:"#/properties/generation/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err54];
}
else {
vErrors.push(err54);
}
errors++;
}
if((typeof data15 == "number") && (isFinite(data15))){
if(data15 < 1 || isNaN(data15)){
const err55 = {instancePath:instancePath+"/generation",schemaPath:"#/properties/generation/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err55];
}
else {
vErrors.push(err55);
}
errors++;
}
}
}
if(data.dirty !== undefined){
if(typeof data.dirty !== "boolean"){
const err56 = {instancePath:instancePath+"/dirty",schemaPath:"#/properties/dirty/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err56];
}
else {
vErrors.push(err56);
}
errors++;
}
}
if(data.request !== undefined){
if(!(validate159(data.request, {instancePath:instancePath+"/request",parentData:data,parentDataProperty:"request",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate159.errors : vErrors.concat(validate159.errors);
errors = vErrors.length;
}
}
if(data.response !== undefined){
if(!(validate161(data.response, {instancePath:instancePath+"/response",parentData:data,parentDataProperty:"response",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate161.errors : vErrors.concat(validate161.errors);
errors = vErrors.length;
}
}
if(data.error !== undefined){
if(!(validate167(data.error, {instancePath:instancePath+"/error",parentData:data,parentDataProperty:"error",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate167.errors : vErrors.concat(validate167.errors);
errors = vErrors.length;
}
}
}
else {
const err57 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err57];
}
else {
vErrors.push(err57);
}
errors++;
}
validate158.errors = vErrors;
return errors === 0;
}
validate158.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const validators = Object.freeze({
  Identifier: v_Identifier,
  OperationId: v_OperationId,
  Version: v_Version,
  RunEpoch: v_RunEpoch,
  ErrorCode: v_ErrorCode,
  ErrorResponse: v_ErrorResponse,
  Limits: v_Limits,
  ServiceStatus: v_ServiceStatus,
  Principal: v_Principal,
  Workflow: v_Workflow,
  WorkflowList: v_WorkflowList,
  ListRequest: v_ListRequest,
  CreateInput: v_CreateInput,
  CreateRequest: v_CreateRequest,
  TextInput: v_TextInput,
  SaveRequest: v_SaveRequest,
  TestRequest: v_TestRequest,
  PublishRequest: v_PublishRequest,
  RunRequest: v_RunRequest,
  RunInput: v_RunInput,
  RunMode: v_RunMode,
  NodeResult: v_NodeResult,
  Run: v_Run,
  RunList: v_RunList,
  OperationKind: v_OperationKind,
  OperationPhase: v_OperationPhase,
  OperationReceipt: v_OperationReceipt,
  EditorOpenRequest: v_EditorOpenRequest,
  EditorSessionSecret: v_EditorSessionSecret,
  EditorOpenedView: v_EditorOpenedView,
  Bootstrap: v_Bootstrap,
  EditorOperation: v_EditorOperation,
  EditorExchangeInput: v_EditorExchangeInput,
  EditorExchangeResult: v_EditorExchangeResult,
  EditorCloseInput: v_EditorCloseInput,
  RunQueryKind: v_RunQueryKind,
  RunQueryInput: v_RunQueryInput,
  RunQueryResult: v_RunQueryResult,
  CloseResult: v_CloseResult,
  WorkflowSummary: v_WorkflowSummary,
  RunSummary: v_RunSummary,
  DeleteInput: v_DeleteInput,
  DeleteRequest: v_DeleteRequest,
  DeleteResult: v_DeleteResult,
});
