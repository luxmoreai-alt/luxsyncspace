# LuxSyncspace production deployment

LuxSyncspace has two deployment parts:

- The React/Vite PWA is deployed to Vercel.
- The Express, Socket.IO, notification, and WebRTC-signalling server is deployed to a persistent Node.js host such as Render, Railway, or Fly.io.

The realtime server must remain online for chat, presence, incoming calls, and meeting signalling. It should not be moved into a short-lived serverless function.

## 1. Prepare the realtime server

Create a Node.js web service from this repository on your chosen backend host.

- Build command: `npm install && npm run db:migrate`
- Start command: `npm run start`
- Health check path: `/api/health`

Copy the server variables from the root `.env.example` into the host's environment settings. At minimum, configure:

```text
DATABASE_URL=postgresql://...
JWT_SECRET=use-a-long-random-production-secret
CLIENT_URLS=https://your-project.vercel.app
APP_URL=https://your-project.vercel.app
PORT=4000
```

Also configure the existing ZeptoMail, VAPID, and WebRTC variables. Never commit the `.env` file.

For dependable calls outside the office network, configure a production TURN service in `WEBRTC_ICE_SERVERS_JSON`. STUN alone cannot connect users behind every firewall or mobile carrier.

Example shape:

```json
[
  { "urls": ["stun:stun.l.google.com:19302"] },
  {
    "urls": ["turn:turn.example.com:3478"],
    "username": "turn-user",
    "credential": "turn-password"
  }
]
```

Wait for the server to deploy, then verify:

```text
https://your-api-host.example/api/health
```

## 2. Deploy the PWA to Vercel

Import the Git repository in Vercel and keep the project root as the repository root (`.`). The included `vercel.json` supplies the Vite workspace build and SPA routing settings.

Add these Vercel environment variables for Production, Preview, and Development:

```text
VITE_API_URL=https://your-api-host.example/api
VITE_SOCKET_URL=https://your-api-host.example
```

Deploy the project. Vercel will run:

```text
npm install
npm run build -w apps/client
```

The generated frontend is served from `apps/client/dist`.

## 3. Connect both deployments

After Vercel provides the final domain, update the backend environment:

```text
CLIENT_URLS=https://your-project.vercel.app
APP_URL=https://your-project.vercel.app
```

For multiple approved frontend domains, separate them with commas:

```text
CLIENT_URLS=https://your-project.vercel.app,https://syncspace.luxmorai.com
```

Redeploy the backend after changing these values. If Vercel preview deployments must connect to the backend, set `ALLOW_VERCEL_PREVIEWS=true`; leave it disabled when previews do not need production data.

## 4. Verify production

1. Sign in from the Vercel URL.
2. Allow browser notification, microphone, and camera permissions.
3. Install the PWA on one phone and open it on a second phone or laptop.
4. Send a message and confirm the notification arrives.
5. Start an audio call and a video call in both directions.
6. Create a scheduled meeting and confirm the 30-minute reminder.
7. Send an employee invitation and confirm the branded email arrives.

For 200–300 concurrent users on one realtime server, monitor memory, CPU, open connections, and database connection count. Before horizontally scaling the Socket.IO server, add shared realtime coordination such as the Socket.IO Redis adapter and use a managed Redis service.

## Vercel CLI alternative

From the repository root:

```powershell
npm install
npx vercel
npx vercel env add VITE_API_URL
npx vercel env add VITE_SOCKET_URL
npx vercel --prod
```

Enter the public backend URLs when prompted for the two environment variables.
