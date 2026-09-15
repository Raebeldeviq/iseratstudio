import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateInstalledHelperPath} from '../desktop-launcher.mjs';

test('desktop starter only accepts a staged release helper',()=>{
 assert.equal(validateInstalledHelperPath('/data/helper-runtime/release-test/local-helper-launcher.mjs','/data/helper-runtime'),'/data/helper-runtime/release-test');
 for(const entry of ['/work/local-helper-launcher.mjs','/data/helper-runtime/../work/local-helper-launcher.mjs','/data/helper-runtime/release-test/local-upload-server.mjs']) assert.throws(()=>validateInstalledHelperPath(entry,'/data/helper-runtime'));
});
test('desktop starter never bootstraps the catalog or spawns a working-directory helper',async()=>{
 const source=await readFile(new URL('../desktop-launcher.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/bootstrap-bundled-catalog|local-upload-server|nohup/);
});
