import { randomUUID } from 'node:crypto';

export class Jobs {
  constructor(mesh) { this.mesh=mesh; this.items=new Map(); }
  start(nodeId,command,shell) {
    this.mesh.assertNode(nodeId);
    if (!this.mesh.config.enableCommands) throw new Error('Befehle sind deaktiviert.');
    if ([...this.items.values()].some(j=>j.nodeId===nodeId && j.status==='pending')) throw new Error('Für dieses Gerät läuft bereits ein Auftrag.');
    if (this.items.size >= 100) throw new Error('Auftragslimit erreicht. Später erneut versuchen.');
    const id=randomUUID();
    const j={jobId:id,nodeId,status:'pending',startedAt:new Date().toISOString()}; this.items.set(id,j);
    this.mesh.run(nodeId,command,shell).then(result=>Object.assign(j,result,{finishedAt:new Date().toISOString()})).catch(e=>Object.assign(j,{status:'error',error:e.message,finishedAt:new Date().toISOString(),note:'Keine automatische Wiederholung. Bei Verbindungsfehlern ist die Ausführung unbekannt.'}));
    const timer=setTimeout(()=>this.items.delete(id),3600000); timer.unref();
    return {...j};
  }
  get(id) { const j=this.items.get(id); if (!j) throw new Error('Auftrag nicht gefunden oder abgelaufen.'); return {...j}; }
}
