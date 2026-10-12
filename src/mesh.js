import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';

export class MeshClient {
  constructor(config, WebSocketClass = WebSocket) { this.config = config; this.WebSocketClass = WebSocketClass; }
  request(action, payload = {}, timeoutMs = 15000) {
    const c = this.config;
    const url = new URL(c.meshUrl);
    url.protocol = 'wss:';
    url.pathname = url.pathname.replace(/\/?$/, '/') + 'control.ashx';
    const auth = Buffer.from(c.meshUsername).toString('base64') + ',' + Buffer.from(c.meshPassword).toString('base64');
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      let settled = false, sent = false;
      const ws = new this.WebSocketClass(url.toString(), { headers: { 'x-meshauth': auth }, rejectUnauthorized: true, maxPayload: 1024 * 1024, handshakeTimeout: 10000 });
      const finish = (error, result) => {
        if (settled) return;
        settled = true; clearTimeout(timer); ws.terminate();
        error ? reject(error) : resolve(result);
      };
      const timer = setTimeout(() => finish(new Error(sent && action === 'runcommands' ? 'Befehl möglicherweise ausgeführt; Rückmeldung fehlt. Nicht automatisch wiederholen.' : 'MeshCentral-Zeitüberschreitung.')), timeoutMs);
      ws.on('open', () => { ws.send(JSON.stringify({ action, ...payload, responseid: id })); sent = true; });
      ws.on('message', raw => {
        let m; try { m = JSON.parse(raw.toString()); } catch { return; }
        if (m.action === 'close') return finish(new Error('MeshCentral-Anmeldung abgelehnt oder weiterer Anmeldeschritt erforderlich.'));
        if (m.responseid !== id) return;
        if (m.action === action || (action === 'runcommands' && m.action === 'msg' && m.type === 'runcommands')) finish(null, m);
      });
      ws.on('error', () => finish(new Error(sent && action === 'runcommands' ? 'Verbindung unterbrochen; Ausführung unbekannt. Nicht automatisch wiederholen.' : 'MeshCentral-Verbindung fehlgeschlagen. URL, Zertifikat und Zugang lokal prüfen.')));
      ws.on('close', () => finish(new Error(sent && action === 'runcommands' ? 'Verbindung geschlossen; Ausführung unbekannt. Nicht automatisch wiederholen.' : 'MeshCentral hat die Verbindung geschlossen.')));
    });
  }
  assertNode(id) {
    if (!this.config.allowedNodeIds.includes(id)) throw new Error('Gerät ist in dieser Brücke nicht freigegeben.');
  }
  async devices() {
    const data = await this.request('nodes');
    if (data.result && String(data.result).toLowerCase() !== 'ok') throw new Error('MeshCentral hat die Geräteabfrage abgelehnt.');
    if (!data.nodes || typeof data.nodes !== 'object') throw new Error('Ungültige Geräteantwort.');
    return Object.entries(data.nodes).flatMap(([groupId, nodes]) => Array.isArray(nodes) ? nodes.map(n => ({
      id:n._id, name:n.name, groupId, online: Boolean((n.conn || 0) & 1), connectivity:n.conn || 0,
      os:n.osdesc || null, agentType:n.agent?.id || null, powerState:n.pwr || 0, tags:n.tags || []
    })) : []).filter(n => this.config.allowedNodeIds.includes(n.id));
  }
  async device(id) {
    this.assertNode(id);
    const d = (await this.devices()).find(n => n.id === id);
    if (!d) throw new Error('Gerät ist für den MeshCentral-Benutzer nicht sichtbar.');
    return d;
  }
  async run(id, command, shell) {
    this.assertNode(id);
    if (!this.config.enableCommands) throw new Error('Befehle sind in der Konfiguration deaktiviert.');
    const device = await this.device(id);
    if (!device.online) throw new Error('MeshCentral-Agent ist offline.');
    const m = await this.request('runcommands', {nodeids:[id], type:{auto:0,cmd:1,powershell:2,posix:3}[shell], cmds:command, runAsUser:0, reply:true}, this.config.commandTimeoutSeconds * 1000);
    // "OK" can be a dispatch acknowledgement. It never proves remote completion.
    if (m.result === 'OK') return {status:'acknowledged',output:null,executionKnown:false,note:'Nur Bestätigung erhalten. Abschluss und Exit-Code sind unbekannt.'};
    if (['Access denied','Invalid nodeid','Agent not connected','Invalid command type'].includes(m.result)) return {status:'rejected',output:null,executionKnown:false,error:m.result};
    return {status:'response_received', output:String(m.result ?? '').slice(0,65536), truncated:String(m.result ?? '').length > 65536, executionKnown:false, exitCode:null, note:'MeshCentral-Rückmeldung; kein unabhängig verifizierter Exit-Code.'};
  }
}
