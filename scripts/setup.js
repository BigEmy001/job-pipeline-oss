// First run: copy the example config files to the real ones (never overwriting yours), then say what
// to fill in. node scripts/setup.js (or npm run setup)
import { copyFileSync, existsSync } from 'node:fs';
const pairs = [['.env.example', '.env'], ['config/profile.example.json', 'config/profile.json'], ['config/answers.example.json', 'config/answers.json'], ['config/resume.example.html', 'config/resume.html']];
for (const [from, to] of pairs) {
  if (existsSync(to)) { console.log(`kept      ${to}`); continue; }
  copyFileSync(from, to);
  console.log(`created   ${to}`);
}
console.log(`
Next:
  1. .env: your mailbox (IMAP/SMTP), POSTAL_ADDRESS, BROWSER_PATH if Playwright's browser isn't installed
  2. config/profile.json: your name, links, roles, skills, home_keywords (where you live)
  3. config/answers.json: true answers for application forms (anything marked EDIT ME)
  4. config/resume.html: your resume, keeping the class names; save a PDF of it as config/resume.pdf
Then: npm run run (find jobs) and npm run serve (dashboard on http://localhost:3000)`);
