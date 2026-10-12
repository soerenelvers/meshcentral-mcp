import { readFileSync } from 'node:fs';

export function validateConfig(c) {
  const publicUrl = new URL(c.publicUrl);
  if (publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash || publicUrl.username || publicUrl.password) throw new Error('publicUrl muss eine reine Origin sein.');
  if (publicUrl.protocol !== 'https:' && !(publicUrl.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(publicUrl.hostname))) throw new Error('publicUrl benötigt HTTPS.');
  const meshUrl = new URL(c.meshUrl);
  if (meshUrl.protocol !== 'https:' || meshUrl.username || meshUrl.password || meshUrl.search || meshUrl.hash) throw new Error('meshUrl benötigt HTTPS ohne Zugangsdaten oder Query.');
  if (!c.meshUsername || !c.meshPasswordFile || !c.ownerPasswordHashFile) throw new Error('Zugangskonfiguration fehlt.');
  if (!Array.isArray(c.allowedNodeIds) || c.allowedNodeIds.length === 0 || c.allowedNodeIds.some(n => typeof n !== 'string' || !/^node\/[^/]*\/[^/]+$/.test(n))) throw new Error('Mindestens eine vollständige Node-ID muss freigegeben werden.');
  if (typeof c.enableCommands !== 'boolean') throw new Error('enableCommands muss true/false sein.');
  if (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535) throw new Error('Ungültiger Port.');
  if (!Number.isInteger(c.commandTimeoutSeconds) || c.commandTimeoutSeconds < 5 || c.commandTimeoutSeconds > 600) throw new Error('commandTimeoutSeconds: 5–600.');
  return { ...c, publicUrl: publicUrl.origin };
}

export function loadConfig() {
  const config = validateConfig(JSON.parse(readFileSync(process.env.BRIDGE_CONFIG || '/app/config.json','utf8')));
  const meshPassword = readFileSync(config.meshPasswordFile,'utf8').replace(/\r?\n$/, '');
  const ownerHash = readFileSync(config.ownerPasswordHashFile,'utf8').trim();
  if (!meshPassword || !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(ownerHash)) throw new Error('Ungültige oder leere Secret-Datei.');
  return { ...config, meshPassword, ownerHash };
}
