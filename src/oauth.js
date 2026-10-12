import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const random = () => randomBytes(32).toString('base64url');
const digest = value => createHash('sha256').update(value).digest('base64url');
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function passwordMatches(password, stored) {
  if (typeof password !== 'string' || password.length > 1024) return false;
  const [salt,hash]=stored.split(':');
  const expected=Buffer.from(hash,'hex');
  const actual=scryptSync(password,salt,64);
  return actual.length===expected.length && timingSafeEqual(actual,expected);
}
export function validRedirect(value) {
  try { const u=new URL(value); return !u.username && !u.password && !u.hash && (u.protocol==='https:' || (u.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(u.hostname))); } catch { return false; }
}

export function installOAuth(app,config) {
  const issuer=config.publicUrl;
  const clients=new Map(), flows=new Map(), codes=new Map(), tokens=new Map(), refresh=new Map();
  const clientFile=config.dataDirectory ? join(config.dataDirectory,'oauth-clients.json') : null;
  if(clientFile) {
    mkdirSync(config.dataDirectory,{recursive:true,mode:0o700});
    try { for(const c of JSON.parse(readFileSync(clientFile,'utf8'))) clients.set(c.client_id,c); } catch(e) {if(e.code!=='ENOENT')throw new Error('OAuth-Client-Datei nicht lesbar.');}
  }
  const persistClients=()=> {if(clientFile){writeFileSync(clientFile+'.tmp',JSON.stringify([...clients.values()]),{mode:0o600});renameSync(clientFile+'.tmp',clientFile);}};
  const tokenTtl=3600, refreshTtl=30*86400;
  const scope='mesh:read' + (config.enableCommands ? ' mesh:execute' : '');
  const prune=()=> { for(const map of [clients,flows,codes,tokens,refresh]) for(const [k,v] of map) if(v.expiresAt<=Date.now()) map.delete(k); };
  const timer=setInterval(prune,60000); timer.unref();
  app.use((req,res,next)=> {res.set('Cache-Control','no-store'); res.set('X-Content-Type-Options','nosniff'); next();});
  const metadata={issuer, authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',registration_endpoint:issuer+'/register',revocation_endpoint:issuer+'/revoke',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none'],scopes_supported:scope.split(' ')};
  app.get('/.well-known/oauth-authorization-server',(req,res)=>res.json(metadata));
  app.get(['/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp'],(req,res)=>res.json({resource:issuer+'/mcp',authorization_servers:[issuer],scopes_supported:scope.split(' '),bearer_methods_supported:['header']}));
  app.post('/register',(req,res)=> {
    prune(); const b=req.body;
    if (clients.size>=500) return res.status(429).json({error:'temporarily_unavailable'});
    if (!Array.isArray(b.redirect_uris) || !b.redirect_uris.length || b.redirect_uris.length>10 || !b.redirect_uris.every(validRedirect) || (b.token_endpoint_auth_method && b.token_endpoint_auth_method!=='none')) return res.status(400).json({error:'invalid_client_metadata'});
    const client_id=random();
    const c={client_id,client_name: String(b.client_name || 'MCP Client').slice(0,100), redirect_uris:[...b.redirect_uris],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code'],expiresAt:Date.now()+365*86400000};
    clients.set(client_id,c);
    persistClients();
    const {expiresAt,...publicClient}=c; res.status(201).json(publicClient);
  });
  app.get('/authorize',(req,res)=> {
    prune(); const q=req.query,c=clients.get(q.client_id);
    if (!c || !c.redirect_uris.includes(q.redirect_uri) || q.response_type!=='code' || q.code_challenge_method!=='S256' || typeof q.code_challenge!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(q.code_challenge) || (q.resource && q.resource!==issuer+'/mcp')) return res.status(400).send('Ungültige OAuth-Anfrage.');
    const requested=typeof q.scope==='string' && q.scope ? q.scope.split(' ') : scope.split(' ');
    if(requested.some(s=>!scope.split(' ').includes(s))) return res.status(400).send('Ungültiger Berechtigungsbereich.');
    if(flows.size>=500) return res.status(429).send('Zu viele Anfragen.');
    const flow=random(); flows.set(flow,{clientId:q.client_id,redirectUri:q.redirect_uri,challenge:q.code_challenge,scope:requested.join(' '),state:typeof q.state==='string'?q.state.slice(0,2048):'',expiresAt:Date.now()+300000});
    res.set('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    res.type('html').send(`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>MeshCentral verbinden</title><style>body{font:16px system-ui;max-width:620px;margin:60px auto;padding:24px;background:#f3f5f7}main{background:white;padding:28px;border-radius:12px}input,button{font:inherit;padding:12px;margin-top:12px;width:100%;box-sizing:border-box}button{background:#164e72;color:white;border:0;border-radius:6px}</style><main><h1>MeshCentral verbinden</h1><p>Client: ${escape(c.client_name)}</p><p>Rückleitung: ${escape(new URL(q.redirect_uri).origin)}</p><p>Freigabe: ${escape(requested.join(', '))}. ${requested.includes('mesh:execute')?'Befehle laufen mit den Rechten des MeshCentral-Agenten, möglicherweise als root/SYSTEM.':''}</p><form method="post" action="/authorize"><input type="hidden" name="flow" value="${flow}"><label>Brücken-Passwort<input type="password" name="password" autocomplete="current-password" required maxlength="1024"></label><button name="decision" value="approve">Zugriff erlauben</button><button name="decision" value="deny">Abbrechen</button></form></main></html>`);
  });
  // A single owner, limited attempts across the instance. Passwords are never logged.
  let attempts=[];
  app.post('/authorize',(req,res)=> {
    const f=flows.get(req.body.flow);
    if(!f || f.expiresAt<=Date.now()) return res.status(400).send('Anfrage abgelaufen. Verbindung erneut starten.');
    const redirect=new URL(f.redirectUri); if(f.state) redirect.searchParams.set('state',f.state);
    if(req.body.decision==='deny') {flows.delete(req.body.flow);redirect.searchParams.set('error','access_denied');return res.redirect(303,redirect.toString());}
    attempts=attempts.filter(t=>t>Date.now()-60000);
    if(attempts.length>=5) return res.status(429).send('Bitte in einer Minute erneut versuchen.');
    attempts.push(Date.now());
    if(req.body.decision!=='approve' || !passwordMatches(req.body.password,config.ownerHash)) return res.status(403).send('Anmeldung fehlgeschlagen. Verbindung erneut starten.');
    flows.delete(req.body.flow); const code=random(); codes.set(code,{...f,expiresAt:Date.now()+60000});
    redirect.searchParams.set('code',code); res.redirect(303,redirect.toString());
  });
  function issue(grant) {
    const access=random(), refreshToken=random();
    tokens.set(digest(access),{clientId:grant.clientId,scope:grant.scope,expiresAt:Date.now()+tokenTtl*1000});
    refresh.set(digest(refreshToken),{clientId:grant.clientId,scope:grant.scope,expiresAt:Date.now()+refreshTtl*1000});
    return {access_token:access,token_type:'Bearer',expires_in:tokenTtl,refresh_token:refreshToken,scope:grant.scope};
  }
  app.post('/token',(req,res)=> {
    prune(); const b=req.body;
    if(!clients.has(b.client_id) || (b.resource && b.resource!==issuer+'/mcp')) return res.status(400).json({error:'invalid_client'});
    if(b.grant_type==='authorization_code') {
      const g=codes.get(b.code);
      if(!g || g.clientId!==b.client_id || g.redirectUri!==b.redirect_uri || typeof b.code_verifier!=='string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(b.code_verifier) || digest(b.code_verifier)!==g.challenge) return res.status(400).json({error:'invalid_grant'});
      codes.delete(b.code); return res.json(issue(g));
    }
    if(b.grant_type==='refresh_token') {
      const key=digest(String(b.refresh_token || '')),g=refresh.get(key);
      if(!g || g.clientId!==b.client_id) return res.status(400).json({error:'invalid_grant'});
      refresh.delete(key);return res.json(issue(g));
    }
    res.status(400).json({error:'unsupported_grant_type'});
  });
  app.post('/revoke',(req,res)=> {const key=digest(String(req.body.token || '')); tokens.delete(key);refresh.delete(key);res.status(200).end();});
  return (req,res,next)=> {
    const raw=req.headers.authorization;
    const token=typeof raw==='string' && raw.startsWith('Bearer ') ? tokens.get(digest(raw.slice(7))) : null;
    if(!token || token.expiresAt<=Date.now()) {res.set('WWW-Authenticate',`Bearer resource_metadata="${issuer}/.well-known/oauth-protected-resource/mcp"`);return res.status(401).json({error:'invalid_token'});}
    req.meshScopes=token.scope.split(' ');next();
  };
}
