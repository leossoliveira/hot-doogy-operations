// Read-only export. Never exports transcript content, tokens, participant lists or agent paths.
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {writeFile,rename,mkdir} from 'node:fs/promises';import {dirname} from 'node:path';
import {sanitizeWhatsappDirectory} from '../server/doogy-ai.mjs';
const destination=process.argv[2];if(!destination)throw Error('Directory destination required');
const {stdout}=await promisify(execFile)(process.env.OPENCLAW_BIN||'/usr/bin/openclaw',['gateway','call','sessions.list','--json','--params','{"limit":10000}'],{timeout:45000,maxBuffer:10*1024*1024});
const value=sanitizeWhatsappDirectory(JSON.parse(stdout));await mkdir(dirname(destination),{recursive:true});await writeFile(destination+'.tmp',JSON.stringify(value),{mode:0o640});await rename(destination+'.tmp',destination);
console.log(`Exported ${value.rows.length} WhatsApp conversations.`);
