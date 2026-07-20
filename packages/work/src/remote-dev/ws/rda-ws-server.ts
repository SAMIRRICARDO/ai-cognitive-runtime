// packages/work/src/remote-dev/ws/rda-ws-server.ts
// RDA WebSocket Server — real-time comms between Desktop Agent and dashboard

import { type IncomingMessage, type Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import {
  authenticateDevice, updateDeviceStatus, updateJobStatus,
  addJobEvent, listJobs, audit,
} from '../db/repository.js';
import { ExecutorRegistry } from '../executor/registry.js';
import type { WsMessage, WsMessageType, DeviceStatus } from '../types/index.js';

interface ConnectedAgent {
  ws:       WebSocket;
  deviceId: string;
  name:     string;
}

// Browser dashboard connections (no auth — same-origin / tunnel)
interface DashboardConn {
  ws: WebSocket;
}

const agents    = new Map<string, ConnectedAgent>();   // deviceId → conn
const dashboards = new Set<DashboardConn>();

let _wss: WebSocketServer | null = null;

function send<T>(ws: WebSocket, type: WsMessageType, payload: T): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type, payload, ts: Date.now() }));
}

function broadcastToDashboards<T>(type: WsMessageType, payload: T): void {
  const msg = JSON.stringify({ type, payload, ts: Date.now() });
  for (const d of dashboards) {
    if (d.ws.readyState === WebSocket.OPEN) d.ws.send(msg);
  }
}

export function broadcastJobEvent(jobId: string, eventType: string, payload: unknown): void {
  broadcastToDashboards('job_event', { jobId, eventType, payload });
}

export function initRdaWsServer(httpServer: Server): WebSocketServer {
  if (_wss) return _wss;

  _wss = new WebSocketServer({ server: httpServer, path: '/rda' });

  _wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
    const ip   = req.socket.remoteAddress ?? 'unknown';
    const isAgent = req.headers['x-rda-agent'] === 'true';
    let agentDeviceId: string | null = null;
    let dashConn: DashboardConn | null = null;

    ws.on('message', async (raw) => {
      let msg: WsMessage;
      try { msg = JSON.parse(raw.toString()) as WsMessage; } catch { return; }

      // ── Agent auth ──────────────────────────────────────────────────────────
      if (msg.type === 'auth') {
        const { token } = msg.payload as { token: string };
        const device = await authenticateDevice(token);
        if (!device) {
          send(ws, 'auth_error', { reason: 'Invalid token' });
          ws.close();
          return;
        }

        agentDeviceId = device.id;
        agents.set(device.id, { ws, deviceId: device.id, name: device.name });
        await updateDeviceStatus(device.id, 'online');
        await audit(device.id, null, 'agent_connect', undefined, ip);

        send(ws, 'auth_ok', { deviceId: device.id, name: device.name });
        broadcastToDashboards('device_status', { deviceId: device.id, status: 'online', name: device.name });

        // Send any queued jobs
        const queued = (await listJobs(device.id, 20)).filter(j => j.status === 'queued');
        for (const job of queued) {
          send(ws, 'job_assigned', { job });
        }
        return;
      }

      // ── Heartbeat ───────────────────────────────────────────────────────────
      if (msg.type === 'heartbeat') {
        send(ws, 'heartbeat_ack', { ts: Date.now() });
        if (agentDeviceId) await updateDeviceStatus(agentDeviceId, 'online');
        return;
      }

      // ── Workspace info ─────────────────────────────────────────────────────
      if (msg.type === 'workspace_info' && agentDeviceId) {
        await updateDeviceStatus(agentDeviceId, 'online', JSON.stringify(msg.payload));
        broadcastToDashboards('workspace_info', { deviceId: agentDeviceId, info: msg.payload });
        return;
      }

      // ── Job events from agent ──────────────────────────────────────────────
      if (msg.type === 'job_event' && agentDeviceId) {
        const { jobId, eventType, payload } = msg.payload as { jobId: string; eventType: string; payload: unknown };
        await addJobEvent(jobId, eventType as never, payload);
        broadcastToDashboards('job_event', { jobId, eventType, payload });
        return;
      }

      // ── Approval response from dashboard ───────────────────────────────────
      if (msg.type === 'approval_response') {
        const { jobId, approved, deviceId } = msg.payload as { jobId: string; approved: boolean; deviceId: string };
        const agent = agents.get(deviceId);
        if (agent) send(agent.ws, 'approval_response', { jobId, approved });
        return;
      }

      // ── Dashboard (no auth needed — tunneled) ─────────────────────────────
      if (!isAgent && !agentDeviceId) {
        if (msg.type === 'job_cancel') {
          const { jobId, deviceId } = msg.payload as { jobId: string; deviceId: string };
          const agent = agents.get(deviceId);
          if (agent) send(agent.ws, 'job_cancel', { jobId });
          await updateJobStatus(jobId, 'cancelled');
        }
        return;
      }
    });

    ws.on('close', async () => {
      if (agentDeviceId) {
        agents.delete(agentDeviceId);
        await updateDeviceStatus(agentDeviceId, 'offline' as DeviceStatus);
        await audit(agentDeviceId, null, 'agent_disconnect', undefined, ip);
        broadcastToDashboards('device_status', { deviceId: agentDeviceId, status: 'offline' });
      } else if (dashConn) {
        dashboards.delete(dashConn);
      }
    });

    // Register as dashboard if not agent
    if (!isAgent) {
      dashConn = { ws };
      dashboards.add(dashConn);
      // Send current agent statuses
      for (const [, agent] of agents) {
        send(ws, 'device_status', { deviceId: agent.deviceId, status: 'online', name: agent.name });
      }
    }
  });

  return _wss;
}

export function dispatchJobToAgent(deviceId: string, job: unknown): boolean {
  const agent = agents.get(deviceId);
  if (!agent) return false;
  send(agent.ws, 'job_assigned', { job });
  return true;
}

export function getConnectedAgents(): string[] {
  return Array.from(agents.keys());
}
