import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'http://localhost:3001/work';
const OUT  = path.resolve(__dirname, '../docs/screenshots');

const shots = [
  { name: 'overview',      navId: 'nav-kpis'          },
  { name: 'candidaturas',  navId: 'nav-table'          },
  { name: 'truth-engine',  navId: 'nav-truth'          },
  { name: 'analytics',     navId: 'nav-analytics'      },
  { name: 'questionnaire', navId: 'nav-questionnaire'  },
  { name: 'marketplace',   navId: 'nav-marketplace'    },
  { name: 'aprendizado',   navId: 'nav-learning'       },
];

async function run() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 860 },
    deviceScaleFactor: 1.5,
  });
  const page = await ctx.newPage();

  console.log('Loading dashboard…');
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30_000 });
  // wait for API calls to populate data
  await page.waitForTimeout(4000);

  for (const shot of shots) {
    try {
      // click the nav item to switch section
      await page.click(`#${shot.navId}`);
      await page.waitForTimeout(1200);

      const outPath = path.join(OUT, `${shot.name}.png`);
      await page.screenshot({ path: outPath });
      console.log(`✓ ${shot.name}.png`);
    } catch (e: unknown) {
      console.error(`✗ ${shot.name}: ${(e as Error).message}`);
    }
  }

  await browser.close();
  console.log('\nDone →', OUT);
}

run().catch(e => { console.error(e); process.exit(1); });
