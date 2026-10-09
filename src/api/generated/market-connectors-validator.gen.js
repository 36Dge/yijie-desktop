// Generated from market-connectors source; DO NOT EDIT.
/* Bundled helper license notices:
The MIT License (MIT)

Copyright (c) 2015-2021 Evgeny Poberezkin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.



MIT License

Copyright (c) 2017 Evgeny Poberezkin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/
"use strict";
export const validateCanonicalId = validate53;
const schema20 = {"type":"string","format":"uuid","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$","not":{"const":"00000000-0000-0000-0000-000000000000"}};
const formats0 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pattern3 = new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", "u");

function validate53(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate53.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
const _errs1 = errors;
const _errs2 = errors;
if("00000000-0000-0000-0000-000000000000" !== data){
const err0 = {};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
var valid0 = _errs2 === errors;
if(valid0){
const err1 = {instancePath,schemaPath:"#/not",keyword:"not",params:{},message:"must NOT be valid"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
else {
errors = _errs1;
if(vErrors !== null){
if(_errs1){
vErrors.length = _errs1;
}
else {
vErrors = null;
}
}
}
if(typeof data === "string"){
if(!pattern3.test(data)){
const err2 = {instancePath,schemaPath:"#/pattern",keyword:"pattern",params:{pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},message:"must match pattern \""+"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"+"\""};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(!(formats0.test(data))){
const err3 = {instancePath,schemaPath:"#/format",keyword:"format",params:{format: "uuid"},message:"must match format \""+"uuid"+"\""};
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
const err4 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
validate53.errors = vErrors;
return errors === 0;
}
validate53.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const validateServiceId = validate54;
const schema21 = {"type":"string","minLength":1,"maxLength":128,"pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$","description":"Original case-sensitive catalog serverName. Syntactic acceptance does not replace exact registry lookup."};
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
const pattern4 = new RegExp("^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$", "u");

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
if(typeof data === "string"){
if(func1(data) > 128){
const err0 = {instancePath,schemaPath:"#/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(func1(data) < 1){
const err1 = {instancePath,schemaPath:"#/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(!pattern4.test(data)){
const err2 = {instancePath,schemaPath:"#/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$"},message:"must match pattern \""+"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$"+"\""};
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
const err3 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
validate54.errors = vErrors;
return errors === 0;
}
validate54.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const validateRevision = validate55;
const schema22 = {"type":"integer","minimum":1,"maximum":9007199254740991};

function validate55(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate55.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(!(((typeof data == "number") && (!(data % 1) && !isNaN(data))) && (isFinite(data)))){
const err0 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if((typeof data == "number") && (isFinite(data))){
if(data > 9007199254740991 || isNaN(data)){
const err1 = {instancePath,schemaPath:"#/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data < 1 || isNaN(data)){
const err2 = {instancePath,schemaPath:"#/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
validate55.errors = vErrors;
return errors === 0;
}
validate55.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const validateInitialRevision = validate56;
const schema23 = {"type":"integer","const":0};

function validate56(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate56.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(!(((typeof data == "number") && (!(data % 1) && !isNaN(data))) && (isFinite(data)))){
const err0 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(0 !== data){
const err1 = {instancePath,schemaPath:"#/const",keyword:"const",params:{allowedValue: 0},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate56.errors = vErrors;
return errors === 0;
}
validate56.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const validateSchemaVersion = validate57;
const schema24 = {"type":"integer","const":1};

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
if(!(((typeof data == "number") && (!(data % 1) && !isNaN(data))) && (isFinite(data)))){
const err0 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(1 !== data){
const err1 = {instancePath,schemaPath:"#/const",keyword:"const",params:{allowedValue: 1},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate57.errors = vErrors;
return errors === 0;
}
validate57.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const validateCredentialReference = validate58;
const schema25 = {"type":"string","minLength":1,"maxLength":128,"pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$","description":"Opaque non-redeemable reference only; never a secret, URL, file path, token or raw account identifier."};

function validate58(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate58.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(typeof data === "string"){
if(func1(data) > 128){
const err0 = {instancePath,schemaPath:"#/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(func1(data) < 1){
const err1 = {instancePath,schemaPath:"#/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(!pattern4.test(data)){
const err2 = {instancePath,schemaPath:"#/pattern",keyword:"pattern",params:{pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$"},message:"must match pattern \""+"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$"+"\""};
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
const err3 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
validate58.errors = vErrors;
return errors === 0;
}
validate58.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const validatePermission = validate59;
const schema26 = {"type":"string","enum":["connector.read","connector.manage","connector.credentials.manage","connector.use"]};

function validate59(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate59.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(typeof data !== "string"){
const err0 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(!((((data === "connector.read") || (data === "connector.manage")) || (data === "connector.credentials.manage")) || (data === "connector.use"))){
const err1 = {instancePath,schemaPath:"#/enum",keyword:"enum",params:{allowedValues: schema26.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate59.errors = vErrors;
return errors === 0;
}
validate59.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const validateCategoryId = validate60;
const schema27 = {"type":"string","enum":["knowledge_docs","ecommerce_retail","cross_border_ecommerce","data_analytics","productivity","industry_data","marketing"]};

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
if(typeof data !== "string"){
const err0 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(!(((((((data === "knowledge_docs") || (data === "ecommerce_retail")) || (data === "cross_border_ecommerce")) || (data === "data_analytics")) || (data === "productivity")) || (data === "industry_data")) || (data === "marketing"))){
const err1 = {instancePath,schemaPath:"#/enum",keyword:"enum",params:{allowedValues: schema27.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate60.errors = vErrors;
return errors === 0;
}
validate60.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const validateTransport = validate61;
const schema28 = {"type":"string","enum":["http","stdio"]};

function validate61(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate61.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(typeof data !== "string"){
const err0 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(!((data === "http") || (data === "stdio"))){
const err1 = {instancePath,schemaPath:"#/enum",keyword:"enum",params:{allowedValues: schema28.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate61.errors = vErrors;
return errors === 0;
}
validate61.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const validateAuthMode = validate62;
const schema29 = {"type":"string","enum":["oauth","api_key","provider_credentials","local_oauth","stdio_api_key","provider_gateway","none","unknown"]};

function validate62(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate62.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(typeof data !== "string"){
const err0 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(!((((((((data === "oauth") || (data === "api_key")) || (data === "provider_credentials")) || (data === "local_oauth")) || (data === "stdio_api_key")) || (data === "provider_gateway")) || (data === "none")) || (data === "unknown"))){
const err1 = {instancePath,schemaPath:"#/enum",keyword:"enum",params:{allowedValues: schema29.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate62.errors = vErrors;
return errors === 0;
}
validate62.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const validateAvailability = validate63;
const schema30 = {"type":"string","enum":["available","needs_setup","blocked","unverified"]};

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
if(typeof data !== "string"){
const err0 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(!((((data === "available") || (data === "needs_setup")) || (data === "blocked")) || (data === "unverified"))){
const err1 = {instancePath,schemaPath:"#/enum",keyword:"enum",params:{allowedValues: schema30.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate63.errors = vErrors;
return errors === 0;
}
validate63.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const validateInstallationStatus = validate64;
const schema31 = {"type":"string","enum":["installed","removing","removed"]};

function validate64(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate64.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(typeof data !== "string"){
const err0 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(!(((data === "installed") || (data === "removing")) || (data === "removed"))){
const err1 = {instancePath,schemaPath:"#/enum",keyword:"enum",params:{allowedValues: schema31.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate64.errors = vErrors;
return errors === 0;
}
validate64.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const validateConfigurationStatus = validate65;
const schema32 = {"type":"string","enum":["unconfigured","configured","invalid","unknown"]};

function validate65(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
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
const err0 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(!((((data === "unconfigured") || (data === "configured")) || (data === "invalid")) || (data === "unknown"))){
const err1 = {instancePath,schemaPath:"#/enum",keyword:"enum",params:{allowedValues: schema32.enum},message:"must be equal to one of the allowed values"};
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

export const validateAuthorizationStatus = validate66;
const schema33 = {"type":"string","enum":["not_required","required","authorizing","authorized","expired","failed","unknown"]};

function validate66(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate66.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(typeof data !== "string"){
const err0 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(!(((((((data === "not_required") || (data === "required")) || (data === "authorizing")) || (data === "authorized")) || (data === "expired")) || (data === "failed")) || (data === "unknown"))){
const err1 = {instancePath,schemaPath:"#/enum",keyword:"enum",params:{allowedValues: schema33.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate66.errors = vErrors;
return errors === 0;
}
validate66.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const validateConnectionStatus = validate67;
const schema34 = {"type":"string","enum":["disconnected","connecting","ready","failed","unknown"]};

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
if(typeof data !== "string"){
const err0 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(!(((((data === "disconnected") || (data === "connecting")) || (data === "ready")) || (data === "failed")) || (data === "unknown"))){
const err1 = {instancePath,schemaPath:"#/enum",keyword:"enum",params:{allowedValues: schema34.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate67.errors = vErrors;
return errors === 0;
}
validate67.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const validateOperationAction = validate68;
const schema35 = {"type":"string","enum":["install","configure","authorize","enable","disable","uninstall"]};

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
if(typeof data !== "string"){
const err0 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(!((((((data === "install") || (data === "configure")) || (data === "authorize")) || (data === "enable")) || (data === "disable")) || (data === "uninstall"))){
const err1 = {instancePath,schemaPath:"#/enum",keyword:"enum",params:{allowedValues: schema35.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate68.errors = vErrors;
return errors === 0;
}
validate68.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const validateOperationStatus = validate69;
const schema36 = {"type":"string","enum":["pending","succeeded","failed","cancelled","unknown"]};

function validate69(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate69.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(typeof data !== "string"){
const err0 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(!(((((data === "pending") || (data === "succeeded")) || (data === "failed")) || (data === "cancelled")) || (data === "unknown"))){
const err1 = {instancePath,schemaPath:"#/enum",keyword:"enum",params:{allowedValues: schema36.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate69.errors = vErrors;
return errors === 0;
}
validate69.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const validateErrorCode = validate70;
const schema37 = {"type":"string","enum":["invalid_request","context_invalid","not_found","request_conflict","not_configured","authorization_required","authorization_cancelled","dependency_missing","provider_onboarding_required","permission_denied","revision_conflict","unsupported_capability","rate_limited","temporarily_unavailable","operation_pending","outcome_unknown","cleanup_pending","execution_unavailable","selection_stale"]};

function validate70(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate70.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(typeof data !== "string"){
const err0 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(!(((((((((((((((((((data === "invalid_request") || (data === "context_invalid")) || (data === "not_found")) || (data === "request_conflict")) || (data === "not_configured")) || (data === "authorization_required")) || (data === "authorization_cancelled")) || (data === "dependency_missing")) || (data === "provider_onboarding_required")) || (data === "permission_denied")) || (data === "revision_conflict")) || (data === "unsupported_capability")) || (data === "rate_limited")) || (data === "temporarily_unavailable")) || (data === "operation_pending")) || (data === "outcome_unknown")) || (data === "cleanup_pending")) || (data === "execution_unavailable")) || (data === "selection_stale"))){
const err1 = {instancePath,schemaPath:"#/enum",keyword:"enum",params:{allowedValues: schema37.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate70.errors = vErrors;
return errors === 0;
}
validate70.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const validateCatalogEntry = validate71;
const schema38 = {"type":"object","additionalProperties":true,"required":["serviceId","serverName","displayName","categoryId","categoryLabel","description","iconAssetId","transport","authMode","availability","blockerCodes"],"properties":{"serviceId":{"$ref":"#/$defs/ServiceId"},"serverName":{"$ref":"#/$defs/ServiceId"},"displayName":{"type":"string","minLength":1,"maxLength":160},"categoryId":{"$ref":"#/$defs/CategoryId"},"categoryLabel":{"type":"string","minLength":1,"maxLength":64},"description":{"type":"string","minLength":0,"maxLength":2000},"iconAssetId":{"$ref":"#/$defs/ServiceId"},"transport":{"$ref":"#/$defs/Transport"},"authMode":{"$ref":"#/$defs/AuthMode"},"authorizationAvailable":{"type":"boolean","default":false,"description":"Whether this local Native product assembly has an available managed authorization adapter. Omitted means false. This is not provider authorization, installation enablement, connection readiness, tool qualification or execution permission. authMode is reference metadata and cannot establish this capability; credentials.manage is still required to authorize."},"availability":{"$ref":"#/$defs/Availability"},"blockerCodes":{"type":"array","items":{"$ref":"#/$defs/ErrorCode"},"maxItems":20}},"description":"Connectors-owned non-secret product catalog projection. No endpoint, command, header, environment, OAuth URL or executable configuration. Unknown response fields are ignored, never echoed/persisted."};

function validate71(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate71.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.serviceId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "serviceId"},message:"must have required property '"+"serviceId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.serverName === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "serverName"},message:"must have required property '"+"serverName"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.displayName === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "displayName"},message:"must have required property '"+"displayName"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.categoryId === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "categoryId"},message:"must have required property '"+"categoryId"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.categoryLabel === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "categoryLabel"},message:"must have required property '"+"categoryLabel"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.description === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "description"},message:"must have required property '"+"description"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.iconAssetId === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "iconAssetId"},message:"must have required property '"+"iconAssetId"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data.transport === undefined){
const err7 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "transport"},message:"must have required property '"+"transport"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data.authMode === undefined){
const err8 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "authMode"},message:"must have required property '"+"authMode"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data.availability === undefined){
const err9 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "availability"},message:"must have required property '"+"availability"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data.blockerCodes === undefined){
const err10 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "blockerCodes"},message:"must have required property '"+"blockerCodes"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data.serviceId !== undefined){
if(!(validate54(data.serviceId, {instancePath:instancePath+"/serviceId",parentData:data,parentDataProperty:"serviceId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
errors = vErrors.length;
}
}
if(data.serverName !== undefined){
if(!(validate54(data.serverName, {instancePath:instancePath+"/serverName",parentData:data,parentDataProperty:"serverName",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
errors = vErrors.length;
}
}
if(data.displayName !== undefined){
let data2 = data.displayName;
if(typeof data2 === "string"){
if(func1(data2) > 160){
const err11 = {instancePath:instancePath+"/displayName",schemaPath:"#/properties/displayName/maxLength",keyword:"maxLength",params:{limit: 160},message:"must NOT have more than 160 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(func1(data2) < 1){
const err12 = {instancePath:instancePath+"/displayName",schemaPath:"#/properties/displayName/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
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
const err13 = {instancePath:instancePath+"/displayName",schemaPath:"#/properties/displayName/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data.categoryId !== undefined){
if(!(validate60(data.categoryId, {instancePath:instancePath+"/categoryId",parentData:data,parentDataProperty:"categoryId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate60.errors : vErrors.concat(validate60.errors);
errors = vErrors.length;
}
}
if(data.categoryLabel !== undefined){
let data4 = data.categoryLabel;
if(typeof data4 === "string"){
if(func1(data4) > 64){
const err14 = {instancePath:instancePath+"/categoryLabel",schemaPath:"#/properties/categoryLabel/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(func1(data4) < 1){
const err15 = {instancePath:instancePath+"/categoryLabel",schemaPath:"#/properties/categoryLabel/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
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
const err16 = {instancePath:instancePath+"/categoryLabel",schemaPath:"#/properties/categoryLabel/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data.description !== undefined){
let data5 = data.description;
if(typeof data5 === "string"){
if(func1(data5) > 2000){
const err17 = {instancePath:instancePath+"/description",schemaPath:"#/properties/description/maxLength",keyword:"maxLength",params:{limit: 2000},message:"must NOT have more than 2000 characters"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(func1(data5) < 0){
const err18 = {instancePath:instancePath+"/description",schemaPath:"#/properties/description/minLength",keyword:"minLength",params:{limit: 0},message:"must NOT have fewer than 0 characters"};
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
const err19 = {instancePath:instancePath+"/description",schemaPath:"#/properties/description/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data.iconAssetId !== undefined){
if(!(validate54(data.iconAssetId, {instancePath:instancePath+"/iconAssetId",parentData:data,parentDataProperty:"iconAssetId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
errors = vErrors.length;
}
}
if(data.transport !== undefined){
if(!(validate61(data.transport, {instancePath:instancePath+"/transport",parentData:data,parentDataProperty:"transport",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate61.errors : vErrors.concat(validate61.errors);
errors = vErrors.length;
}
}
if(data.authMode !== undefined){
if(!(validate62(data.authMode, {instancePath:instancePath+"/authMode",parentData:data,parentDataProperty:"authMode",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate62.errors : vErrors.concat(validate62.errors);
errors = vErrors.length;
}
}
if(data.authorizationAvailable !== undefined){
if(typeof data.authorizationAvailable !== "boolean"){
const err20 = {instancePath:instancePath+"/authorizationAvailable",schemaPath:"#/properties/authorizationAvailable/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
if(data.availability !== undefined){
if(!(validate63(data.availability, {instancePath:instancePath+"/availability",parentData:data,parentDataProperty:"availability",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate63.errors : vErrors.concat(validate63.errors);
errors = vErrors.length;
}
}
if(data.blockerCodes !== undefined){
let data11 = data.blockerCodes;
if(Array.isArray(data11)){
if(data11.length > 20){
const err21 = {instancePath:instancePath+"/blockerCodes",schemaPath:"#/properties/blockerCodes/maxItems",keyword:"maxItems",params:{limit: 20},message:"must NOT have more than 20 items"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
const len0 = data11.length;
for(let i0=0; i0<len0; i0++){
if(!(validate70(data11[i0], {instancePath:instancePath+"/blockerCodes/" + i0,parentData:data11,parentDataProperty:i0,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate70.errors : vErrors.concat(validate70.errors);
errors = vErrors.length;
}
}
}
else {
const err22 = {instancePath:instancePath+"/blockerCodes",schemaPath:"#/properties/blockerCodes/type",keyword:"type",params:{type: "array"},message:"must be array"};
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
else {
const err23 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
validate71.errors = vErrors;
return errors === 0;
}
validate71.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const validateOperation = validate80;
const schema39 = {"type":"object","additionalProperties":true,"required":["operationId","installationId","serviceId","action","status","revision","cancellable"],"properties":{"operationId":{"$ref":"#/$defs/CanonicalId"},"installationId":{"$ref":"#/$defs/CanonicalId"},"serviceId":{"$ref":"#/$defs/ServiceId"},"action":{"$ref":"#/$defs/OperationAction"},"status":{"$ref":"#/$defs/OperationStatus"},"revision":{"$ref":"#/$defs/Revision"},"cancellable":{"type":"boolean"},"errorCode":{"$ref":"#/$defs/ErrorCode"}},"description":"One active management operation per local-scope service. Same operation ID and intent replays its receipt; different intent conflicts. Waiting expiry never proves non-execution."};

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
if(data.operationId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "operationId"},message:"must have required property '"+"operationId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.installationId === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "installationId"},message:"must have required property '"+"installationId"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.serviceId === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "serviceId"},message:"must have required property '"+"serviceId"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.action === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "action"},message:"must have required property '"+"action"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.status === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "status"},message:"must have required property '"+"status"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.revision === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "revision"},message:"must have required property '"+"revision"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.cancellable === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "cancellable"},message:"must have required property '"+"cancellable"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data.operationId !== undefined){
if(!(validate53(data.operationId, {instancePath:instancePath+"/operationId",parentData:data,parentDataProperty:"operationId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.installationId !== undefined){
if(!(validate53(data.installationId, {instancePath:instancePath+"/installationId",parentData:data,parentDataProperty:"installationId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.serviceId !== undefined){
if(!(validate54(data.serviceId, {instancePath:instancePath+"/serviceId",parentData:data,parentDataProperty:"serviceId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
errors = vErrors.length;
}
}
if(data.action !== undefined){
if(!(validate68(data.action, {instancePath:instancePath+"/action",parentData:data,parentDataProperty:"action",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate68.errors : vErrors.concat(validate68.errors);
errors = vErrors.length;
}
}
if(data.status !== undefined){
if(!(validate69(data.status, {instancePath:instancePath+"/status",parentData:data,parentDataProperty:"status",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate69.errors : vErrors.concat(validate69.errors);
errors = vErrors.length;
}
}
if(data.revision !== undefined){
if(!(validate55(data.revision, {instancePath:instancePath+"/revision",parentData:data,parentDataProperty:"revision",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate55.errors : vErrors.concat(validate55.errors);
errors = vErrors.length;
}
}
if(data.cancellable !== undefined){
if(typeof data.cancellable !== "boolean"){
const err7 = {instancePath:instancePath+"/cancellable",schemaPath:"#/properties/cancellable/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.errorCode !== undefined){
if(!(validate70(data.errorCode, {instancePath:instancePath+"/errorCode",parentData:data,parentDataProperty:"errorCode",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate70.errors : vErrors.concat(validate70.errors);
errors = vErrors.length;
}
}
}
else {
const err8 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
validate80.errors = vErrors;
return errors === 0;
}
validate80.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const validateInstallation = validate88;
const schema40 = {"type":"object","additionalProperties":true,"required":["installationId","serviceId","revision","generation","status","desiredEnabled","effectiveEnabled","configurationStatus","authorizationStatus","connectionStatus"],"properties":{"installationId":{"$ref":"#/$defs/CanonicalId"},"serviceId":{"$ref":"#/$defs/ServiceId"},"revision":{"$ref":"#/$defs/Revision"},"generation":{"$ref":"#/$defs/Revision"},"status":{"$ref":"#/$defs/InstallationStatus"},"desiredEnabled":{"type":"boolean"},"effectiveEnabled":{"type":"boolean"},"configurationStatus":{"$ref":"#/$defs/ConfigurationStatus"},"authorizationStatus":{"$ref":"#/$defs/AuthorizationStatus"},"connectionStatus":{"$ref":"#/$defs/ConnectionStatus"},"credentialRef":{"$ref":"#/$defs/CredentialReference"},"activeOperation":{"$ref":"#/$defs/Operation"},"errorCode":{"$ref":"#/$defs/ErrorCode"}},"description":"Native product authority; one live installation per local scope and service. Reopen restores desired intent but starts effective=false until requalified. generation fences authorization/connection/selection; revision fences management writes."};

function validate88(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate88.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.installationId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "installationId"},message:"must have required property '"+"installationId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.serviceId === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "serviceId"},message:"must have required property '"+"serviceId"+"'"};
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
if(data.generation === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "generation"},message:"must have required property '"+"generation"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.status === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "status"},message:"must have required property '"+"status"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.desiredEnabled === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "desiredEnabled"},message:"must have required property '"+"desiredEnabled"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.effectiveEnabled === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "effectiveEnabled"},message:"must have required property '"+"effectiveEnabled"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data.configurationStatus === undefined){
const err7 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "configurationStatus"},message:"must have required property '"+"configurationStatus"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data.authorizationStatus === undefined){
const err8 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "authorizationStatus"},message:"must have required property '"+"authorizationStatus"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data.connectionStatus === undefined){
const err9 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "connectionStatus"},message:"must have required property '"+"connectionStatus"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data.installationId !== undefined){
if(!(validate53(data.installationId, {instancePath:instancePath+"/installationId",parentData:data,parentDataProperty:"installationId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.serviceId !== undefined){
if(!(validate54(data.serviceId, {instancePath:instancePath+"/serviceId",parentData:data,parentDataProperty:"serviceId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
errors = vErrors.length;
}
}
if(data.revision !== undefined){
if(!(validate55(data.revision, {instancePath:instancePath+"/revision",parentData:data,parentDataProperty:"revision",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate55.errors : vErrors.concat(validate55.errors);
errors = vErrors.length;
}
}
if(data.generation !== undefined){
if(!(validate55(data.generation, {instancePath:instancePath+"/generation",parentData:data,parentDataProperty:"generation",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate55.errors : vErrors.concat(validate55.errors);
errors = vErrors.length;
}
}
if(data.status !== undefined){
if(!(validate64(data.status, {instancePath:instancePath+"/status",parentData:data,parentDataProperty:"status",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate64.errors : vErrors.concat(validate64.errors);
errors = vErrors.length;
}
}
if(data.desiredEnabled !== undefined){
if(typeof data.desiredEnabled !== "boolean"){
const err10 = {instancePath:instancePath+"/desiredEnabled",schemaPath:"#/properties/desiredEnabled/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.effectiveEnabled !== undefined){
if(typeof data.effectiveEnabled !== "boolean"){
const err11 = {instancePath:instancePath+"/effectiveEnabled",schemaPath:"#/properties/effectiveEnabled/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.configurationStatus !== undefined){
if(!(validate65(data.configurationStatus, {instancePath:instancePath+"/configurationStatus",parentData:data,parentDataProperty:"configurationStatus",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate65.errors : vErrors.concat(validate65.errors);
errors = vErrors.length;
}
}
if(data.authorizationStatus !== undefined){
if(!(validate66(data.authorizationStatus, {instancePath:instancePath+"/authorizationStatus",parentData:data,parentDataProperty:"authorizationStatus",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate66.errors : vErrors.concat(validate66.errors);
errors = vErrors.length;
}
}
if(data.connectionStatus !== undefined){
if(!(validate67(data.connectionStatus, {instancePath:instancePath+"/connectionStatus",parentData:data,parentDataProperty:"connectionStatus",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate67.errors : vErrors.concat(validate67.errors);
errors = vErrors.length;
}
}
if(data.credentialRef !== undefined){
if(!(validate58(data.credentialRef, {instancePath:instancePath+"/credentialRef",parentData:data,parentDataProperty:"credentialRef",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate58.errors : vErrors.concat(validate58.errors);
errors = vErrors.length;
}
}
if(data.activeOperation !== undefined){
if(!(validate80(data.activeOperation, {instancePath:instancePath+"/activeOperation",parentData:data,parentDataProperty:"activeOperation",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate80.errors : vErrors.concat(validate80.errors);
errors = vErrors.length;
}
}
if(data.errorCode !== undefined){
if(!(validate70(data.errorCode, {instancePath:instancePath+"/errorCode",parentData:data,parentDataProperty:"errorCode",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate70.errors : vErrors.concat(validate70.errors);
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
validate88.errors = vErrors;
return errors === 0;
}
validate88.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const validateSnapshot = validate100;
const schema41 = {"type":"object","additionalProperties":true,"required":["catalogRevision","catalog","installations","capabilities","executionAvailable"],"properties":{"catalogRevision":{"$ref":"#/$defs/Revision"},"catalog":{"type":"array","items":{"$ref":"#/$defs/CatalogEntry"},"maxItems":58},"installations":{"type":"array","items":{"$ref":"#/$defs/Installation"},"maxItems":58},"capabilities":{"type":"array","items":{"$ref":"#/$defs/Permission"},"maxItems":4,"uniqueItems":true},"executionAvailable":{"type":"boolean"}},"description":"executionAvailable=false makes every connector unselectable even if cached states are ready. Exact catalog membership/count is verified against the Connectors product source, not inferred from a request."};
const func0 = (function equal(a, b) {
  if (a === b) return true;

  if (a && b && typeof a == 'object' && typeof b == 'object') {
    if (a.constructor !== b.constructor) return false;

    var length, i, keys;
    if (Array.isArray(a)) {
      length = a.length;
      if (length != b.length) return false;
      for (i = length; i-- !== 0;)
        if (!equal(a[i], b[i])) return false;
      return true;
    }



    if (a.constructor === RegExp) return a.source === b.source && a.flags === b.flags;
    if (a.valueOf !== Object.prototype.valueOf) return a.valueOf() === b.valueOf();
    if (a.toString !== Object.prototype.toString) return a.toString() === b.toString();

    keys = Object.keys(a);
    length = keys.length;
    if (length !== Object.keys(b).length) return false;

    for (i = length; i-- !== 0;)
      if (!Object.prototype.hasOwnProperty.call(b, keys[i])) return false;

    for (i = length; i-- !== 0;) {
      var key = keys[i];

      if (!equal(a[key], b[key])) return false;
    }

    return true;
  }

  // true if both NaN, false otherwise
  return a!==a && b!==b;
});

function validate100(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate100.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.catalogRevision === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "catalogRevision"},message:"must have required property '"+"catalogRevision"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.catalog === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "catalog"},message:"must have required property '"+"catalog"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.installations === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "installations"},message:"must have required property '"+"installations"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.capabilities === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "capabilities"},message:"must have required property '"+"capabilities"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.executionAvailable === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "executionAvailable"},message:"must have required property '"+"executionAvailable"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.catalogRevision !== undefined){
if(!(validate55(data.catalogRevision, {instancePath:instancePath+"/catalogRevision",parentData:data,parentDataProperty:"catalogRevision",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate55.errors : vErrors.concat(validate55.errors);
errors = vErrors.length;
}
}
if(data.catalog !== undefined){
let data1 = data.catalog;
if(Array.isArray(data1)){
if(data1.length > 58){
const err5 = {instancePath:instancePath+"/catalog",schemaPath:"#/properties/catalog/maxItems",keyword:"maxItems",params:{limit: 58},message:"must NOT have more than 58 items"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
const len0 = data1.length;
for(let i0=0; i0<len0; i0++){
if(!(validate71(data1[i0], {instancePath:instancePath+"/catalog/" + i0,parentData:data1,parentDataProperty:i0,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate71.errors : vErrors.concat(validate71.errors);
errors = vErrors.length;
}
}
}
else {
const err6 = {instancePath:instancePath+"/catalog",schemaPath:"#/properties/catalog/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.installations !== undefined){
let data3 = data.installations;
if(Array.isArray(data3)){
if(data3.length > 58){
const err7 = {instancePath:instancePath+"/installations",schemaPath:"#/properties/installations/maxItems",keyword:"maxItems",params:{limit: 58},message:"must NOT have more than 58 items"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
const len1 = data3.length;
for(let i1=0; i1<len1; i1++){
if(!(validate88(data3[i1], {instancePath:instancePath+"/installations/" + i1,parentData:data3,parentDataProperty:i1,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate88.errors : vErrors.concat(validate88.errors);
errors = vErrors.length;
}
}
}
else {
const err8 = {instancePath:instancePath+"/installations",schemaPath:"#/properties/installations/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.capabilities !== undefined){
let data5 = data.capabilities;
if(Array.isArray(data5)){
if(data5.length > 4){
const err9 = {instancePath:instancePath+"/capabilities",schemaPath:"#/properties/capabilities/maxItems",keyword:"maxItems",params:{limit: 4},message:"must NOT have more than 4 items"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
const len2 = data5.length;
for(let i2=0; i2<len2; i2++){
if(!(validate59(data5[i2], {instancePath:instancePath+"/capabilities/" + i2,parentData:data5,parentDataProperty:i2,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate59.errors : vErrors.concat(validate59.errors);
errors = vErrors.length;
}
}
let i3 = data5.length;
let j0;
if(i3 > 1){
outer0:
for(;i3--;){
for(j0 = i3; j0--;){
if(func0(data5[i3], data5[j0])){
const err10 = {instancePath:instancePath+"/capabilities",schemaPath:"#/properties/capabilities/uniqueItems",keyword:"uniqueItems",params:{i: i3, j: j0},message:"must NOT have duplicate items (items ## "+j0+" and "+i3+" are identical)"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
break outer0;
}
}
}
}
}
else {
const err11 = {instancePath:instancePath+"/capabilities",schemaPath:"#/properties/capabilities/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.executionAvailable !== undefined){
if(typeof data.executionAvailable !== "boolean"){
const err12 = {instancePath:instancePath+"/executionAvailable",schemaPath:"#/properties/executionAvailable/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
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
else {
const err13 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
validate100.errors = vErrors;
return errors === 0;
}
validate100.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const validateMutationResult = validate105;
const schema42 = {"type":"object","additionalProperties":true,"required":["installation","operation"],"properties":{"installation":{"$ref":"#/$defs/Installation"},"operation":{"$ref":"#/$defs/Operation"}}};

function validate105(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate105.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.installation === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "installation"},message:"must have required property '"+"installation"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.operation === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "operation"},message:"must have required property '"+"operation"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.installation !== undefined){
if(!(validate88(data.installation, {instancePath:instancePath+"/installation",parentData:data,parentDataProperty:"installation",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate88.errors : vErrors.concat(validate88.errors);
errors = vErrors.length;
}
}
if(data.operation !== undefined){
if(!(validate80(data.operation, {instancePath:instancePath+"/operation",parentData:data,parentDataProperty:"operation",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate80.errors : vErrors.concat(validate80.errors);
errors = vErrors.length;
}
}
}
else {
const err2 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
validate105.errors = vErrors;
return errors === 0;
}
validate105.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const validateSelectionRef = validate108;
const schema43 = {"type":"object","additionalProperties":false,"required":["installationId","revision","generation"],"properties":{"installationId":{"$ref":"#/$defs/CanonicalId"},"revision":{"$ref":"#/$defs/Revision"},"generation":{"$ref":"#/$defs/Revision"}},"description":"No service label or secret is accepted as authority. Native and Host revalidate exact scope, generation, ready state and connector.use before a versioned turn is admitted."};

function validate108(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate108.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.installationId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "installationId"},message:"must have required property '"+"installationId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.revision === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "revision"},message:"must have required property '"+"revision"+"'"};
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
for(const key0 in data){
if(!(((key0 === "installationId") || (key0 === "revision")) || (key0 === "generation"))){
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
if(data.installationId !== undefined){
if(!(validate53(data.installationId, {instancePath:instancePath+"/installationId",parentData:data,parentDataProperty:"installationId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.revision !== undefined){
if(!(validate55(data.revision, {instancePath:instancePath+"/revision",parentData:data,parentDataProperty:"revision",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate55.errors : vErrors.concat(validate55.errors);
errors = vErrors.length;
}
}
if(data.generation !== undefined){
if(!(validate55(data.generation, {instancePath:instancePath+"/generation",parentData:data,parentDataProperty:"generation",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate55.errors : vErrors.concat(validate55.errors);
errors = vErrors.length;
}
}
}
else {
const err4 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
validate108.errors = vErrors;
return errors === 0;
}
validate108.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const validateSelectionDisplay = validate112;
const schema44 = {"type":"object","additionalProperties":true,"required":["reference","serviceId","displayName"],"properties":{"reference":{"$ref":"#/$defs/SelectionRef"},"serviceId":{"$ref":"#/$defs/ServiceId"},"displayName":{"type":"string","minLength":1,"maxLength":160}},"description":"Safe display snapshot only, not a turn grant; old history cannot restore authority."};

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
if(data.reference === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "reference"},message:"must have required property '"+"reference"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.serviceId === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "serviceId"},message:"must have required property '"+"serviceId"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.displayName === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "displayName"},message:"must have required property '"+"displayName"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.reference !== undefined){
if(!(validate108(data.reference, {instancePath:instancePath+"/reference",parentData:data,parentDataProperty:"reference",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate108.errors : vErrors.concat(validate108.errors);
errors = vErrors.length;
}
}
if(data.serviceId !== undefined){
if(!(validate54(data.serviceId, {instancePath:instancePath+"/serviceId",parentData:data,parentDataProperty:"serviceId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
errors = vErrors.length;
}
}
if(data.displayName !== undefined){
let data2 = data.displayName;
if(typeof data2 === "string"){
if(func1(data2) > 160){
const err3 = {instancePath:instancePath+"/displayName",schemaPath:"#/properties/displayName/maxLength",keyword:"maxLength",params:{limit: 160},message:"must NOT have more than 160 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(func1(data2) < 1){
const err4 = {instancePath:instancePath+"/displayName",schemaPath:"#/properties/displayName/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
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
const err5 = {instancePath:instancePath+"/displayName",schemaPath:"#/properties/displayName/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
validate112.errors = vErrors;
return errors === 0;
}
validate112.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const validateSelectionValidation = validate115;
const schema45 = {"type":"object","additionalProperties":true,"required":["selection","executionAvailable"],"properties":{"selection":{"type":"array","items":{"$ref":"#/$defs/SelectionDisplay"},"maxItems":58},"executionAvailable":{"type":"boolean"}},"description":"Successful validation is observational only. Does not mint a grant or authorize external side effects; submit must recheck atomically. Empty selection remains valid with execution unavailable."};

function validate115(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate115.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.selection === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "selection"},message:"must have required property '"+"selection"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.executionAvailable === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "executionAvailable"},message:"must have required property '"+"executionAvailable"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.selection !== undefined){
let data0 = data.selection;
if(Array.isArray(data0)){
if(data0.length > 58){
const err2 = {instancePath:instancePath+"/selection",schemaPath:"#/properties/selection/maxItems",keyword:"maxItems",params:{limit: 58},message:"must NOT have more than 58 items"};
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
if(!(validate112(data0[i0], {instancePath:instancePath+"/selection/" + i0,parentData:data0,parentDataProperty:i0,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate112.errors : vErrors.concat(validate112.errors);
errors = vErrors.length;
}
}
}
else {
const err3 = {instancePath:instancePath+"/selection",schemaPath:"#/properties/selection/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.executionAvailable !== undefined){
if(typeof data.executionAvailable !== "boolean"){
const err4 = {instancePath:instancePath+"/executionAvailable",schemaPath:"#/properties/executionAvailable/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
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
const err5 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
validate115.errors = vErrors;
return errors === 0;
}
validate115.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const validateEmptyPayload = validate117;
const schema46 = {"type":"object","additionalProperties":false,"required":[],"properties":{}};

function validate117(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate117.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
for(const key0 in data){
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
validate117.errors = vErrors;
return errors === 0;
}
validate117.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const validateInstallPayload = validate118;
const schema47 = {"type":"object","additionalProperties":false,"required":["serviceId","operationId","expectedRevision"],"properties":{"serviceId":{"$ref":"#/$defs/ServiceId"},"operationId":{"$ref":"#/$defs/CanonicalId"},"expectedRevision":{"$ref":"#/$defs/InitialRevision"}}};

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
if(data.serviceId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "serviceId"},message:"must have required property '"+"serviceId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.operationId === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "operationId"},message:"must have required property '"+"operationId"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.expectedRevision === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "expectedRevision"},message:"must have required property '"+"expectedRevision"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "serviceId") || (key0 === "operationId")) || (key0 === "expectedRevision"))){
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
if(data.serviceId !== undefined){
if(!(validate54(data.serviceId, {instancePath:instancePath+"/serviceId",parentData:data,parentDataProperty:"serviceId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
errors = vErrors.length;
}
}
if(data.operationId !== undefined){
if(!(validate53(data.operationId, {instancePath:instancePath+"/operationId",parentData:data,parentDataProperty:"operationId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.expectedRevision !== undefined){
if(!(validate56(data.expectedRevision, {instancePath:instancePath+"/expectedRevision",parentData:data,parentDataProperty:"expectedRevision",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate56.errors : vErrors.concat(validate56.errors);
errors = vErrors.length;
}
}
}
else {
const err4 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
validate118.errors = vErrors;
return errors === 0;
}
validate118.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const validateInstallationOperationPayload = validate122;
const schema48 = {"type":"object","additionalProperties":false,"required":["installationId","operationId","expectedRevision"],"properties":{"installationId":{"$ref":"#/$defs/CanonicalId"},"operationId":{"$ref":"#/$defs/CanonicalId"},"expectedRevision":{"$ref":"#/$defs/Revision"}}};

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
if(data.installationId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "installationId"},message:"must have required property '"+"installationId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.operationId === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "operationId"},message:"must have required property '"+"operationId"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.expectedRevision === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "expectedRevision"},message:"must have required property '"+"expectedRevision"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "installationId") || (key0 === "operationId")) || (key0 === "expectedRevision"))){
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
if(data.installationId !== undefined){
if(!(validate53(data.installationId, {instancePath:instancePath+"/installationId",parentData:data,parentDataProperty:"installationId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.operationId !== undefined){
if(!(validate53(data.operationId, {instancePath:instancePath+"/operationId",parentData:data,parentDataProperty:"operationId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.expectedRevision !== undefined){
if(!(validate55(data.expectedRevision, {instancePath:instancePath+"/expectedRevision",parentData:data,parentDataProperty:"expectedRevision",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate55.errors : vErrors.concat(validate55.errors);
errors = vErrors.length;
}
}
}
else {
const err4 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
validate122.errors = vErrors;
return errors === 0;
}
validate122.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const validateCredentialOperationPayload = validate126;
const schema49 = {"type":"object","additionalProperties":false,"required":["installationId","operationId","expectedRevision","expectedGeneration"],"properties":{"installationId":{"$ref":"#/$defs/CanonicalId"},"operationId":{"$ref":"#/$defs/CanonicalId"},"expectedRevision":{"$ref":"#/$defs/Revision"},"expectedGeneration":{"$ref":"#/$defs/Revision"}},"description":"Starts a trusted native credential/auth flow only. No secret values, URL, command, file path, provider client settings, key/value map or caller-provided credential reference."};

function validate126(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate126.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.installationId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "installationId"},message:"must have required property '"+"installationId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.operationId === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "operationId"},message:"must have required property '"+"operationId"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.expectedRevision === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "expectedRevision"},message:"must have required property '"+"expectedRevision"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.expectedGeneration === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "expectedGeneration"},message:"must have required property '"+"expectedGeneration"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "installationId") || (key0 === "operationId")) || (key0 === "expectedRevision")) || (key0 === "expectedGeneration"))){
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
if(data.installationId !== undefined){
if(!(validate53(data.installationId, {instancePath:instancePath+"/installationId",parentData:data,parentDataProperty:"installationId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.operationId !== undefined){
if(!(validate53(data.operationId, {instancePath:instancePath+"/operationId",parentData:data,parentDataProperty:"operationId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.expectedRevision !== undefined){
if(!(validate55(data.expectedRevision, {instancePath:instancePath+"/expectedRevision",parentData:data,parentDataProperty:"expectedRevision",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate55.errors : vErrors.concat(validate55.errors);
errors = vErrors.length;
}
}
if(data.expectedGeneration !== undefined){
if(!(validate55(data.expectedGeneration, {instancePath:instancePath+"/expectedGeneration",parentData:data,parentDataProperty:"expectedGeneration",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate55.errors : vErrors.concat(validate55.errors);
errors = vErrors.length;
}
}
}
else {
const err5 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
validate126.errors = vErrors;
return errors === 0;
}
validate126.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const validateSetEnabledPayload = validate131;
const schema50 = {"type":"object","additionalProperties":false,"required":["installationId","operationId","expectedRevision","desiredEnabled"],"properties":{"installationId":{"$ref":"#/$defs/CanonicalId"},"operationId":{"$ref":"#/$defs/CanonicalId"},"expectedRevision":{"$ref":"#/$defs/Revision"},"desiredEnabled":{"type":"boolean"}}};

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
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.installationId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "installationId"},message:"must have required property '"+"installationId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.operationId === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "operationId"},message:"must have required property '"+"operationId"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.expectedRevision === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "expectedRevision"},message:"must have required property '"+"expectedRevision"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.desiredEnabled === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "desiredEnabled"},message:"must have required property '"+"desiredEnabled"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "installationId") || (key0 === "operationId")) || (key0 === "expectedRevision")) || (key0 === "desiredEnabled"))){
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
if(data.installationId !== undefined){
if(!(validate53(data.installationId, {instancePath:instancePath+"/installationId",parentData:data,parentDataProperty:"installationId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.operationId !== undefined){
if(!(validate53(data.operationId, {instancePath:instancePath+"/operationId",parentData:data,parentDataProperty:"operationId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.expectedRevision !== undefined){
if(!(validate55(data.expectedRevision, {instancePath:instancePath+"/expectedRevision",parentData:data,parentDataProperty:"expectedRevision",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate55.errors : vErrors.concat(validate55.errors);
errors = vErrors.length;
}
}
if(data.desiredEnabled !== undefined){
if(typeof data.desiredEnabled !== "boolean"){
const err5 = {instancePath:instancePath+"/desiredEnabled",schemaPath:"#/properties/desiredEnabled/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
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
validate131.errors = vErrors;
return errors === 0;
}
validate131.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const validateUninstallPayload = validate135;
const schema51 = {"type":"object","additionalProperties":false,"required":["installationId","operationId","expectedRevision","confirmed"],"properties":{"installationId":{"$ref":"#/$defs/CanonicalId"},"operationId":{"$ref":"#/$defs/CanonicalId"},"expectedRevision":{"$ref":"#/$defs/Revision"},"confirmed":{"type":"boolean","const":true}},"description":"Product uninstall confirmation, not a platform-write approval. Tombstone/fence first; cleanup acknowledgement is required before completion."};

function validate135(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate135.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.installationId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "installationId"},message:"must have required property '"+"installationId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.operationId === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "operationId"},message:"must have required property '"+"operationId"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.expectedRevision === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "expectedRevision"},message:"must have required property '"+"expectedRevision"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.confirmed === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "confirmed"},message:"must have required property '"+"confirmed"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "installationId") || (key0 === "operationId")) || (key0 === "expectedRevision")) || (key0 === "confirmed"))){
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
if(data.installationId !== undefined){
if(!(validate53(data.installationId, {instancePath:instancePath+"/installationId",parentData:data,parentDataProperty:"installationId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.operationId !== undefined){
if(!(validate53(data.operationId, {instancePath:instancePath+"/operationId",parentData:data,parentDataProperty:"operationId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.expectedRevision !== undefined){
if(!(validate55(data.expectedRevision, {instancePath:instancePath+"/expectedRevision",parentData:data,parentDataProperty:"expectedRevision",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate55.errors : vErrors.concat(validate55.errors);
errors = vErrors.length;
}
}
if(data.confirmed !== undefined){
let data3 = data.confirmed;
if(typeof data3 !== "boolean"){
const err5 = {instancePath:instancePath+"/confirmed",schemaPath:"#/properties/confirmed/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(true !== data3){
const err6 = {instancePath:instancePath+"/confirmed",schemaPath:"#/properties/confirmed/const",keyword:"const",params:{allowedValue: true},message:"must be equal to constant"};
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
const err7 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
validate135.errors = vErrors;
return errors === 0;
}
validate135.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const validateOperationReadPayload = validate139;
const schema52 = {"type":"object","additionalProperties":false,"required":["operationId"],"properties":{"operationId":{"$ref":"#/$defs/CanonicalId"}}};

function validate139(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate139.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.operationId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "operationId"},message:"must have required property '"+"operationId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "operationId")){
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
if(data.operationId !== undefined){
if(!(validate53(data.operationId, {instancePath:instancePath+"/operationId",parentData:data,parentDataProperty:"operationId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
}
else {
const err2 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
validate139.errors = vErrors;
return errors === 0;
}
validate139.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const validateOperationCancelPayload = validate141;
const schema53 = {"type":"object","additionalProperties":false,"required":["operationId","expectedRevision"],"properties":{"operationId":{"$ref":"#/$defs/CanonicalId"},"expectedRevision":{"$ref":"#/$defs/Revision"}},"description":"Targets the original operation receipt revision. Cancellation only affects cancellable stages and never asserts reversal of an external action."};

function validate141(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
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
if(data.operationId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "operationId"},message:"must have required property '"+"operationId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.expectedRevision === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "expectedRevision"},message:"must have required property '"+"expectedRevision"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!((key0 === "operationId") || (key0 === "expectedRevision"))){
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
if(data.operationId !== undefined){
if(!(validate53(data.operationId, {instancePath:instancePath+"/operationId",parentData:data,parentDataProperty:"operationId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.expectedRevision !== undefined){
if(!(validate55(data.expectedRevision, {instancePath:instancePath+"/expectedRevision",parentData:data,parentDataProperty:"expectedRevision",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate55.errors : vErrors.concat(validate55.errors);
errors = vErrors.length;
}
}
}
else {
const err3 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
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

export const validateSelectionValidatePayload = validate144;
const schema54 = {"type":"object","additionalProperties":false,"required":["selection"],"properties":{"selection":{"type":"array","items":{"$ref":"#/$defs/SelectionRef"},"maxItems":58,"uniqueItems":true}},"description":"Duplicate installation IDs with different revisions are a semantic error even though JSON uniqueItems alone cannot detect them."};

function validate144(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate144.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.selection === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "selection"},message:"must have required property '"+"selection"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "selection")){
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
if(data.selection !== undefined){
let data0 = data.selection;
if(Array.isArray(data0)){
if(data0.length > 58){
const err2 = {instancePath:instancePath+"/selection",schemaPath:"#/properties/selection/maxItems",keyword:"maxItems",params:{limit: 58},message:"must NOT have more than 58 items"};
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
if(!(validate108(data0[i0], {instancePath:instancePath+"/selection/" + i0,parentData:data0,parentDataProperty:i0,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate108.errors : vErrors.concat(validate108.errors);
errors = vErrors.length;
}
}
let i1 = data0.length;
let j0;
if(i1 > 1){
outer0:
for(;i1--;){
for(j0 = i1; j0--;){
if(func0(data0[i1], data0[j0])){
const err3 = {instancePath:instancePath+"/selection",schemaPath:"#/properties/selection/uniqueItems",keyword:"uniqueItems",params:{i: i1, j: j0},message:"must NOT have duplicate items (items ## "+j0+" and "+i1+" are identical)"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
break outer0;
}
}
}
}
}
else {
const err4 = {instancePath:instancePath+"/selection",schemaPath:"#/properties/selection/type",keyword:"type",params:{type: "array"},message:"must be array"};
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
const err5 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
validate144.errors = vErrors;
return errors === 0;
}
validate144.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const validateSnapshotRequest = validate146;
const schema55 = {"type":"object","additionalProperties":false,"required":["schemaVersion","requestId","contextId","payload"],"properties":{"schemaVersion":{"$ref":"#/$defs/SchemaVersion"},"requestId":{"$ref":"#/$defs/CanonicalId"},"contextId":{"$ref":"#/$defs/CanonicalId"},"payload":{"$ref":"#/$defs/EmptyPayload"}},"description":"Context comes from existing chat_bind_management_context_v1. Native independently validates the current fixed local scope and required permission; request contains no identity/tenant override."};

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
if(data.schemaVersion === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "schemaVersion"},message:"must have required property '"+"schemaVersion"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.requestId === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "requestId"},message:"must have required property '"+"requestId"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.contextId === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "contextId"},message:"must have required property '"+"contextId"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.payload === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "payload"},message:"must have required property '"+"payload"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "schemaVersion") || (key0 === "requestId")) || (key0 === "contextId")) || (key0 === "payload"))){
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
if(data.schemaVersion !== undefined){
if(!(validate57(data.schemaVersion, {instancePath:instancePath+"/schemaVersion",parentData:data,parentDataProperty:"schemaVersion",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate57.errors : vErrors.concat(validate57.errors);
errors = vErrors.length;
}
}
if(data.requestId !== undefined){
if(!(validate53(data.requestId, {instancePath:instancePath+"/requestId",parentData:data,parentDataProperty:"requestId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.contextId !== undefined){
if(!(validate53(data.contextId, {instancePath:instancePath+"/contextId",parentData:data,parentDataProperty:"contextId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.payload !== undefined){
if(!(validate117(data.payload, {instancePath:instancePath+"/payload",parentData:data,parentDataProperty:"payload",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate117.errors : vErrors.concat(validate117.errors);
errors = vErrors.length;
}
}
}
else {
const err5 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
validate146.errors = vErrors;
return errors === 0;
}
validate146.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const validateSnapshotResponse = validate151;
const schema56 = {"type":"object","additionalProperties":true,"required":["schemaVersion","requestId","data"],"properties":{"schemaVersion":{"$ref":"#/$defs/SchemaVersion"},"requestId":{"$ref":"#/$defs/CanonicalId"},"data":{"$ref":"#/$defs/Snapshot"}}};

function validate151(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate151.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.schemaVersion === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "schemaVersion"},message:"must have required property '"+"schemaVersion"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.requestId === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "requestId"},message:"must have required property '"+"requestId"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.data === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "data"},message:"must have required property '"+"data"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.schemaVersion !== undefined){
if(!(validate57(data.schemaVersion, {instancePath:instancePath+"/schemaVersion",parentData:data,parentDataProperty:"schemaVersion",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate57.errors : vErrors.concat(validate57.errors);
errors = vErrors.length;
}
}
if(data.requestId !== undefined){
if(!(validate53(data.requestId, {instancePath:instancePath+"/requestId",parentData:data,parentDataProperty:"requestId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.data !== undefined){
if(!(validate100(data.data, {instancePath:instancePath+"/data",parentData:data,parentDataProperty:"data",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate100.errors : vErrors.concat(validate100.errors);
errors = vErrors.length;
}
}
}
else {
const err3 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
validate151.errors = vErrors;
return errors === 0;
}
validate151.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const validateInstallRequest = validate155;
const schema57 = {"type":"object","additionalProperties":false,"required":["schemaVersion","requestId","contextId","payload"],"properties":{"schemaVersion":{"$ref":"#/$defs/SchemaVersion"},"requestId":{"$ref":"#/$defs/CanonicalId"},"contextId":{"$ref":"#/$defs/CanonicalId"},"payload":{"$ref":"#/$defs/InstallPayload"}},"description":"Context comes from existing chat_bind_management_context_v1. Native independently validates the current fixed local scope and required permission; request contains no identity/tenant override."};

function validate155(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate155.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.schemaVersion === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "schemaVersion"},message:"must have required property '"+"schemaVersion"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.requestId === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "requestId"},message:"must have required property '"+"requestId"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.contextId === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "contextId"},message:"must have required property '"+"contextId"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.payload === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "payload"},message:"must have required property '"+"payload"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "schemaVersion") || (key0 === "requestId")) || (key0 === "contextId")) || (key0 === "payload"))){
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
if(data.schemaVersion !== undefined){
if(!(validate57(data.schemaVersion, {instancePath:instancePath+"/schemaVersion",parentData:data,parentDataProperty:"schemaVersion",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate57.errors : vErrors.concat(validate57.errors);
errors = vErrors.length;
}
}
if(data.requestId !== undefined){
if(!(validate53(data.requestId, {instancePath:instancePath+"/requestId",parentData:data,parentDataProperty:"requestId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.contextId !== undefined){
if(!(validate53(data.contextId, {instancePath:instancePath+"/contextId",parentData:data,parentDataProperty:"contextId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.payload !== undefined){
if(!(validate118(data.payload, {instancePath:instancePath+"/payload",parentData:data,parentDataProperty:"payload",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate118.errors : vErrors.concat(validate118.errors);
errors = vErrors.length;
}
}
}
else {
const err5 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
validate155.errors = vErrors;
return errors === 0;
}
validate155.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const validateMutationResponse = validate160;
const schema58 = {"type":"object","additionalProperties":true,"required":["schemaVersion","requestId","data"],"properties":{"schemaVersion":{"$ref":"#/$defs/SchemaVersion"},"requestId":{"$ref":"#/$defs/CanonicalId"},"data":{"$ref":"#/$defs/MutationResult"}}};

function validate160(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate160.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.schemaVersion === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "schemaVersion"},message:"must have required property '"+"schemaVersion"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.requestId === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "requestId"},message:"must have required property '"+"requestId"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.data === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "data"},message:"must have required property '"+"data"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.schemaVersion !== undefined){
if(!(validate57(data.schemaVersion, {instancePath:instancePath+"/schemaVersion",parentData:data,parentDataProperty:"schemaVersion",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate57.errors : vErrors.concat(validate57.errors);
errors = vErrors.length;
}
}
if(data.requestId !== undefined){
if(!(validate53(data.requestId, {instancePath:instancePath+"/requestId",parentData:data,parentDataProperty:"requestId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.data !== undefined){
if(!(validate105(data.data, {instancePath:instancePath+"/data",parentData:data,parentDataProperty:"data",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate105.errors : vErrors.concat(validate105.errors);
errors = vErrors.length;
}
}
}
else {
const err3 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
validate160.errors = vErrors;
return errors === 0;
}
validate160.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const validateSetEnabledRequest = validate164;
const schema59 = {"type":"object","additionalProperties":false,"required":["schemaVersion","requestId","contextId","payload"],"properties":{"schemaVersion":{"$ref":"#/$defs/SchemaVersion"},"requestId":{"$ref":"#/$defs/CanonicalId"},"contextId":{"$ref":"#/$defs/CanonicalId"},"payload":{"$ref":"#/$defs/SetEnabledPayload"}},"description":"Context comes from existing chat_bind_management_context_v1. Native independently validates the current fixed local scope and required permission; request contains no identity/tenant override."};

function validate164(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate164.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.schemaVersion === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "schemaVersion"},message:"must have required property '"+"schemaVersion"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.requestId === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "requestId"},message:"must have required property '"+"requestId"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.contextId === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "contextId"},message:"must have required property '"+"contextId"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.payload === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "payload"},message:"must have required property '"+"payload"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "schemaVersion") || (key0 === "requestId")) || (key0 === "contextId")) || (key0 === "payload"))){
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
if(data.schemaVersion !== undefined){
if(!(validate57(data.schemaVersion, {instancePath:instancePath+"/schemaVersion",parentData:data,parentDataProperty:"schemaVersion",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate57.errors : vErrors.concat(validate57.errors);
errors = vErrors.length;
}
}
if(data.requestId !== undefined){
if(!(validate53(data.requestId, {instancePath:instancePath+"/requestId",parentData:data,parentDataProperty:"requestId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.contextId !== undefined){
if(!(validate53(data.contextId, {instancePath:instancePath+"/contextId",parentData:data,parentDataProperty:"contextId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.payload !== undefined){
if(!(validate131(data.payload, {instancePath:instancePath+"/payload",parentData:data,parentDataProperty:"payload",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate131.errors : vErrors.concat(validate131.errors);
errors = vErrors.length;
}
}
}
else {
const err5 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
validate164.errors = vErrors;
return errors === 0;
}
validate164.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const validateUninstallRequest = validate169;
const schema60 = {"type":"object","additionalProperties":false,"required":["schemaVersion","requestId","contextId","payload"],"properties":{"schemaVersion":{"$ref":"#/$defs/SchemaVersion"},"requestId":{"$ref":"#/$defs/CanonicalId"},"contextId":{"$ref":"#/$defs/CanonicalId"},"payload":{"$ref":"#/$defs/UninstallPayload"}},"description":"Context comes from existing chat_bind_management_context_v1. Native independently validates the current fixed local scope and required permission; request contains no identity/tenant override."};

function validate169(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate169.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.schemaVersion === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "schemaVersion"},message:"must have required property '"+"schemaVersion"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.requestId === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "requestId"},message:"must have required property '"+"requestId"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.contextId === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "contextId"},message:"must have required property '"+"contextId"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.payload === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "payload"},message:"must have required property '"+"payload"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "schemaVersion") || (key0 === "requestId")) || (key0 === "contextId")) || (key0 === "payload"))){
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
if(data.schemaVersion !== undefined){
if(!(validate57(data.schemaVersion, {instancePath:instancePath+"/schemaVersion",parentData:data,parentDataProperty:"schemaVersion",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate57.errors : vErrors.concat(validate57.errors);
errors = vErrors.length;
}
}
if(data.requestId !== undefined){
if(!(validate53(data.requestId, {instancePath:instancePath+"/requestId",parentData:data,parentDataProperty:"requestId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.contextId !== undefined){
if(!(validate53(data.contextId, {instancePath:instancePath+"/contextId",parentData:data,parentDataProperty:"contextId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.payload !== undefined){
if(!(validate135(data.payload, {instancePath:instancePath+"/payload",parentData:data,parentDataProperty:"payload",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate135.errors : vErrors.concat(validate135.errors);
errors = vErrors.length;
}
}
}
else {
const err5 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
validate169.errors = vErrors;
return errors === 0;
}
validate169.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const validateConfigureRequest = validate174;
const schema61 = {"type":"object","additionalProperties":false,"required":["schemaVersion","requestId","contextId","payload"],"properties":{"schemaVersion":{"$ref":"#/$defs/SchemaVersion"},"requestId":{"$ref":"#/$defs/CanonicalId"},"contextId":{"$ref":"#/$defs/CanonicalId"},"payload":{"$ref":"#/$defs/CredentialOperationPayload"}},"description":"Context comes from existing chat_bind_management_context_v1. Native independently validates the current fixed local scope and required permission; request contains no identity/tenant override."};

function validate174(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate174.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.schemaVersion === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "schemaVersion"},message:"must have required property '"+"schemaVersion"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.requestId === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "requestId"},message:"must have required property '"+"requestId"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.contextId === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "contextId"},message:"must have required property '"+"contextId"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.payload === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "payload"},message:"must have required property '"+"payload"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "schemaVersion") || (key0 === "requestId")) || (key0 === "contextId")) || (key0 === "payload"))){
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
if(data.schemaVersion !== undefined){
if(!(validate57(data.schemaVersion, {instancePath:instancePath+"/schemaVersion",parentData:data,parentDataProperty:"schemaVersion",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate57.errors : vErrors.concat(validate57.errors);
errors = vErrors.length;
}
}
if(data.requestId !== undefined){
if(!(validate53(data.requestId, {instancePath:instancePath+"/requestId",parentData:data,parentDataProperty:"requestId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.contextId !== undefined){
if(!(validate53(data.contextId, {instancePath:instancePath+"/contextId",parentData:data,parentDataProperty:"contextId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.payload !== undefined){
if(!(validate126(data.payload, {instancePath:instancePath+"/payload",parentData:data,parentDataProperty:"payload",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate126.errors : vErrors.concat(validate126.errors);
errors = vErrors.length;
}
}
}
else {
const err5 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
validate174.errors = vErrors;
return errors === 0;
}
validate174.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const validateAuthorizeRequest = validate179;
const schema62 = {"type":"object","additionalProperties":false,"required":["schemaVersion","requestId","contextId","payload"],"properties":{"schemaVersion":{"$ref":"#/$defs/SchemaVersion"},"requestId":{"$ref":"#/$defs/CanonicalId"},"contextId":{"$ref":"#/$defs/CanonicalId"},"payload":{"$ref":"#/$defs/CredentialOperationPayload"}},"description":"Context comes from existing chat_bind_management_context_v1. Native independently validates the current fixed local scope and required permission; request contains no identity/tenant override."};

function validate179(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate179.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.schemaVersion === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "schemaVersion"},message:"must have required property '"+"schemaVersion"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.requestId === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "requestId"},message:"must have required property '"+"requestId"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.contextId === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "contextId"},message:"must have required property '"+"contextId"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.payload === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "payload"},message:"must have required property '"+"payload"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "schemaVersion") || (key0 === "requestId")) || (key0 === "contextId")) || (key0 === "payload"))){
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
if(data.schemaVersion !== undefined){
if(!(validate57(data.schemaVersion, {instancePath:instancePath+"/schemaVersion",parentData:data,parentDataProperty:"schemaVersion",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate57.errors : vErrors.concat(validate57.errors);
errors = vErrors.length;
}
}
if(data.requestId !== undefined){
if(!(validate53(data.requestId, {instancePath:instancePath+"/requestId",parentData:data,parentDataProperty:"requestId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.contextId !== undefined){
if(!(validate53(data.contextId, {instancePath:instancePath+"/contextId",parentData:data,parentDataProperty:"contextId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.payload !== undefined){
if(!(validate126(data.payload, {instancePath:instancePath+"/payload",parentData:data,parentDataProperty:"payload",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate126.errors : vErrors.concat(validate126.errors);
errors = vErrors.length;
}
}
}
else {
const err5 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
validate179.errors = vErrors;
return errors === 0;
}
validate179.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const validateOperationReadRequest = validate184;
const schema63 = {"type":"object","additionalProperties":false,"required":["schemaVersion","requestId","contextId","payload"],"properties":{"schemaVersion":{"$ref":"#/$defs/SchemaVersion"},"requestId":{"$ref":"#/$defs/CanonicalId"},"contextId":{"$ref":"#/$defs/CanonicalId"},"payload":{"$ref":"#/$defs/OperationReadPayload"}},"description":"Context comes from existing chat_bind_management_context_v1. Native independently validates the current fixed local scope and required permission; request contains no identity/tenant override."};

function validate184(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate184.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.schemaVersion === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "schemaVersion"},message:"must have required property '"+"schemaVersion"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.requestId === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "requestId"},message:"must have required property '"+"requestId"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.contextId === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "contextId"},message:"must have required property '"+"contextId"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.payload === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "payload"},message:"must have required property '"+"payload"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "schemaVersion") || (key0 === "requestId")) || (key0 === "contextId")) || (key0 === "payload"))){
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
if(data.schemaVersion !== undefined){
if(!(validate57(data.schemaVersion, {instancePath:instancePath+"/schemaVersion",parentData:data,parentDataProperty:"schemaVersion",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate57.errors : vErrors.concat(validate57.errors);
errors = vErrors.length;
}
}
if(data.requestId !== undefined){
if(!(validate53(data.requestId, {instancePath:instancePath+"/requestId",parentData:data,parentDataProperty:"requestId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.contextId !== undefined){
if(!(validate53(data.contextId, {instancePath:instancePath+"/contextId",parentData:data,parentDataProperty:"contextId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.payload !== undefined){
if(!(validate139(data.payload, {instancePath:instancePath+"/payload",parentData:data,parentDataProperty:"payload",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate139.errors : vErrors.concat(validate139.errors);
errors = vErrors.length;
}
}
}
else {
const err5 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
validate184.errors = vErrors;
return errors === 0;
}
validate184.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const validateOperationResponse = validate189;
const schema64 = {"type":"object","additionalProperties":true,"required":["schemaVersion","requestId","data"],"properties":{"schemaVersion":{"$ref":"#/$defs/SchemaVersion"},"requestId":{"$ref":"#/$defs/CanonicalId"},"data":{"$ref":"#/$defs/Operation"}}};

function validate189(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate189.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.schemaVersion === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "schemaVersion"},message:"must have required property '"+"schemaVersion"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.requestId === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "requestId"},message:"must have required property '"+"requestId"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.data === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "data"},message:"must have required property '"+"data"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.schemaVersion !== undefined){
if(!(validate57(data.schemaVersion, {instancePath:instancePath+"/schemaVersion",parentData:data,parentDataProperty:"schemaVersion",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate57.errors : vErrors.concat(validate57.errors);
errors = vErrors.length;
}
}
if(data.requestId !== undefined){
if(!(validate53(data.requestId, {instancePath:instancePath+"/requestId",parentData:data,parentDataProperty:"requestId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.data !== undefined){
if(!(validate80(data.data, {instancePath:instancePath+"/data",parentData:data,parentDataProperty:"data",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate80.errors : vErrors.concat(validate80.errors);
errors = vErrors.length;
}
}
}
else {
const err3 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
validate189.errors = vErrors;
return errors === 0;
}
validate189.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const validateOperationCancelRequest = validate193;
const schema65 = {"type":"object","additionalProperties":false,"required":["schemaVersion","requestId","contextId","payload"],"properties":{"schemaVersion":{"$ref":"#/$defs/SchemaVersion"},"requestId":{"$ref":"#/$defs/CanonicalId"},"contextId":{"$ref":"#/$defs/CanonicalId"},"payload":{"$ref":"#/$defs/OperationCancelPayload"}},"description":"Context comes from existing chat_bind_management_context_v1. Native independently validates the current fixed local scope and required permission; request contains no identity/tenant override."};

function validate193(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate193.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.schemaVersion === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "schemaVersion"},message:"must have required property '"+"schemaVersion"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.requestId === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "requestId"},message:"must have required property '"+"requestId"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.contextId === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "contextId"},message:"must have required property '"+"contextId"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.payload === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "payload"},message:"must have required property '"+"payload"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "schemaVersion") || (key0 === "requestId")) || (key0 === "contextId")) || (key0 === "payload"))){
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
if(data.schemaVersion !== undefined){
if(!(validate57(data.schemaVersion, {instancePath:instancePath+"/schemaVersion",parentData:data,parentDataProperty:"schemaVersion",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate57.errors : vErrors.concat(validate57.errors);
errors = vErrors.length;
}
}
if(data.requestId !== undefined){
if(!(validate53(data.requestId, {instancePath:instancePath+"/requestId",parentData:data,parentDataProperty:"requestId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.contextId !== undefined){
if(!(validate53(data.contextId, {instancePath:instancePath+"/contextId",parentData:data,parentDataProperty:"contextId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.payload !== undefined){
if(!(validate141(data.payload, {instancePath:instancePath+"/payload",parentData:data,parentDataProperty:"payload",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate141.errors : vErrors.concat(validate141.errors);
errors = vErrors.length;
}
}
}
else {
const err5 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
validate193.errors = vErrors;
return errors === 0;
}
validate193.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const validateSelectionValidateRequest = validate198;
const schema66 = {"type":"object","additionalProperties":false,"required":["schemaVersion","requestId","contextId","payload"],"properties":{"schemaVersion":{"$ref":"#/$defs/SchemaVersion"},"requestId":{"$ref":"#/$defs/CanonicalId"},"contextId":{"$ref":"#/$defs/CanonicalId"},"payload":{"$ref":"#/$defs/SelectionValidatePayload"}},"description":"Context comes from existing chat_bind_management_context_v1. Native independently validates the current fixed local scope and required permission; request contains no identity/tenant override."};

function validate198(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate198.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.schemaVersion === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "schemaVersion"},message:"must have required property '"+"schemaVersion"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.requestId === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "requestId"},message:"must have required property '"+"requestId"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.contextId === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "contextId"},message:"must have required property '"+"contextId"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.payload === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "payload"},message:"must have required property '"+"payload"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "schemaVersion") || (key0 === "requestId")) || (key0 === "contextId")) || (key0 === "payload"))){
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
if(data.schemaVersion !== undefined){
if(!(validate57(data.schemaVersion, {instancePath:instancePath+"/schemaVersion",parentData:data,parentDataProperty:"schemaVersion",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate57.errors : vErrors.concat(validate57.errors);
errors = vErrors.length;
}
}
if(data.requestId !== undefined){
if(!(validate53(data.requestId, {instancePath:instancePath+"/requestId",parentData:data,parentDataProperty:"requestId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.contextId !== undefined){
if(!(validate53(data.contextId, {instancePath:instancePath+"/contextId",parentData:data,parentDataProperty:"contextId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.payload !== undefined){
if(!(validate144(data.payload, {instancePath:instancePath+"/payload",parentData:data,parentDataProperty:"payload",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate144.errors : vErrors.concat(validate144.errors);
errors = vErrors.length;
}
}
}
else {
const err5 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
validate198.errors = vErrors;
return errors === 0;
}
validate198.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const validateSelectionValidateResponse = validate203;
const schema67 = {"type":"object","additionalProperties":true,"required":["schemaVersion","requestId","data"],"properties":{"schemaVersion":{"$ref":"#/$defs/SchemaVersion"},"requestId":{"$ref":"#/$defs/CanonicalId"},"data":{"$ref":"#/$defs/SelectionValidation"}}};

function validate203(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate203.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.schemaVersion === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "schemaVersion"},message:"must have required property '"+"schemaVersion"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.requestId === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "requestId"},message:"must have required property '"+"requestId"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.data === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "data"},message:"must have required property '"+"data"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.schemaVersion !== undefined){
if(!(validate57(data.schemaVersion, {instancePath:instancePath+"/schemaVersion",parentData:data,parentDataProperty:"schemaVersion",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate57.errors : vErrors.concat(validate57.errors);
errors = vErrors.length;
}
}
if(data.requestId !== undefined){
if(!(validate53(data.requestId, {instancePath:instancePath+"/requestId",parentData:data,parentDataProperty:"requestId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.data !== undefined){
if(!(validate115(data.data, {instancePath:instancePath+"/data",parentData:data,parentDataProperty:"data",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate115.errors : vErrors.concat(validate115.errors);
errors = vErrors.length;
}
}
}
else {
const err3 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
validate203.errors = vErrors;
return errors === 0;
}
validate203.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const validateError = validate207;
const schema68 = {"type":"object","additionalProperties":true,"required":["schemaVersion","code","retryable"],"properties":{"schemaVersion":{"$ref":"#/$defs/SchemaVersion"},"requestId":{"$ref":"#/$defs/CanonicalId"},"code":{"$ref":"#/$defs/ErrorCode"},"retryable":{"type":"boolean"}},"description":"No free-text message, provider response, URL, stack, raw arguments or secret. Optional requestId omitted when request identity is invalid. Retryable permits user-led retry/query only, never automatic external write replay."};

function validate207(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate207.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.schemaVersion === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "schemaVersion"},message:"must have required property '"+"schemaVersion"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.code === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "code"},message:"must have required property '"+"code"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.retryable === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "retryable"},message:"must have required property '"+"retryable"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.schemaVersion !== undefined){
if(!(validate57(data.schemaVersion, {instancePath:instancePath+"/schemaVersion",parentData:data,parentDataProperty:"schemaVersion",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate57.errors : vErrors.concat(validate57.errors);
errors = vErrors.length;
}
}
if(data.requestId !== undefined){
if(!(validate53(data.requestId, {instancePath:instancePath+"/requestId",parentData:data,parentDataProperty:"requestId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.code !== undefined){
if(!(validate70(data.code, {instancePath:instancePath+"/code",parentData:data,parentDataProperty:"code",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate70.errors : vErrors.concat(validate70.errors);
errors = vErrors.length;
}
}
if(data.retryable !== undefined){
if(typeof data.retryable !== "boolean"){
const err3 = {instancePath:instancePath+"/retryable",schemaPath:"#/properties/retryable/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
}
else {
const err4 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
validate207.errors = vErrors;
return errors === 0;
}
validate207.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const validateWorkerErrorCode = validate211;
const schema69 = {"type":"string","enum":["invalid_request","not_qualified","unknown_service","temporarily_unavailable"]};

function validate211(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate211.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(typeof data !== "string"){
const err0 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(!((((data === "invalid_request") || (data === "not_qualified")) || (data === "unknown_service")) || (data === "temporarily_unavailable"))){
const err1 = {instancePath,schemaPath:"#/enum",keyword:"enum",params:{allowedValues: schema69.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate211.errors = vErrors;
return errors === 0;
}
validate211.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const validateWorkerLibraryPolicy = validate212;
const schema70 = {"type":"object","additionalProperties":false,"required":["mcpLibrary","oauthStore","credentialBoundary","stdioShutdown","externalCallsEnabled"],"properties":{"mcpLibrary":{"type":"string","const":"codex-rmcp-client"},"oauthStore":{"type":"string","const":"keyring_only"},"credentialBoundary":{"type":"string","const":"connectors_only"},"stdioShutdown":{"type":"string","const":"eof_only"},"externalCallsEnabled":{"type":"boolean","const":false}}};

function validate212(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate212.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.mcpLibrary === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "mcpLibrary"},message:"must have required property '"+"mcpLibrary"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.oauthStore === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "oauthStore"},message:"must have required property '"+"oauthStore"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.credentialBoundary === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "credentialBoundary"},message:"must have required property '"+"credentialBoundary"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.stdioShutdown === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "stdioShutdown"},message:"must have required property '"+"stdioShutdown"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.externalCallsEnabled === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "externalCallsEnabled"},message:"must have required property '"+"externalCallsEnabled"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
for(const key0 in data){
if(!(((((key0 === "mcpLibrary") || (key0 === "oauthStore")) || (key0 === "credentialBoundary")) || (key0 === "stdioShutdown")) || (key0 === "externalCallsEnabled"))){
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
if(data.mcpLibrary !== undefined){
let data0 = data.mcpLibrary;
if(typeof data0 !== "string"){
const err6 = {instancePath:instancePath+"/mcpLibrary",schemaPath:"#/properties/mcpLibrary/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if("codex-rmcp-client" !== data0){
const err7 = {instancePath:instancePath+"/mcpLibrary",schemaPath:"#/properties/mcpLibrary/const",keyword:"const",params:{allowedValue: "codex-rmcp-client"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.oauthStore !== undefined){
let data1 = data.oauthStore;
if(typeof data1 !== "string"){
const err8 = {instancePath:instancePath+"/oauthStore",schemaPath:"#/properties/oauthStore/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if("keyring_only" !== data1){
const err9 = {instancePath:instancePath+"/oauthStore",schemaPath:"#/properties/oauthStore/const",keyword:"const",params:{allowedValue: "keyring_only"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.credentialBoundary !== undefined){
let data2 = data.credentialBoundary;
if(typeof data2 !== "string"){
const err10 = {instancePath:instancePath+"/credentialBoundary",schemaPath:"#/properties/credentialBoundary/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if("connectors_only" !== data2){
const err11 = {instancePath:instancePath+"/credentialBoundary",schemaPath:"#/properties/credentialBoundary/const",keyword:"const",params:{allowedValue: "connectors_only"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.stdioShutdown !== undefined){
let data3 = data.stdioShutdown;
if(typeof data3 !== "string"){
const err12 = {instancePath:instancePath+"/stdioShutdown",schemaPath:"#/properties/stdioShutdown/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if("eof_only" !== data3){
const err13 = {instancePath:instancePath+"/stdioShutdown",schemaPath:"#/properties/stdioShutdown/const",keyword:"const",params:{allowedValue: "eof_only"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data.externalCallsEnabled !== undefined){
let data4 = data.externalCallsEnabled;
if(typeof data4 !== "boolean"){
const err14 = {instancePath:instancePath+"/externalCallsEnabled",schemaPath:"#/properties/externalCallsEnabled/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(false !== data4){
const err15 = {instancePath:instancePath+"/externalCallsEnabled",schemaPath:"#/properties/externalCallsEnabled/const",keyword:"const",params:{allowedValue: false},message:"must be equal to constant"};
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
validate212.errors = vErrors;
return errors === 0;
}
validate212.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const validateWorkerAuthStatusRequest = validate213;
const schema71 = {"type":"object","additionalProperties":false,"required":["schemaVersion","requestId","method","serviceId"],"properties":{"schemaVersion":{"$ref":"#/$defs/SchemaVersion"},"requestId":{"$ref":"#/$defs/CanonicalId"},"method":{"type":"string","const":"auth_status"},"serviceId":{"$ref":"#/$defs/ServiceId"}},"description":"Private EOF-owned Connectors worker stdin control only, never a Runtime RPC or renderer invoke. Reads no credential and starts no network/OAuth flow. Unknown service is distinct from known service not qualified."};

function validate213(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate213.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.schemaVersion === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "schemaVersion"},message:"must have required property '"+"schemaVersion"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.requestId === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "requestId"},message:"must have required property '"+"requestId"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.method === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "method"},message:"must have required property '"+"method"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.serviceId === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "serviceId"},message:"must have required property '"+"serviceId"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "schemaVersion") || (key0 === "requestId")) || (key0 === "method")) || (key0 === "serviceId"))){
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
if(data.schemaVersion !== undefined){
if(!(validate57(data.schemaVersion, {instancePath:instancePath+"/schemaVersion",parentData:data,parentDataProperty:"schemaVersion",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate57.errors : vErrors.concat(validate57.errors);
errors = vErrors.length;
}
}
if(data.requestId !== undefined){
if(!(validate53(data.requestId, {instancePath:instancePath+"/requestId",parentData:data,parentDataProperty:"requestId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.method !== undefined){
let data2 = data.method;
if(typeof data2 !== "string"){
const err5 = {instancePath:instancePath+"/method",schemaPath:"#/properties/method/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if("auth_status" !== data2){
const err6 = {instancePath:instancePath+"/method",schemaPath:"#/properties/method/const",keyword:"const",params:{allowedValue: "auth_status"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.serviceId !== undefined){
if(!(validate54(data.serviceId, {instancePath:instancePath+"/serviceId",parentData:data,parentDataProperty:"serviceId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
errors = vErrors.length;
}
}
}
else {
const err7 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
validate213.errors = vErrors;
return errors === 0;
}
validate213.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const validateWorkerAuthStatus = validate217;
const schema72 = {"type":"object","additionalProperties":false,"required":["serviceId","qualification","authorizationStatus","connectionStatus","executionAvailable","libraryPolicy"],"properties":{"serviceId":{"$ref":"#/$defs/ServiceId"},"qualification":{"type":"string","const":"not_qualified"},"authorizationStatus":{"type":"string","const":"unknown"},"connectionStatus":{"type":"string","const":"disconnected"},"executionAvailable":{"type":"boolean","const":false},"libraryPolicy":{"$ref":"#/$defs/WorkerLibraryPolicy"}}};

function validate217(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate217.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.serviceId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "serviceId"},message:"must have required property '"+"serviceId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.qualification === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "qualification"},message:"must have required property '"+"qualification"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.authorizationStatus === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "authorizationStatus"},message:"must have required property '"+"authorizationStatus"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.connectionStatus === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "connectionStatus"},message:"must have required property '"+"connectionStatus"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.executionAvailable === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "executionAvailable"},message:"must have required property '"+"executionAvailable"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.libraryPolicy === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "libraryPolicy"},message:"must have required property '"+"libraryPolicy"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
for(const key0 in data){
if(!((((((key0 === "serviceId") || (key0 === "qualification")) || (key0 === "authorizationStatus")) || (key0 === "connectionStatus")) || (key0 === "executionAvailable")) || (key0 === "libraryPolicy"))){
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
if(data.serviceId !== undefined){
if(!(validate54(data.serviceId, {instancePath:instancePath+"/serviceId",parentData:data,parentDataProperty:"serviceId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
errors = vErrors.length;
}
}
if(data.qualification !== undefined){
let data1 = data.qualification;
if(typeof data1 !== "string"){
const err7 = {instancePath:instancePath+"/qualification",schemaPath:"#/properties/qualification/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if("not_qualified" !== data1){
const err8 = {instancePath:instancePath+"/qualification",schemaPath:"#/properties/qualification/const",keyword:"const",params:{allowedValue: "not_qualified"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.authorizationStatus !== undefined){
let data2 = data.authorizationStatus;
if(typeof data2 !== "string"){
const err9 = {instancePath:instancePath+"/authorizationStatus",schemaPath:"#/properties/authorizationStatus/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if("unknown" !== data2){
const err10 = {instancePath:instancePath+"/authorizationStatus",schemaPath:"#/properties/authorizationStatus/const",keyword:"const",params:{allowedValue: "unknown"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.connectionStatus !== undefined){
let data3 = data.connectionStatus;
if(typeof data3 !== "string"){
const err11 = {instancePath:instancePath+"/connectionStatus",schemaPath:"#/properties/connectionStatus/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if("disconnected" !== data3){
const err12 = {instancePath:instancePath+"/connectionStatus",schemaPath:"#/properties/connectionStatus/const",keyword:"const",params:{allowedValue: "disconnected"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.executionAvailable !== undefined){
let data4 = data.executionAvailable;
if(typeof data4 !== "boolean"){
const err13 = {instancePath:instancePath+"/executionAvailable",schemaPath:"#/properties/executionAvailable/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(false !== data4){
const err14 = {instancePath:instancePath+"/executionAvailable",schemaPath:"#/properties/executionAvailable/const",keyword:"const",params:{allowedValue: false},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data.libraryPolicy !== undefined){
if(!(validate212(data.libraryPolicy, {instancePath:instancePath+"/libraryPolicy",parentData:data,parentDataProperty:"libraryPolicy",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate212.errors : vErrors.concat(validate212.errors);
errors = vErrors.length;
}
}
}
else {
const err15 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
validate217.errors = vErrors;
return errors === 0;
}
validate217.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const validateWorkerAuthStatusResponse = validate220;
const schema73 = {"type":"object","additionalProperties":false,"required":["schemaVersion","requestId","data"],"properties":{"schemaVersion":{"$ref":"#/$defs/SchemaVersion"},"requestId":{"$ref":"#/$defs/CanonicalId"},"data":{"$ref":"#/$defs/WorkerAuthStatus"}}};

function validate220(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate220.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.schemaVersion === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "schemaVersion"},message:"must have required property '"+"schemaVersion"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.requestId === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "requestId"},message:"must have required property '"+"requestId"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.data === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "data"},message:"must have required property '"+"data"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "schemaVersion") || (key0 === "requestId")) || (key0 === "data"))){
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
if(data.schemaVersion !== undefined){
if(!(validate57(data.schemaVersion, {instancePath:instancePath+"/schemaVersion",parentData:data,parentDataProperty:"schemaVersion",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate57.errors : vErrors.concat(validate57.errors);
errors = vErrors.length;
}
}
if(data.requestId !== undefined){
if(!(validate53(data.requestId, {instancePath:instancePath+"/requestId",parentData:data,parentDataProperty:"requestId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.data !== undefined){
if(!(validate217(data.data, {instancePath:instancePath+"/data",parentData:data,parentDataProperty:"data",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate217.errors : vErrors.concat(validate217.errors);
errors = vErrors.length;
}
}
}
else {
const err4 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
validate220.errors = vErrors;
return errors === 0;
}
validate220.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const validateWorkerError = validate224;
const schema74 = {"type":"object","additionalProperties":false,"required":["schemaVersion","code","retryable"],"properties":{"schemaVersion":{"$ref":"#/$defs/SchemaVersion"},"requestId":{"$ref":"#/$defs/CanonicalId"},"code":{"$ref":"#/$defs/WorkerErrorCode"},"retryable":{"type":"boolean"}}};

function validate224(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate224.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.schemaVersion === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "schemaVersion"},message:"must have required property '"+"schemaVersion"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.code === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "code"},message:"must have required property '"+"code"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.retryable === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "retryable"},message:"must have required property '"+"retryable"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "schemaVersion") || (key0 === "requestId")) || (key0 === "code")) || (key0 === "retryable"))){
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
if(data.schemaVersion !== undefined){
if(!(validate57(data.schemaVersion, {instancePath:instancePath+"/schemaVersion",parentData:data,parentDataProperty:"schemaVersion",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate57.errors : vErrors.concat(validate57.errors);
errors = vErrors.length;
}
}
if(data.requestId !== undefined){
if(!(validate53(data.requestId, {instancePath:instancePath+"/requestId",parentData:data,parentDataProperty:"requestId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.code !== undefined){
if(!(validate211(data.code, {instancePath:instancePath+"/code",parentData:data,parentDataProperty:"code",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate211.errors : vErrors.concat(validate211.errors);
errors = vErrors.length;
}
}
if(data.retryable !== undefined){
if(typeof data.retryable !== "boolean"){
const err4 = {instancePath:instancePath+"/retryable",schemaPath:"#/properties/retryable/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
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
const err5 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
validate224.errors = vErrors;
return errors === 0;
}
validate224.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const validateOperationReopenRequest = validate228;
const schema75 = {"type":"object","additionalProperties":false,"required":["schemaVersion","requestId","contextId","payload"],"properties":{"schemaVersion":{"$ref":"#/$defs/SchemaVersion"},"requestId":{"$ref":"#/$defs/CanonicalId"},"contextId":{"$ref":"#/$defs/CanonicalId"},"payload":{"$ref":"#/$defs/OperationCancelPayload"}},"description":"Reopen the current original auth/configure page only; expectedRevision is the operation receipt revision. No URL or new authorization intent."};

function validate228(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate228.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.schemaVersion === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "schemaVersion"},message:"must have required property '"+"schemaVersion"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.requestId === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "requestId"},message:"must have required property '"+"requestId"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.contextId === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "contextId"},message:"must have required property '"+"contextId"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.payload === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "payload"},message:"must have required property '"+"payload"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "schemaVersion") || (key0 === "requestId")) || (key0 === "contextId")) || (key0 === "payload"))){
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
if(data.schemaVersion !== undefined){
if(!(validate57(data.schemaVersion, {instancePath:instancePath+"/schemaVersion",parentData:data,parentDataProperty:"schemaVersion",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate57.errors : vErrors.concat(validate57.errors);
errors = vErrors.length;
}
}
if(data.requestId !== undefined){
if(!(validate53(data.requestId, {instancePath:instancePath+"/requestId",parentData:data,parentDataProperty:"requestId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.contextId !== undefined){
if(!(validate53(data.contextId, {instancePath:instancePath+"/contextId",parentData:data,parentDataProperty:"contextId",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.payload !== undefined){
if(!(validate141(data.payload, {instancePath:instancePath+"/payload",parentData:data,parentDataProperty:"payload",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate141.errors : vErrors.concat(validate141.errors);
errors = vErrors.length;
}
}
}
else {
const err5 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
validate228.errors = vErrors;
return errors === 0;
}
validate228.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};
