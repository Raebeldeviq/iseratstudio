import assert from 'node:assert/strict';
import test from 'node:test';
import {probeHelperConnection} from '../helper-connection.mjs';

test('missing local session is diagnosed without claiming an Excel failure', async () => {
  const result=await probeHelperConnection(()=>{throw Error('must not request');},false);
  assert.equal(result.online,false); assert.match(result.message,/Sitzung fehlt/); assert.doesNotMatch(result.message,/Excel/);
});
test('expired local session is distinguished from helper downtime',async()=>{
  for(const status of [401,403]) {
    const result=await probeHelperConnection(async()=>new Response('',{status}));
    assert.equal(result.online,false); assert.match(result.message,/nicht mehr gültig/);
  }
  const result=await probeHelperConnection(async()=>{throw TypeError('network');});
  assert.match(result.message,/antwortet nicht/);
});
test('rechecking a recovered helper clears the connection error',async()=>{
  const result=await probeHelperConnection(async()=>Response.json({ok:true,service:'fabian-pascal-helper'}));
  assert.deepEqual(result,{online:true,message:''});
  assert.equal((await probeHelperConnection(async()=>Response.json({ok:true,service:'other'}))).online,false);
});
