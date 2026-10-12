import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash, scryptSync } from 'node:crypto';
import { createApp } from '../src/app.js';
import { validateConfig } from '../src/config.js';
import { MeshClient } from '../src/mesh.js';
import { Jobs } from '../src/jobs.js';
import { validRedirect, passwordMatches } from '../src/oauth.js';

const id='node//test', password='test-owner-password-strong',salt='a'.repeat(32);
const config={publicUrl:'http://127.0.0.1',meshUrl:'https://mesh.example.org/',meshUsername:'openai',meshPassword:'test',meshPasswordFile:'x',ownerPasswordHashFile:'y',ownerHash:salt+':'+scryptSync(password,salt,64).toString('hex'),allowedNodeIds:[id],enableCommands:true,port:8787,commandTimeoutSeconds:5};

test('configuration rejects unencrypted MeshCentral and empty allowlists',()=> {
  assert.equal(validateConfig(config).publicUrl,'http://127.0.0.1');
  for(const c of [{...config,meshUrl:'http://mesh.example.org'},{...config,allowedNodeIds:[]},{...config,publicUrl:'http://external.example'},{...config,enableCommands:'false'}]) assert.throws(()=>validateConfig({...c,meshPasswordFile:'x',ownerPasswordHashFile:'y'}));
});

test('OAuth password and redirect validation',()=> {
  assert.equal(passwordMatches(password,config.ownerHash),true);
  assert.equal(passwordMatches('incorrect',config.ownerHash),false);
  for(const u of ['https://chatgpt.com/callback','http://127.0.0.1/callback'])assert.equal(validRedirect(u),true);
  for(const u of ['http://attacker.example/callback','javascript:alert(1)','https://user:pass@example.org/cb','https://example.org/#cb'])assert.equal(validRedirect(u),false);
});

test('WebSocket correlation ignores other requests and handles agent reply',async()=> {
  class Socket extends EventEmitter {
    constructor(url,options){super();assert.equal(url,'wss://mesh.example.org/control.ashx');assert.equal(options.rejectUnauthorized,true);queueMicrotask(()=>this.emit('open'));}
    send(raw){const m=JSON.parse(raw);queueMicrotask(()=>{this.emit('message',Buffer.from(JSON.stringify({action:'msg',type:'runcommands',responseid:'other',result:'wrong'})));this.emit('message',Buffer.from(JSON.stringify({action:'msg',type:'runcommands',responseid:m.responseid,result:'correct'})));});}
    terminate(){}
  }
  const r=await new MeshClient(config,Socket).request('runcommands',{},1000);
  assert.equal(r.result,'correct');
});

test('allowlist filters discovery and denies commands on other devices',async()=> {
  const m=new MeshClient(config);let calls=0;
  m.request=async()=>{calls++;return {nodes:{'mesh//g':[{_id:id,name:'pluto',conn:1},{_id:'node//other',name:'private',conn:1}]}};};
  assert.deepEqual((await m.devices()).map(n=>n.id),[id]);
  await assert.rejects(m.run('node//other','hostname','auto'),/nicht freigegeben/);
  assert.equal(calls,1);
  const disabled=new MeshClient({...config,enableCommands:false});await assert.rejects(disabled.run(id,'hostname','auto'),/deaktiviert/);
});

test('no acknowledgement is reported as a completed command',async()=> {
  const m=new MeshClient(config);m.device=async()=>({online:true});m.request=async()=>({result:'OK'});
  const r=await m.run(id,'hostname','auto');assert.equal(r.status,'acknowledged');assert.equal(r.executionKnown,false);
});

test('concurrent commands on same device are rejected; failures are not retried',async()=> {
  let calls=0;
  const m={config,assertNode:()=>{},run:async()=>{calls++;throw new Error('unknown execution');}};
  const jobs=new Jobs(m),j=jobs.start(id,'hostname','auto');
  assert.throws(()=>jobs.start(id,'hostname','auto'),/bereits/);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(jobs.get(j.jobId).status,'error');assert.equal(calls,1);
});

test('OAuth PKCE and MCP HTTP end-to-end',async(t)=> {
  const mesh={config,assertNode:n=>assert.equal(n,id),devices:async()=>[{id,name:'pluto',online:true}],device:async()=>({id,online:true}),run:async()=>({status:'response_received',output:'pluto'})};
  const app=createApp(config,mesh),server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const base='http://127.0.0.1:'+server.address().port;
  async function post(path,body,token){return fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(path==='/mcp'?{Accept:'application/json, text/event-stream'}:{})},body:JSON.stringify(body),redirect:'manual'});}
  const unauthorized=await post('/mcp',{});assert.equal(unauthorized.status,401);assert.match(unauthorized.headers.get('www-authenticate'),/resource_metadata/);
  const metadata=await (await fetch(base+'/.well-known/oauth-authorization-server')).json();assert.deepEqual(metadata.code_challenge_methods_supported,['S256']);
  assert.equal((await post('/register',{redirect_uris:['http://evil.example/cb']})).status,400);
  const client=await (await post('/register',{redirect_uris:['https://chatgpt.com/callback'],client_name:'ChatGPT'})).json();
  const verifier='v'.repeat(43),challenge=createHash('sha256').update(verifier).digest('base64url');
  async function authorize(scope){
    const qs=new URLSearchParams({client_id:client.client_id,redirect_uri:'https://chatgpt.com/callback',response_type:'code',code_challenge_method:'S256',code_challenge:challenge,state:'original',scope});
    const html=await (await fetch(base+'/authorize?'+qs)).text();const flow=html.match(/name="flow" value="([^"]+)"/)[1];
    const auth=await post('/authorize',{flow,password,decision:'approve'});assert.equal(auth.status,303);
    const redirect=new URL(auth.headers.get('location'));assert.equal(redirect.searchParams.get('state'),'original');
    const body={grant_type:'authorization_code',code:redirect.searchParams.get('code'),client_id:client.client_id,redirect_uri:'https://chatgpt.com/callback',code_verifier:verifier};
    assert.equal((await post('/token',{...body,code_verifier:'w'.repeat(43)})).status,400);
    const token=await (await post('/token',body)).json();assert.ok(token.access_token);
    assert.equal((await post('/token',body)).status,400);return token;
  }
  const token=await authorize('mesh:read mesh:execute');
  const init=await post('/mcp',{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'test',version:'1'}}},token.access_token);assert.equal(init.status,200);assert.equal((await init.json()).result.serverInfo.name,'MeshCentral');
  const list=await (await post('/mcp',{jsonrpc:'2.0',id:2,method:'tools/list',params:{}},token.access_token)).json();assert.equal(list.result.tools.length,4);
  const devices=await (await post('/mcp',{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'meshcentral_devices',arguments:{}}},token.access_token)).json();assert.equal(JSON.parse(devices.result.content[0].text)[0].name,'pluto');
  const job=await (await post('/mcp',{jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'meshcentral_command_start',arguments:{nodeId:id,command:'hostname',shell:'auto'}}},token.access_token)).json();const jobId=JSON.parse(job.result.content[0].text).jobId;assert.ok(jobId);
  const output=await (await post('/mcp',{jsonrpc:'2.0',id:5,method:'tools/call',params:{name:'meshcentral_command_result',arguments:{jobId}}},token.access_token)).json();assert.equal(JSON.parse(output.result.content[0].text).output,'pluto');
  const ro=await authorize('mesh:read');
  const denied=await (await post('/mcp',{jsonrpc:'2.0',id:6,method:'tools/call',params:{name:'meshcentral_command_start',arguments:{nodeId:id,command:'hostname'}}},ro.access_token)).json();assert.equal(denied.result.isError,true);
  const refreshed=await (await post('/token',{grant_type:'refresh_token',client_id:client.client_id,refresh_token:token.refresh_token})).json();assert.ok(refreshed.access_token);assert.equal((await post('/token',{grant_type:'refresh_token',client_id:client.client_id,refresh_token:token.refresh_token})).status,400);
  await post('/revoke',{token:refreshed.access_token});assert.equal((await post('/mcp',{},refreshed.access_token)).status,401);
});
