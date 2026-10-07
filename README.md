# SYNCWAVE

Premium real-time audio platform using WebRTC, Web Audio API, WebSocket, Cloudflare Workers and Durable Objects.

## Deploy

```bash
npm install
npx wrangler login
npx wrangler deploy
```

## Important

- Audio is not uploaded to the Worker.
- Song download is direct browser-to-browser through WebRTC DataChannel.
- Client recording is local using MediaRecorder.
- Room coordination/signaling is handled by the Worker + Durable Object.
- Up to 8 clients are supported by the application design.
- A TURN server can be added later for difficult NAT/network cases.

## Files

- `public/index.html`
- `public/style.css`
- `public/app.js`
- `src/worker.js`
- `wrangler.jsonc`
- `package.json`
