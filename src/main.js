import { loadConfig } from './config.js';
import { createApp } from './app.js';

const config=loadConfig();
const server=createApp(config).listen(config.port,config.bind||'127.0.0.1',()=>console.log('MeshCentral MCP Bridge 0.1.0 gestartet.'));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
process.on('SIGINT',()=>server.close(()=>process.exit(0)));
