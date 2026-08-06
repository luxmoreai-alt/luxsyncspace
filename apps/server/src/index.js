import http from "node:http";
import crypto from "node:crypto";
import path from "node:path";
import express from "express";
import cors from "cors";
import compression from "compression";
import helmet from "helmet";
import morgan from "morgan";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { authRouter } from "./routes/auth.js";
import { workspaceRouter } from "./routes/workspace.js";
import { startEventReminderScheduler } from "./services/eventReminders.js";
import { sql } from "./db/client.js";
import { cached } from "./services/cache.js";

const app = express();
const server = http.createServer(app);
function allowOrigin(origin, callback) {
  const allowed = !origin
    || config.clientUrls.includes(origin)
    || (config.allowVercelPreviews && /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin));
  callback(allowed ? null : new Error("Origin is not allowed"), allowed);
}

const io = new Server(server, { cors: { origin: allowOrigin, credentials: true } });
app.set("io", io);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: allowOrigin, credentials: true }));
app.use(compression());
app.use(express.json({ limit: "1mb" }));
if (process.env.NODE_ENV !== "production") app.use(morgan("dev"));

app.get("/api/health", (_req, res) => res.json({ status: "ok", service: "luxsyncspace-api" }));
app.use("/api/auth", authRouter);
app.use("/api", workspaceRouter);

io.use((socket, next) => {
  try {
    socket.auth = jwt.verify(socket.handshake.auth.token, config.jwtSecret);
    next();
  } catch {
    next(new Error("unauthorized"));
  }
});
io.on("connection", (socket) => {
  socket.join(`user:${socket.auth.userId}`);
  socket.join(`org:${socket.auth.organizationId}`);
  cached(`socket-memberships:${socket.auth.organizationId}`, 10_000, () =>
    sql`SELECT user_id, channel_id FROM channel_members cm
        JOIN channels c ON c.id = cm.channel_id
        WHERE c.organization_id = ${socket.auth.organizationId}`
  )
    .then((memberships) => socket.join(
      memberships
        .filter((membership) => membership.user_id === socket.auth.userId)
        .map((membership) => `channel:${membership.channel_id}`)
    ))
    .catch((error) => console.error("Could not join channel rooms", error));
  socket.on("channel:join", async (channelId) => {
    const [membership] = await sql`
      SELECT 1 FROM channel_members cm
      JOIN channels c ON c.id = cm.channel_id
      WHERE cm.channel_id = ${channelId} AND cm.user_id = ${socket.auth.userId}
        AND c.organization_id = ${socket.auth.organizationId}
    `;
    if (membership) socket.join(`channel:${channelId}`);
  });
  socket.on("channel:leave", (channelId) => socket.leave(`channel:${channelId}`));

  socket.on("meeting:join", async ({ roomId }, acknowledge = () => {}) => {
    try {
      const [meeting] = await sql`
        SELECT id, title, starts_at, ends_at
        FROM events WHERE id = ${roomId} AND organization_id = ${socket.auth.organizationId} AND is_online = TRUE
      `;
      if (!meeting) return acknowledge({ ok: false, error: "Meeting not found or access denied" });
      const [profile] = await sql`
        SELECT id, full_name, title, initials, avatar_color FROM users WHERE id = ${socket.auth.userId}
      `;
      if (socket.meetingRoom) {
        socket.leave(socket.meetingRoom);
        socket.to(socket.meetingRoom).emit("meeting:user-left", { socketId: socket.id });
      }
      const room = `meeting:${meeting.id}`;
      const existingSockets = await io.in(room).fetchSockets();
      socket.meetingRoom = room;
      socket.meetingProfile = profile;
      socket.join(room);
      acknowledge({
        ok: true,
        meeting,
        participants: existingSockets.map((participant) => ({
          socketId: participant.id,
          user: participant.meetingProfile
        })).filter((participant) => participant.user)
      });
      socket.to(room).emit("meeting:user-joined", { socketId: socket.id, user: profile });
    } catch (error) {
      console.error("Meeting join failed", error);
      acknowledge({ ok: false, error: "Could not join this meeting" });
    }
  });

  socket.on("meeting:signal", ({ target, signal }) => {
    const targetSocket = io.sockets.sockets.get(target);
    if (!socket.meetingRoom || !targetSocket?.rooms.has(socket.meetingRoom)) return;
    io.to(target).emit("meeting:signal", { from: socket.id, signal, user: socket.meetingProfile });
  });

  socket.on("meeting:chat", ({ body }) => {
    const message = String(body || "").trim().slice(0, 2000);
    if (!socket.meetingRoom || !message) return;
    io.to(socket.meetingRoom).emit("meeting:chat", {
      id: crypto.randomUUID(),
      body: message,
      sender_id: socket.auth.userId,
      sender_name: socket.meetingProfile?.full_name || "Participant",
      sent_at: new Date().toISOString()
    });
  });

  socket.on("meeting:hand", ({ raised }) => {
    if (socket.meetingRoom) socket.to(socket.meetingRoom).emit("meeting:hand", { socketId: socket.id, raised: Boolean(raised) });
  });

  socket.on("meeting:leave", () => {
    if (!socket.meetingRoom) return;
    socket.to(socket.meetingRoom).emit("meeting:user-left", { socketId: socket.id });
    socket.leave(socket.meetingRoom);
    socket.meetingRoom = null;
  });

  socket.on("disconnecting", () => {
    if (socket.meetingRoom) socket.to(socket.meetingRoom).emit("meeting:user-left", { socketId: socket.id });
  });
});
startEventReminderScheduler(io);

const clientDist = path.join(config.root, "apps/client/dist");
app.use(express.static(clientDist));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(clientDist, "index.html"), (error) => error && next());
});

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error?.name === "ZodError") return res.status(400).json({ error: error.issues[0]?.message || "Invalid request" });
  res.status(error.status || 500).json({ error: error.status ? error.message : "Something went wrong. Please try again." });
});

server.listen(config.port, () => console.log(`LuxSyncspace API listening on http://localhost:${config.port}`));
