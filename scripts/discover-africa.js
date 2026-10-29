// African tech companies and Africa-hiring remote companies: find their public Greenhouse, Lever or
// Ashby boards and add them to config/boards.json. Roles in your home_keywords (e.g. Lagos, Africa) pass the location filter.
import { readFileSync, writeFileSync } from 'node:fs';
const FILE = 'config/boards.json';
const boards = JSON.parse(readFileSync(FILE, 'utf8'));
const have = new Set(boards.map((b) => `${b.kind}:${b.name.toLowerCase()}`));
const NAMES = ['flutterwave', 'paystack', 'kuda', 'kudabank', 'piggyvest', 'cowrywise', 'opay', 'paga', 'andela', 'chippercash', 'chipper', 'interswitch', 'carbon', 'fairmoney', 'palmpay', 'risevest', 'bamboo', 'trove', 'brass', 'mono', 'okra', 'paycrest', 'sudo', 'grey', 'geegpay', 'cleva', 'lemfi', 'leatherback', 'nala', 'mpesa', 'wave', 'mfs-africa', 'onafriq', 'yoco', 'paymentology', 'tymebank', 'jumia', 'konga', 'helium-health', 'heliumhealth', 'reliancehealth', 'reliance-health', '54gene', 'moove', 'mooveafrica', 'gozem', 'yassir', 'kobo360', 'lori', 'sendbox', 'terminal-africa', 'bumpa', 'paystack-careers', 'tingo', 'eden-life', 'edenlife', 'thepeer', 'termii', 'seamlesshr', 'hellotractor', 'twiga', 'wasoko', 'sendy', 'mpost', 'turing', 'deel', 'remote', 'oyster', 'oysterhr', 'rippling', 'toptal', 'gitlab', 'automattic', 'zapier', 'doist', 'buffer', 'hotjar', 'canonical', 'kraken', 'consensys', 'chainlink', 'chainlinklabs', 'binance', 'bitget', 'okx', 'yellowcard', 'yellow-card', 'busha', 'quidax', 'bitnob', 'kotani', 'celo', 'clabs', 'figment', 'fireblocks', 'moonpay', 'ledn', 'mara', 'kandua', 'peach-payments', 'ozow', 'stitch', 'stitchmoney', 'tyme', 'lulalend', 'payfast', 'paymob', 'fawry', 'valu', 'instadeep', 'zindi', 'umba', 'pezesha', 'kopo', 'tala', 'branch', 'm-kopa', 'mkopa', 'sunking', 'greenlight-planet', 'zola', 'bboxx', 'ampersand', 'max', 'safeboda', 'chowdeck', 'heyfood', 'glovo', 'bolt', 'indrive'];
const API = {
  ashby: (s) => `https://api.ashbyhq.com/posting-api/job-board/${s}`,
  greenhouse: (s) => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`,
  lever: (s) => `https://api.lever.co/v0/postings/${s}?mode=json&limit=1`,
  workable: (s) => `https://apply.workable.com/api/v1/widget/accounts/${s}`,
};
const count = (kind, d) => (kind === 'lever' ? d.length : d.jobs?.length || 0);
const NAMES_EXTRA = ['moniepoint', 'kuda', 'fairmoney', 'flutterwave', 'paystack', 'piggyvest', 'andela', 'deel', 'chowdeck', 'carbon', 'opay', 'palmpay', 'risevest', 'cowrywise', 'lemonade-finance', 'raenest', 'grey', 'bitnob', 'busha', 'quidax', 'yellowcard', 'paga', 'sterling', 'access', 'zenith', 'gtco', 'interswitch', 'teamapt', 'remita', 'systemspecs', 'seamlesshr', 'helium', 'mydawa', 'lifebank', 'sabi', 'omnibiz', 'alerzo', 'trade-depot', 'tradedepot', 'kippa', 'brass', 'duplo', 'payhippo', 'renmoney', 'branch-international', 'credpal', 'lendsqr', 'mkobo', 'sycamore', 'thrive-agric', 'farmcrowdy', 'gidi', 'decagon', 'semicolon', 'altschool', 'utiva', 'eduplus', 'ulesson', 'gradely', 'edukoya', 'prepclass', 'siju', 'payday', 'chaka', 'bamboo', 'trove', 'afrinvest', 'cardinalstone', 'stanbic', 'wema', 'alat', 'vfd', 'fcmb', 'union', 'polaris', 'providus', 'globus', 'taj'];
NAMES.push(...NAMES_EXTRA.filter((n) => !NAMES.includes(n)));
let found = 0;
const queue = [...NAMES];
await Promise.all(Array.from({ length: 10 }, async () => {
  while (queue.length) {
    const n = queue.shift();
    for (const kind of Object.keys(API)) {
      if (have.has(`${kind}:${n}`)) break;
      try {
        const r = await fetch(API[kind](n), { signal: AbortSignal.timeout(10000) });
        if (r.ok && count(kind, await r.json()) > 0) { boards.push({ kind, name: n, from: 'africa' }); have.add(`${kind}:${n}`); found++; console.log('+', kind, n); break; }
      } catch {}
    }
  }
}));
writeFileSync(FILE, JSON.stringify(boards, null, 2) + '\n');
console.log(`done: ${found} new boards · ${boards.length} in total`);
