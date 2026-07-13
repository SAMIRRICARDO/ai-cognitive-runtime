// packages/work/src/application/EvidenceCollector.ts

import { Page, Response, ConsoleMessage } from 'playwright';
import fs from 'fs';
import path from 'path';
import { NetworkRequest, EvidenceManifest, ApplicationState } from './types.js';

export class EvidenceCollector {
  private screenshots: string[] = [];
  private htmlCaptures: string[] = [];
  private networkRequests: NetworkRequest[] = [];
  private consoleMessages: string[] = [];
  private networkAttached = false;
  private consoleAttached = false;
  private startedAt = new Date().toISOString();
  // Referências guardadas para permitir remoção via detachListeners()
  private responseHandler: ((response: Response) => void) | null = null;
  private consoleHandler: ((msg: ConsoleMessage) => void) | null = null;

  constructor(
    readonly dir: string,
    private jobId: string,
    private jobTitle: string,
    private company: string,
    private platform: string,
  ) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // ── Browser listeners ──────────────────────────────────────────────────────

  attachListeners(page: Page): void {
    if (!this.networkAttached) {
      this.networkAttached = true;
      // Guardar a referência do handler é obrigatório para remover com page.off().
      // Sem isso, cada appService.process() acumula um listener na mesma page:
      // 10 jobs = 10 listeners, todos disparando em cada resposta (cross-contamination).
      this.responseHandler = (response: Response) => {
        const url = response.url();
        const isAppRelated = url.includes('linkedin.com') &&
          /apply|easyApply|apply\/submit|unifiedPro/i.test(url);
        if (!isAppRelated) return;
        const entry: NetworkRequest = {
          url,
          method: response.request().method(),
          status: response.status(),
          timestamp: new Date().toISOString(),
          isApplicationRelated: true,
        };
        this.networkRequests.push(entry);
        void response.text().then(text => { entry.responseBody = text.slice(0, 2000); }).catch(() => {});
      };
      page.on('response', this.responseHandler);
    }

    if (!this.consoleAttached) {
      this.consoleAttached = true;
      this.consoleHandler = (msg: ConsoleMessage) => {
        this.consoleMessages.push(`[${new Date().toISOString()}][${msg.type()}] ${msg.text()}`);
      };
      page.on('console', this.consoleHandler);
    }
  }

  detachListeners(page: Page): void {
    if (this.responseHandler) {
      page.off('response', this.responseHandler);
      this.responseHandler = null;
      this.networkAttached = false;
    }
    if (this.consoleHandler) {
      page.off('console', this.consoleHandler);
      this.consoleHandler = null;
      this.consoleAttached = false;
    }
  }

  // ── Screenshot ─────────────────────────────────────────────────────────────

  async captureScreenshot(page: Page, label: string): Promise<string> {
    try {
      const filename = `${label}.png`;
      const filePath = path.join(this.dir, filename);
      await page.screenshot({ path: filePath, fullPage: false });
      this.screenshots.push(filename);
      return filePath;
    } catch {
      return '';
    }
  }

  // ── HTML ───────────────────────────────────────────────────────────────────

  async captureHtml(page: Page, label: string): Promise<string> {
    try {
      const filename = `${label}.html`;
      const filePath = path.join(this.dir, filename);
      const html = await page.evaluate(() => document.documentElement.outerHTML);
      fs.writeFileSync(filePath, html, 'utf-8');
      this.htmlCaptures.push(filename);
      return filePath;
    } catch {
      return '';
    }
  }

  // ── Accessors ──────────────────────────────────────────────────────────────

  getNetworkRequests(): NetworkRequest[] { return this.networkRequests; }
  getScreenshotCount(): number { return this.screenshots.length; }

  // ── Manifest ───────────────────────────────────────────────────────────────

  async writeManifest(finalState: ApplicationState, traceFile: string, timelineFile: string): Promise<void> {
    const manifest: EvidenceManifest = {
      jobId: this.jobId,
      company: this.company,
      jobTitle: this.jobTitle,
      platform: this.platform,
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      finalState,
      screenshots: this.screenshots,
      htmlCaptures: this.htmlCaptures,
      traceFile,
      timelineFile,
      networkFile: 'network.json',
      consoleFile: 'console.log',
    };

    fs.writeFileSync(path.join(this.dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
    fs.writeFileSync(path.join(this.dir, 'network.json'), JSON.stringify(this.networkRequests, null, 2), 'utf-8');
    fs.writeFileSync(path.join(this.dir, 'console.log'), this.consoleMessages.join('\n'), 'utf-8');
  }
}
