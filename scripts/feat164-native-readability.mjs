// Operator copy inspection only. Never prints history content or validation values.
import * as validators from './generated/native-saved-views-validator.gen.mjs';
let text='';for await(const chunk of process.stdin){text+=chunk;if(Buffer.byteLength(text)>16*1024*1024)throw Error('Bounded history inspection exceeded');}
const records=JSON.parse(text);if(!Array.isArray(records))throw Error('Saved record list required');
let unreadable=0;for(const record of records){const validate=validators['validateSavedV'+record.format_version];if(!validate||!validate(JSON.parse(record.view_json)))unreadable++;}
console.log(JSON.stringify({records:records.length,unreadable}));
