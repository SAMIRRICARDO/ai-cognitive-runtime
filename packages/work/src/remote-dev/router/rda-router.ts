// packages/work/src/remote-dev/router/rda-router.ts
// Remote Dev Agent — Express router mounted at /api/rda

import { Router, type Request, type Response } from 'express';
import {
  initRdaSchema, registerDevice, authenticateDevice,
  listDevices, createJob, getJob, listJobs, updateJobStatus,
  getJobEvents, listExecutors, getMetrics, audit,
} from '../db/repository.js';
import { ExecutorRegistry } from '../executor/registry.js';
import { dispatchJobToAgent, getConnectedAgents } from '../ws/rda-ws-server.js';
import type { CreateJobRequest } from '../types/index.js';

// Bearer token middleware — extracts device identity from Authorization header
async function requireAuth(req: Request, res: Response, next: () => void): Promise<void> {
  const auth = req.headers.authorization ?? '';
  if (!auth.startsWith('Bearer ')) { res.status(401).json({ error: 'Missing token' }); return; }
  const token = auth.slice(7);
  const device = await authenticateDevice(token);
  if (!device) { res.status(401).json({ error: 'Invalid token' }); return; }
  (req as Request & { deviceId: string }).deviceId = device.id;
  next();
}

export function createRdaRouter(): Router {
  const router = Router();

  // ── Init (called once on server start) ───────────────────────────────────
  initRdaSchema().catch(e => console.error('[RDA] Schema init failed:', e));

  // ── Health ────────────────────────────────────────────────────────────────
  router.get('/health', (_req, res) => {
    const online = getConnectedAgents();
    res.json({ status: 'ok', agents_online: online.length, agents: online });
  });

  // ── Device registration ───────────────────────────────────────────────────
  router.post('/devices/register', async (req: Request, res: Response) => {
    try {
      await initRdaSchema();
      const { name, platform, hostname, nodeVersion } = req.body as {
        name: string; platform: string; hostname: string; nodeVersion: string;
      };
      if (!name) { res.status(400).json({ error: 'name required' }); return; }
      const result = await registerDevice(
        name, platform ?? process.platform, hostname ?? 'unknown', nodeVersion ?? process.version
      );
      await audit(result.device.id, null, 'device_registered', name, req.socket.remoteAddress);
      res.status(201).json({ device: result.device, token: result.token });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  router.get('/devices', async (_req, res) => {
    try { res.json(await listDevices()); }
    catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Executors ─────────────────────────────────────────────────────────────
  router.get('/executors', async (_req, res) => {
    try {
      const [db, runtime] = await Promise.all([
        listExecutors(),
        ExecutorRegistry.getInstance().listAvailable(),
      ]);
      // Merge: runtime availability overrides DB
      const merged = db.map(e => {
        const rt = runtime.find(r => r.id === e.id);
        return rt ? { ...e, available: rt.available, version: rt.version } : e;
      });
      res.json(merged);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Jobs ──────────────────────────────────────────────────────────────────
  router.post('/jobs', async (req: Request, res: Response) => {
    try {
      const body = req.body as CreateJobRequest;
      if (!body.deviceId || !body.prompt) {
        res.status(400).json({ error: 'deviceId and prompt required' }); return;
      }
      body.permissions = {
        editFiles: body.permissions?.editFiles ?? true,
        runTests:  body.permissions?.runTests  ?? true,
        commit:    true,   // always allowed — changed per user rule
        deploy:    body.permissions?.deploy   ?? false,
        docker:    body.permissions?.docker   ?? false,
        terminal:  body.permissions?.terminal ?? false,
      };

      const job = await createJob(body);
      await audit(body.deviceId, job.id, 'job_created', body.mode);

      // Dispatch to connected agent if online
      const dispatched = dispatchJobToAgent(body.deviceId, job);
      if (!dispatched) {
        // Job stays queued — agent will receive it on next connect
        console.log(`[RDA] Job ${job.id} queued — agent ${body.deviceId} not connected`);
      }

      res.status(201).json({ job, dispatched });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  router.get('/jobs', async (req: Request, res: Response) => {
    try {
      const { deviceId, limit } = req.query as { deviceId?: string; limit?: string };
      const jobs = await listJobs(deviceId, limit ? parseInt(limit, 10) : 50);
      res.json(jobs);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  router.get('/jobs/:jobId', async (req: Request, res: Response) => {
    try {
      const jobId = String(req.params['jobId'] ?? '');
      const job = await getJob(jobId);
      if (!job) { res.status(404).json({ error: 'Not found' }); return; }
      res.json(job);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  router.patch('/jobs/:jobId/status', async (req: Request, res: Response) => {
    try {
      const { status, errorMsg } = req.body as { status: string; errorMsg?: string };
      await updateJobStatus(String(req.params['jobId'] ?? ''), status as never, errorMsg);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  router.delete('/jobs/:jobId', async (req: Request, res: Response) => {
    try {
      await updateJobStatus(String(req.params['jobId'] ?? ''), 'cancelled');
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Job Events (SSE fallback for polling dashboards) ──────────────────────
  router.get('/jobs/:jobId/events', async (req: Request, res: Response) => {
    try {
      const events = await getJobEvents(String(req.params['jobId'] ?? ''), req.query['after'] as string);
      res.json(events);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── SSE stream for job logs (alternative to WS) ───────────────────────────
  router.get('/jobs/:jobId/stream', async (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const jobId = String(req.params['jobId'] ?? '');
    let lastEventId = '';
    let closed = false;

    res.on('close', () => { closed = true; });

    const poll = async (): Promise<void> => {
      if (closed) return;
      const events = await getJobEvents(jobId, lastEventId || undefined);
      for (const ev of events) {
        lastEventId = ev.id;
        res.write(`id: ${ev.id}\ndata: ${JSON.stringify(ev)}\n\n`);
      }
      if (!closed) setTimeout(() => { poll().catch(() => {}); }, 500);
    };

    poll().catch(() => {});
  });

  // ── Metrics ───────────────────────────────────────────────────────────────
  router.get('/jobs/:jobId/metrics', async (req: Request, res: Response) => {
    try {
      const metrics = await getMetrics(String(req.params['jobId'] ?? ''));
      res.json(metrics);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  return router;
}
