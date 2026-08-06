# LuxSyncspace production deployment

LuxSyncspace has two deployment parts:

- The React/Vite PWA is deployed to Vercel.
- The Express, Socket.IO, notification, and WebRTC-signalling server is deployed as a second Vercel project.

Vercel WebSockets are currently in Public Beta. Connections run on Fluid compute and can close when a Function reaches its duration limit, so the client reconnects when needed. Redis is required so rooms and events work across multiple Function instances.

## 1. Deploy the realtime backend to Vercel

Import the same Git repository as a new Vercel project:

```text
Root directory: apps/server
Framework preset: Express
Install command: npm install
Build command: npm run db:migrate
```

Copy the server variables from the root `.env.example` into the backend project's environment settings. At minimum, configure:

```text
DATABASE_URL=postgresql://...
JWT_SECRET=use-a-long-random-production-secret
CLIENT_URLS=https://your-project.vercel.app
APP_URL=https://your-project.vercel.app
REDIS_URL=rediss://...
```

Create a managed Redis database, such as Upstash Redis from the Vercel Marketplace, and use its `rediss://` connection URL. Also configure the existing ZeptoMail, VAPID, and WebRTC variables. Never commit the `.env` file.

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

Deploy and verify:

```text
https://your-backend-project.vercel.app/api/health
```

## 2. Deploy the PWA to Vercel

Import the Git repository in Vercel. Either of these configurations is supported:

### Recommended: client directory as the Vercel root

```text
Root directory: apps/client
Install command: npm install
Build command: npm run build
Output directory: dist
```

The `apps/client/vercel.json` file supplies these settings and SPA routing.

### Alternative: repository root as the Vercel root

```text
Root directory: .
Install command: npm install
Build command: npm run build -w apps/client
Output directory: apps/client/dist
```

The root `vercel.json` supplies these workspace settings.

Add these Vercel environment variables for Production, Preview, and Development:

```text
VITE_API_URL=https://your-backend-project.vercel.app/api
VITE_SOCKET_URL=https://your-backend-project.vercel.app
```

With `apps/client` selected as the root, Vercel will run:

```text
npm install
npm run build
```

The generated frontend is served from `dist`.

## 3. Connect both deployments

After Vercel provides the final frontend domain, update the backend project's environment:

```text
CLIENT_URLS=https://your-project.vercel.app
APP_URL=https://your-project.vercel.app
```

For multiple approved frontend domains, separate them with commas:

```text
CLIENT_URLS=https://your-project.vercel.app,https://syncspace.luxmorai.com
```

Redeploy both projects after changing these values. If Vercel preview deployments must connect to the backend, set `ALLOW_VERCEL_PREVIEWS=true`; leave it disabled when previews do not need production data.

## 4. Verify production

1. Sign in from the Vercel URL.
2. Allow browser notification, microphone, and camera permissions.
3. Install the PWA on one phone and open it on a second phone or laptop.
4. Send a message and confirm the notification arrives.
5. Start an audio call and a video call in both directions.
6. Create a scheduled meeting and confirm the 30-minute reminder.
7. Send an employee invitation and confirm the branded email arrives.

For 200–300 concurrent users, monitor Fluid compute usage, Function duration, Redis connections, and database connection count. The backend includes the Socket.IO Redis adapter when `REDIS_URL` is configured.

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
