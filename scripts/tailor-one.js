// Make the tailored resume for one or more jobs: node scripts/tailor-one.js <job id> [...]
import { chromium } from 'playwright';
import { db } from '../src/db.js';
import { tailor } from '../src/resume/tailor.js';
const browser = await chromium.launch(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {});
for (const id of process.argv.slice(2)) console.log(id, JSON.stringify(await tailor(db.prepare('SELECT * FROM jobs WHERE id = ?').get(id), browser)));
await browser.close();
