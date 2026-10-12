'use strict';

// MeshCentral's documented CommonJS plugin factory.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const PREFIX = '/meshcentral-mcp';
const escape = value => String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

module.exports.meshcentralmcp = function(parent) {
  const obj = { parent, exports: [], app: null, config: null };
  const root = parent.parent;
  const data = path.join(root.datapath, 'meshcentral-mcp');
  const settings = path.join(data, 'settings.json');
  const csrf = new Map();
  let core;
  function library() { return core || (core = require('./dist/bridge.cjs')); }
  function active() { return parent.plugins && parent.plugins.meshcentralmcp === obj; }
  function admin(user) { return user && user.siteadmin === 0xFFFFFFFF; }
  function load() {
    try {
      const cfg = JSON.parse(fs.readFileSync(settings, 'utf8'));
      library().validateConfig(cfg);
      if(typeof cfg.meshPassword !== 'string' || !cfg.meshPassword || !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(cfg.ownerHash)) throw new Error('invalid secrets');
      obj.config = cfg; obj.app = library().createApp(cfg);
    } catch(e) {
      obj.app = null;
      if(e.code !== 'ENOENT') console.error('MeshCentral MCP: Konfiguration konnte nicht geladen werden.');
    }
  }
  obj.server_startup = function() { if(!obj.app) load(); };

  obj.hook_setupHttpHandlers = function(webserver) {
    // Register before MeshCentral's catch-all routes. A restart is required after first installation.
    if(webserver._meshcentralMcpRegistered) return;
    webserver._meshcentralMcpRegistered = true;
    webserver.app.use(function meshcentralMcpRoute(req,res,next) {
      const pathname = req.url.split('?')[0];
      const discovery = '/.well-known/oauth-authorization-server' + PREFIX;
      const protectedDiscovery = '/.well-known/oauth-protected-resource' + PREFIX + '/mcp';
      if(pathname !== PREFIX && !pathname.startsWith(PREFIX+'/') && pathname !== discovery && pathname !== protectedDiscovery) return next();
      const current = parent.plugins && parent.plugins.meshcentralmcp;
      if(!current || !current.app) return res.status(503).json({error:'MCP-Plugin ist deaktiviert oder noch nicht eingerichtet.'});
      const original = req.url;
      if(pathname === discovery) req.url = '/.well-known/oauth-authorization-server';
      else if(pathname === protectedDiscovery) req.url = '/.well-known/oauth-protected-resource/mcp';
      else req.url = req.url.slice(PREFIX.length) || '/';
      current.app(req,res,err=> {req.url=original;if(err)return next(err);res.status(404).end();});
    });
    if(!obj.app) load();
  };

  function render(req,res,user,message) {
    if(!admin(user) || !active()) return res.sendStatus(403);
    for(const [id,c] of csrf) if(c.expires < Date.now()) csrf.delete(id);
    if(csrf.size >= 100) return res.status(429).send('Zu viele offene Konfigurationsseiten.');
    const token = crypto.randomBytes(32).toString('base64url');
    csrf.set(token,{userId:user._id,expires:Date.now()+600000});
    const c=obj.config || {};
    res.set('Cache-Control','no-store');
    res.set('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'self'; base-uri 'none'");
    res.type('html').send(`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>MeshCentral MCP</title><style>body{font:16px system-ui;background:#eef2f6;padding:24px;margin:auto;max-width:780px}main{background:white;padding:26px;border-radius:12px}input,textarea,button{font:inherit;padding:10px;width:100%;box-sizing:border-box;margin:6px 0 18px}label{display:block}input[type=checkbox]{width:auto}button{background:#164e72;color:white;border:0;border-radius:5px}code{overflow-wrap:anywhere}p{line-height:1.5}</style><main><h1>MeshCentral MCP Bridge 0.2.0</h1><p>${escape(message || (obj.app?'Konfiguration geladen.':'Noch nicht eingerichtet.'))}</p><p>Nach der ersten Plugininstallation MeshCentral neu starten. Der MCP-Endpunkt wird über die vorhandene HTTPS-Adresse bereitgestellt; kein zusätzlicher Container oder Port.</p><form method="post" action="pluginadmin.ashx?pin=meshcentralmcp"><input type="hidden" name="csrf" value="${token}"><label>MCP-Basisadresse (HTTPS, endet auf /meshcentral-mcp)<input name="publicUrl" type="url" value="${escape(c.publicUrl)}" placeholder="https://mesh.example.com/meshcentral-mcp" required></label><label>MeshCentral-Adresse (HTTPS)<input name="meshUrl" type="url" value="${escape(c.meshUrl)}" placeholder="https://mesh.example.com/" required></label><label>MeshCentral-Servicekonto<input name="meshUsername" value="${escape(c.meshUsername)}" autocomplete="off" required></label><label>MeshCentral-Passwort (leer lassen zum Beibehalten)<input name="meshPassword" type="password" autocomplete="new-password" maxlength="1024"></label><label>Brücken-Passwort für die ChatGPT-Verbindung (mindestens 16 Zeichen; leer lassen zum Beibehalten)<input name="ownerPassword" type="password" autocomplete="new-password" maxlength="1024"></label><label>Vollständige Geräte-IDs (eine pro Zeile, node/&lt;domain&gt;/&lt;id&gt;)<textarea name="nodes" rows="5" required>${escape((c.allowedNodeIds || []).join('\n'))}</textarea></label><label><input name="enableCommands" type="checkbox" value="yes" ${c.enableCommands?'checked':''}> Befehle freigeben (können als root/SYSTEM laufen)</label><button>Konfiguration speichern</button></form><p>MCP-URL: <code>${escape(c.publicUrl ? c.publicUrl+'/mcp' : 'Noch nicht konfiguriert')}</code></p><p>Zugangsdaten bleiben lokal im MeshCentral-Datenverzeichnis. Die Brücke unterstützt ein Besitzerkonto; normale MeshCentral-Servicekonto-Rechte und Gerätefreigaben gelten zusätzlich. Änderungen setzen OAuth-Sitzungen zurück. Nach dem Deaktivieren des Plugins liefern alle MCP-Pfade 503.</p></main></html>`);
  }
  obj.handleAdminReq = function(req,res,user) { render(req,res,user); };
  obj.handleAdminPostReq = function(req,res,user) {
    if(!admin(user) || !active()) return res.sendStatus(403);
    const b=req.body || {}, saved=csrf.get(b.csrf);
    if(!saved || saved.userId!==user._id || saved.expires<Date.now()) return res.status(403).send('Konfigurationsseite abgelaufen. Neu öffnen.');
    csrf.delete(b.csrf);
    const old=obj.config || {};
    try {
      const url=new URL(String(b.publicUrl));
      if(url.protocol!=='https:' || url.pathname!==PREFIX || url.search || url.hash || url.username || url.password) throw new Error('MCP-Basisadresse muss HTTPS und den Pfad /meshcentral-mcp verwenden.');
      if(typeof b.meshPassword!=='string' || b.meshPassword.length>1024 || typeof b.ownerPassword!=='string' || b.ownerPassword.length>1024) throw new Error('Ungültige Eingabe.');
      const pass=b.meshPassword || old.meshPassword;
      if(!pass) throw new Error('MeshCentral-Passwort fehlt.');
      let hash=old.ownerHash;
      if(b.ownerPassword) {
        if(b.ownerPassword.length<16) throw new Error('Brücken-Passwort benötigt mindestens 16 Zeichen.');
        const salt=crypto.randomBytes(16).toString('hex');hash=salt+':'+crypto.scryptSync(b.ownerPassword,salt,64).toString('hex');
      }
      if(!hash) throw new Error('Brücken-Passwort fehlt.');
      const c=library().validateConfig({publicUrl:url.toString(),meshUrl:String(b.meshUrl),meshUsername:String(b.meshUsername || '').trim(),meshPasswordFile:'native',ownerPasswordHashFile:'native',meshPassword:pass,ownerHash:hash,allowedNodeIds:String(b.nodes || '').split(/\r?\n/).map(n=>n.trim()).filter(Boolean),enableCommands:b.enableCommands==='yes',dataDirectory:path.join(data,'oauth'),port:8787,bind:'127.0.0.1',commandTimeoutSeconds:120});
      const app=library().createApp(c);
      fs.mkdirSync(data,{recursive:true,mode:0o700});
      fs.writeFileSync(settings+'.tmp',JSON.stringify(c,null,2),{mode:0o600});fs.renameSync(settings+'.tmp',settings);
      if(obj.app && obj.app.bridgeDispose) obj.app.bridgeDispose();
      obj.config=c;obj.app=app;
      render(req,res,user,'Gespeichert. ChatGPT per OAuth mit der unten gezeigten MCP-URL verbinden. Nach der Erstinstallation MeshCentral neu starten, falls die URL noch 404 liefert.');
    } catch(e) { render(req,res,user,'Nicht gespeichert: '+(e.code?'Datei konnte nicht gespeichert werden.':e.message)); }
  };
  return obj;
};
