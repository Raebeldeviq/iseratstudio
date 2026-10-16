#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { APPLICATION_DATA_DIRECTORY } from './platform-paths.mjs';

const [command,file,...extra]=process.argv.slice(2);
if(extra.length || !['preview','import'].includes(command) || (command==='import'&&!file) || (command==='preview'&&file)) {
  throw new Error('Aufruf: node plot-monitor-helper-cli.mjs preview | import /lokaler/pfad/vorschau.json');
}
const session=String(await readFile(join(APPLICATION_DATA_DIRECTORY,'helper-session'),'utf8')).trim();
if(!/^[a-f0-9]{64}$/u.test(session)) throw new Error('Lokale Helper-Sitzung ungültig.');
const input=command==='import'?JSON.parse(await readFile(file,'utf8')):null;
const response=await fetch(`http://127.0.0.1:43182/plot-monitor/${command}`,{
  method:command==='preview'?'GET':'POST',
  headers:{'x-fpi-session':session,'Content-Type':'application/json'},
  ...(input?{body:JSON.stringify({token:input.token})}:{})
});
const result=await response.json();
if(!response.ok || result.ok!==true) throw new Error(result.message||`Helper-Fehler ${response.status}`);
process.stdout.write(`${JSON.stringify(result,null,2)}\n`);
