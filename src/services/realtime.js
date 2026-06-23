import { EventEmitter } from 'events';

class RealtimeService extends EventEmitter {
  constructor() {
    super();
    this.clients = [];
    
    // Heartbeat every 30 seconds to keep connection alive through proxies/firewalls
    this.heartbeatInterval = setInterval(() => {
      this.broadcast({ type: 'heartbeat' });
    }, 30000);
  }

  addClient(res) {
    this.clients.push(res);
    console.log(`📡 SSE Client Connected. Total: ${this.clients.length}`);
  }

  removeClient(res) {
    this.clients = this.clients.filter(c => c !== res);
    console.log(`📡 SSE Client Disconnected. Total: ${this.clients.length}`);
  }

  broadcast(payload) {
    const message = `data: ${JSON.stringify(payload)}\n\n`;
    this.clients.forEach((client, idx) => {
      try {
        client.write(message);
      } catch (err) {
        // Safe to ignore, connection will be cleaned up in close event
      }
    });
  }

  notifyUpdate(collection, action, id) {
    console.log(`📢 Broadcasting Update: [${collection}] -> ${action} (ID: ${id})`);
    this.broadcast({ type: 'refresh', collection, action, id });
  }
}

export const realtimeService = new RealtimeService();

