# SYNCWAVE — Created By Shiv Yogi
Live Music • Live Microphone • Real-Time Visualizer

SYNCWAVE does not upload or store the host's live audio on the server. The Worker/Durable Object only coordinates connections (signaling); audio travels browser-to-browser over WebRTC.

## Deploy
    npm install
    npx wrangler login
    npx wrangler deploy

## Test with two phones
1. Phone A: open the site, tap Upload Song, pick an MP3. A 6-digit code appears.
2. Phone B: tap CONNECT, enter the code. Tap "TAP TO START AUDIO" if shown.
3. Phone A: tap Start Microphone and speak; Phone B should hear song + voice.
4. Phone A: pause/next; Phone B shows a 19s lock. Enable Guest Controls to test requests.

## Not yet implemented
local recording, auto-reconnect, queue reordering, settings screen, 30 visualizers (3 included).
This code has not been run in a browser or deployed by me.
