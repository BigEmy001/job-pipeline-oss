# job-pipeline

A job hunt on autopilot, built for one person and run on your own laptop. It finds roles, scores them against your profile, tailors your resume to each one, fills the application, reads the replies, and keeps track of everything you've sent.

I built it for my own search as a product designer and design engineer, using AI-assisted development (Claude). It's opinionated toward design and design-engineering roles, but the roles, skills and location rules are all in config.

## What it does

- **Find:** reads about 600 company job boards (Greenhouse, Lever, Ashby, Workable), remote job sites (RemoteOK, Remotive, We Work Remotely, Himalayas, Jobicy, Working Nomads and more) and the Hacker News "Who is hiring" thread.
- **Filter:** keeps full-time roles that someone where you live can actually take. "Remote, US only" and "must overlap PST" are caught, not just the location field.
- **Score:** ranks each job 0–100 against your roles and skills, with the reasons.
- **Tailor:** reshapes your resume for each job. It only reorders and re-angles what's already true, and keeps it to one page.
- **Apply:** fills real Greenhouse, Lever and Ashby forms with your answer bank. It never guesses a dropdown. Anything it can't answer truthfully goes to a "Needs you" queue, and what you answer there is remembered.
- **Browser extension:** "Fill my application" fills forms in your own Chrome from the same answers and resume, and never submits for you.
- **Inbox:** reads your mailbox over IMAP and sorts replies into interview, rejection, portal and received. It also turns job-alert emails (Glassdoor, Indeed, LinkedIn) into jobs and catches bounces.
- **Track:** a dashboard with every application, pitch and DM, its status and when to follow up.
- **Leads (optional):** finds local businesses with weak websites (OpenStreetMap), checks each site on a real phone-sized browser, and drafts a short pitch. You review and send each one yourself.

## Guardrails

These are built in, and the reason it's safe to run:

- **Only true answers.** No invented experience. If there isn't a true answer, it asks you.
- **No CAPTCHA or bot-check bypassing.** Those jobs go to "Needs you".
- **No LinkedIn or Indeed scraping.** Alerts are read from your own inbox instead.
- **Pitches are drafts until you press Send.** Each one includes an opt-out line and your postal address (CAN-SPAM), honours replies like "no thanks", and never re-emails an address that bounced.
- **Submitting is a setting.** With `APPLY_SUBMIT=false` it fills forms and stops before submitting.

## Setup

Needs Node 22 or newer (it uses the built-in `node:sqlite`).

```sh
npm install
npx playwright install chromium
npm run setup        # copies the example config files to your own
```

Then fill in:

1. `.env`: your mailbox (IMAP/SMTP), `POSTAL_ADDRESS`, and whether to submit (`APPLY_SUBMIT`).
2. `config/profile.json`: name, links, the roles you want, your skills, and `home_keywords` (your country, city and region, which decide what counts as "open to you").
3. `config/answers.json`: true answers for application forms. Fill in anything marked EDIT ME.
4. `config/resume.html`: your resume, keeping the class names (`.role`, `.summary`, `.item ul`, `ul.work`, `aside section`). Save a PDF of it as `config/resume.pdf`.

```sh
npm run run          # find and score jobs
npm run serve        # dashboard at http://localhost:3000
```

The extension is in `extension/`. Load it unpacked from `chrome://extensions` with developer mode on.

## Useful scripts

- `scripts/discover-yc.js`, `scripts/discover-remote.js`, `scripts/discover-africa.js`: find more company job boards and add them to `config/boards.json`.
- `scripts/why-dropped.js`: shows which roles the location filter dropped and why.
- `scripts/dmarc.js`: reads DMARC reports, to check your email is authenticating.

## Credits

Inspired by [0xDaniiel/Job-pipeline](https://github.com/0xDaniiel/Job-pipeline). This is a separate build with no shared code.

Built by Abraham Udoinyang, product designer and design engineer: [bramy.space](https://bramy.space).

## License

MIT
