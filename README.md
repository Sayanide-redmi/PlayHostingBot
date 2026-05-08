# FlaireBot — Mineflayer Bot

## Setup

1. Install Node.js (v18+)
2. Open terminal in this folder
3. Run: `npm install`
4. Edit `bot.js` CONFIG section:
   - `username` — the bot's IGN
   - `password` — the password for /setpassword and /login
5. Run: `node bot.js`

## Notes

- First join: sends `/setpassword <pass> <pass>`
- Every join after: sends `/login <pass>`
- Rejoins every 6–8 min (random by default)
- If kicked/errored 5 times → sleeps 30 min → retries
- When hit → says something in chat

## Hosting (Free, 24x7)

### Option 1: Oracle Cloud Free Tier (Best)
- Completely free forever
- Get a free VM, SSH in, install Node.js
- Run with pm2: `pm2 start bot.js --name flairebot && pm2 save`
- Never sleeps, never expires

### Option 2: Render.com
- Push code to GitHub
- Create "Background Worker" service
- Build: `npm install` | Start: `node bot.js`
- Free tier may sleep — use Starter ($7/mo) for true 24x7

### Option 3: Railway.app
- Connect GitHub repo → deploy
- Free tier = ~500 hrs/month (not full 24x7)
