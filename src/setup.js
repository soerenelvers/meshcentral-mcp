import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes, scryptSync } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { validateConfig } from './config.js';

if(!process.stdin.isTTY) throw new Error('Setup benötigt ein interaktives Terminal.');
if(existsSync('bridge.config.json') || existsSync('secrets')) throw new Error('Konfiguration oder secrets existiert bereits. Keine Dateien überschrieben.');
const rl=createInterface({input:process.stdin,output:process.stdout});
const url=(await rl.question('Öffentliche HTTPS-Origin [https://mcp-mesh.example.com]: ')).trim() || 'https://mcp-mesh.example.com';
const meshUrl=(await rl.question('MeshCentral-URL [https://mesh.example.com/]: ')).trim() || 'https://mesh.example.com/';
const username=(await rl.question('MeshCentral-Benutzer [mcp-service]: ')).trim() || 'mcp-service';
const nodeId=(await rl.question('Vollständige Node-ID (node/<domain>/<id>): ')).trim();
rl.close();
if(!/^node\/[^/]*\/[^/]+$/.test(nodeId)) throw new Error('Vollständige Node-ID erforderlich.');
async function hidden(question) {
  process.stdout.write(question); const input=process.stdin;input.setRawMode(true);input.resume();input.setEncoding('utf8');
  return new Promise((resolve,reject)=>{
    let value=''; const onData=data=>{for(const char of data){if(char==='\u0003'){cleanup();reject(new Error('Abgebrochen'));return;} if(char==='\r'||char==='\n'){cleanup();resolve(value);return;}if(char==='\u007f'||char==='\b')value=value.slice(0,-1);else if(char>=' ')value+=char;}};
    function cleanup(){input.removeListener('data',onData);input.setRawMode(false);input.pause();process.stdout.write('\n');}
    input.on('data',onData);
  });
}
const password=await hidden('MeshCentral-Passwort (verdeckte Eingabe): ');
if(!password)throw new Error('Passwort darf nicht leer sein.');
const owner=await hidden('Eigenes Brücken-Passwort (mindestens 16 Zeichen): ');
if(owner.length<16)throw new Error('Brücken-Passwort zu kurz.');
const confirmation=await hidden('Brücken-Passwort wiederholen: ');
if(owner!==confirmation)throw new Error('Passwörter stimmen nicht überein.');
const config=validateConfig({publicUrl:url,meshUrl,meshUsername:username,meshPasswordFile:'/run/secrets/mesh-password',ownerPasswordHashFile:'/run/secrets/owner-hash',allowedNodeIds:[nodeId],enableCommands:false,dataDirectory:'/app/data',port:8787,bind:'0.0.0.0',commandTimeoutSeconds:120});
const salt=randomBytes(16).toString('hex'),hash=scryptSync(owner,salt,64).toString('hex');
mkdirSync('secrets',{mode:0o700});
writeFileSync('secrets/mesh-password',password,{mode:0o600});
writeFileSync('secrets/owner-hash',salt+':'+hash,{mode:0o600});
writeFileSync('bridge.config.json',JSON.stringify(config,null,2)+'\n',{mode:0o644});
console.log('Konfiguration erstellt. Befehle zunächst deaktiviert.');
