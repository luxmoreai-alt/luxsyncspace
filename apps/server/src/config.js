import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

function parseIceServers(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) && parsed.length ? parsed : [{ urls: "stun:stun.l.google.com:19302" }];
  } catch {
    return [{ urls: "stun:stun.l.google.com:19302" }];
  }
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: path.join(root, ".env") });

export const config = {
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET || "development-only-secret",
  clientUrl: (process.env.CLIENT_URLS || process.env.CLIENT_URL || "http://localhost:5173").split(",")[0].trim(),
  clientUrls: (process.env.CLIENT_URLS || process.env.CLIENT_URL || "http://localhost:5173").split(",").map((url) => url.trim()).filter(Boolean),
  allowVercelPreviews: process.env.ALLOW_VERCEL_PREVIEWS === "true",
  appName: process.env.APP_NAME || "LuxSyncspace",
  appUrl: process.env.APP_URL || process.env.CLIENT_URL || "http://localhost:5173",
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    fromEmail: process.env.SMTP_FROM_EMAIL
  },
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD,
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
    subject: process.env.VAPID_SUBJECT || `mailto:${process.env.SMTP_FROM_EMAIL}`
  },
  webrtcIceServers: parseIceServers(process.env.WEBRTC_ICE_SERVERS_JSON),
  root,
};

if (!config.databaseUrl) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env.");
}
