// Which companies have a live public job board, and on which system? Tries Greenhouse, Lever and
// Ashby for every candidate name and writes the live ones (with how many open roles) to
// config/boards.json. Run it monthly; companies move between systems.
import { writeFileSync } from 'node:fs';

const CANDIDATES = `gitlab remote canonical hotjar toggl wikimedia mozilla grafanalabs elastic cloudflare vercel
linear supabase posthog mercury ramp deel oyster remotecom doist automattic zapier buffer
hashicorp sourcegraph figma framer webflow notion airtable miro loom calendly intercom
pitch raycast cal resend clerk planetscale railway render netlify replit retool coinbase kraken
paystack flutterwave moniepoint kuda chipper andela turing toptal gojek wise revolut monzo n26
plaid stripe brex gusto rippling lattice hubspot shopify squarespace wix canva duolingo
spotify dropbox discord reddit pinterest twitch grammarly 1password bitwarden proton
appwrite strapi sanity contentful storyblok hygraph prismic directus payload medusa
voiceflow typeform tally jotform hackernoon dribbble behance contra fiverr upwork
safetywing kraken chainlink alchemy consensys uniswap opensea phantom solana
binance bybit okx bitpanda luno yellowcard`.split(/\s+/).filter(Boolean);

const probe = async (name) => {
  const tries = [
    ['greenhouse', `https://boards-api.greenhouse.io/v1/boards/${name}/jobs`, (j) => j.jobs?.length],
    ['lever', `https://api.lever.co/v0/postings/${name}?mode=json`, (j) => (Array.isArray(j) ? j.length : undefined)],
    ['ashby', `https://api.ashbyhq.com/posting-api/job-board/${name}`, (j) => j.jobs?.length],
  ];
  const found = [];
  for (const [kind, url, count] of tries) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!r.ok) continue;
      const n = count(await r.json());
      if (n !== undefined) found.push({ kind, name, open: n });
    } catch {}
  }
  return found;
};

const all = [];
for (let i = 0; i < CANDIDATES.length; i += 8) {
  const batch = await Promise.all(CANDIDATES.slice(i, i + 8).map(probe));
  for (const f of batch.flat()) { all.push(f); console.log(`${f.kind.padEnd(10)} ${f.name.padEnd(16)} ${f.open} open`); }
}
writeFileSync('config/boards.json', JSON.stringify(all.filter((b) => b.open > 0), null, 2));
console.log(`\n${all.filter((b) => b.open > 0).length} live boards written to config/boards.json`);
