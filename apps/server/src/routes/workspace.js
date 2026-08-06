import { Router } from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import multer from "multer";
import { z } from "zod";
import { sql } from "../db/client.js";
import { requireAuth } from "../middleware/auth.js";
import { sendEmployeeInvitation, sendSupportRequest } from "../services/email.js";
import { config } from "../config.js";
import { sendPushToChannel, sendPushToOrganization, sendPushToUser } from "../services/push.js";
import { cached, invalidateCache } from "../services/cache.js";

export const workspaceRouter = Router();
workspaceRouter.use(requireAuth);

const allowedAttachmentTypes = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "application/pdf", "text/plain", "text/csv",
  "application/zip", "application/x-zip-compressed",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation"
]);
const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => callback(
    allowedAttachmentTypes.has(file.mimetype) ? null : new Error("This file type is not supported"),
    allowedAttachmentTypes.has(file.mimetype)
  )
});

workspaceRouter.post("/attachments", (req, res, next) => {
  attachmentUpload.single("file")(req, res, async (uploadError) => {
    if (uploadError) {
      const status = uploadError.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      return next(Object.assign(new Error(uploadError.code === "LIMIT_FILE_SIZE" ? "Files must be 8 MB or smaller" : uploadError.message), { status }));
    }
    try {
      if (!req.file) return res.status(400).json({ error: "Choose a file to attach" });
      const [attachment] = await sql`
        INSERT INTO message_attachments (organization_id, uploader_id, file_name, mime_type, file_size, data_base64)
        VALUES (${req.auth.organizationId}, ${req.auth.userId}, ${req.file.originalname.slice(0, 240)},
          ${req.file.mimetype}, ${req.file.size}, ${req.file.buffer.toString("base64")})
        RETURNING id, file_name, mime_type, file_size
      `;
      res.status(201).json({ ...attachment, url: `/api/attachments/${attachment.id}` });
    } catch (error) { next(error); }
  });
});

workspaceRouter.get("/attachments/:id", async (req, res, next) => {
  try {
    const [attachment] = await sql`
      SELECT a.file_name, a.mime_type, a.file_size, a.data_base64
      FROM message_attachments a
      WHERE a.id = ${req.params.id} AND a.organization_id = ${req.auth.organizationId}
        AND (
          EXISTS (
            SELECT 1 FROM channel_messages cm
            JOIN channel_members member ON member.channel_id = cm.channel_id
            WHERE cm.attachment_id = a.id AND member.user_id = ${req.auth.userId}
          )
          OR EXISTS (
            SELECT 1 FROM direct_messages dm
            WHERE dm.attachment_id = a.id
              AND (dm.sender_id = ${req.auth.userId} OR dm.recipient_id = ${req.auth.userId})
          )
        )
    `;
    if (!attachment) return res.status(404).json({ error: "Attachment not found" });
    const safeName = attachment.file_name.replace(/[\r\n"]/g, "_");
    const disposition = attachment.mime_type.startsWith("image/") ? "inline" : "attachment";
    res.set({
      "Content-Type": attachment.mime_type,
      "Content-Length": String(attachment.file_size),
      "Content-Disposition": `${disposition}; filename="${safeName}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600"
    });
    res.send(Buffer.from(attachment.data_base64, "base64"));
  } catch (error) { next(error); }
});

workspaceRouter.get("/bootstrap", async (req, res, next) => {
  try {
    const { userId, organizationId } = req.auth;
    const [people, channels, events, announcements] = await Promise.all([
      cached(`people:${organizationId}`, 30_000, () => sql`SELECT u.id, u.employee_id, u.email, u.full_name, u.title, u.department, u.role, u.phone, u.location,
             u.bio, u.joined_at, u.manager_id, u.initials, u.avatar_color, u.presence, m.full_name AS manager_name
          FROM users u LEFT JOIN users m ON m.id = u.manager_id
          WHERE u.organization_id = ${organizationId} ORDER BY u.full_name`),
      cached(`channel-memberships:${organizationId}`, 10_000, () => sql`
          SELECT c.id, c.name, c.description, c.is_private, c.created_by, m.muted, m.user_id,
             COALESCE(message_stats.message_count, 0)::int AS message_count
          FROM channels c
          JOIN channel_members m ON m.channel_id = c.id
          LEFT JOIN (
            SELECT channel_id, COUNT(*)::int AS message_count
            FROM channel_messages GROUP BY channel_id
          ) message_stats ON message_stats.channel_id = c.id
          WHERE c.organization_id = ${organizationId}
          ORDER BY c.name
        `).then((memberships) => memberships.filter((membership) => membership.user_id === userId)),
      cached(`events:${organizationId}`, 15_000, () => sql`SELECT e.*, u.full_name AS organizer_name,
             COALESCE(json_agg(json_build_object('id', a.id, 'name', a.full_name, 'initials', a.initials, 'color', a.avatar_color))
               FILTER (WHERE a.id IS NOT NULL), '[]') AS attendees
          FROM events e
          JOIN users u ON u.id = e.organizer_id
          LEFT JOIN event_attendees ea ON ea.event_id = e.id
          LEFT JOIN users a ON a.id = ea.user_id
          WHERE e.organization_id = ${organizationId}
            AND e.starts_at >= date_trunc('day', NOW()) - INTERVAL '1 day'
            AND e.starts_at < date_trunc('day', NOW()) + INTERVAL '14 days'
          GROUP BY e.id, u.full_name ORDER BY e.starts_at`)
      ,
      cached(`announcements:${organizationId}`, 30_000, () => sql`SELECT a.id, a.title, a.body, a.priority, a.published_at,
             u.full_name AS author_name, u.initials AS author_initials, u.avatar_color AS author_color
          FROM announcements a JOIN users u ON u.id = a.author_id
          WHERE a.organization_id = ${organizationId}
          ORDER BY a.published_at DESC LIMIT 20`)
    ]);
    res.json({ people, channels, events, announcements });
  } catch (error) {
    next(error);
  }
});

const groupRoles = new Set(["hr", "senior_leader", "manager", "team_lead"]);
const announcementRoles = new Set(["hr", "senior_leader"]);
const inviteRoles = new Set(["hr", "senior_leader", "manager"]);

async function currentRole(userId) {
  const [user] = await sql`SELECT role FROM users WHERE id = ${userId}`;
  return user?.role;
}

async function shareMeetingInvitation({ req, event, recipientIds, organizer, isCall = false }) {
  if (!recipientIds.length) return;
  const meetingUrl = `${config.appUrl}/?meeting=${event.id}`;
  const messageBody = `${isCall ? `${event.meeting_mode === "audio" ? "Voice" : "Video"} call` : "Meeting invitation"}: ${event.title}\n${meetingUrl}`;
  const messages = await sql`
    INSERT INTO direct_messages (organization_id, sender_id, recipient_id, body)
    SELECT ${req.auth.organizationId}, ${req.auth.userId}, recipient_id, ${messageBody}
    FROM unnest(${recipientIds}::uuid[]) AS recipient_id
    RETURNING id, recipient_id, body, sent_at
  `;
  for (const message of messages) {
    const realtimeMessage = {
      ...message,
      sender_id: req.auth.userId,
      sender_name: organizer.full_name,
      initials: organizer.initials,
      avatar_color: organizer.avatar_color
    };
    req.app.get("io")?.to(`user:${message.recipient_id}`).emit("direct:message", realtimeMessage);
    if (isCall) {
      req.app.get("io")?.to(`user:${message.recipient_id}`).emit("call:incoming", {
        meeting: event,
        caller: organizer,
        mode: event.meeting_mode
      });
    }
    sendPushToUser(message.recipient_id, {
      title: isCall
        ? `Incoming ${event.meeting_mode === "audio" ? "voice" : "video"} call from ${organizer.full_name}`
        : `Meeting invitation from ${organizer.full_name}`,
      body: event.title,
      tag: `${isCall ? "call" : "meeting-invite"}-${event.id}`,
      url: `/?meeting=${event.id}`
    }).catch(console.error);
  }
}

workspaceRouter.post("/channels", async (req, res, next) => {
  try {
    const role = await currentRole(req.auth.userId);
    if (!groupRoles.has(role)) return res.status(403).json({ error: "Your role does not have permission to create groups" });
    const input = z.object({
      name: z.string().trim().min(2).max(60).regex(/^[a-z0-9-]+$/),
      description: z.string().trim().max(300).default(""),
      memberIds: z.array(z.string().uuid()).default([]),
      isPrivate: z.boolean().default(false)
    }).parse(req.body);
    const [channel] = await sql`
      INSERT INTO channels (organization_id, name, description, is_private, created_by)
      VALUES (${req.auth.organizationId}, ${input.name}, ${input.description}, ${input.isPrivate}, ${req.auth.userId})
      RETURNING *
    `;
    const initialMemberIds = [...new Set([req.auth.userId, ...input.memberIds])];
    await sql`
      INSERT INTO channel_members (channel_id, user_id)
      SELECT ${channel.id}, member_id FROM unnest(${initialMemberIds}::uuid[]) AS member_id
      ON CONFLICT DO NOTHING
    `;
    invalidateCache("channel-memberships:", "socket-memberships:");
    res.status(201).json(channel);
  } catch (error) {
    if (error?.code === "23505") return res.status(409).json({ error: "A group with this name already exists" });
    next(error);
  }
});

workspaceRouter.get("/channels/:id/members", async (req, res, next) => {
  try {
    const [membership] = await sql`
      SELECT 1 FROM channel_members cm
      JOIN channels c ON c.id = cm.channel_id
      WHERE cm.channel_id = ${req.params.id} AND cm.user_id = ${req.auth.userId}
        AND c.organization_id = ${req.auth.organizationId}
    `;
    if (!membership) return res.status(403).json({ error: "You are not a member of this group" });
    const members = await sql`
      SELECT u.id, u.employee_id, u.full_name, u.title, u.department, u.initials, u.avatar_color, u.presence
      FROM channel_members cm JOIN users u ON u.id = cm.user_id
      WHERE cm.channel_id = ${req.params.id}
      ORDER BY u.full_name
    `;
    res.json({ members });
  } catch (error) { next(error); }
});

workspaceRouter.put("/channels/:id/members", async (req, res, next) => {
  try {
    const role = await currentRole(req.auth.userId);
    if (!groupRoles.has(role)) return res.status(403).json({ error: "Your role cannot manage group members" });
    const { memberIds } = z.object({ memberIds: z.array(z.string().uuid()).max(500) }).parse(req.body);
    const [channel] = await sql`
      SELECT id FROM channels WHERE id = ${req.params.id} AND organization_id = ${req.auth.organizationId}
    `;
    if (!channel) return res.status(404).json({ error: "Group not found" });
    const requested = [...new Set([req.auth.userId, ...memberIds])];
    const validUsers = await sql`
      SELECT id FROM users WHERE organization_id = ${req.auth.organizationId}
        AND id = ANY(${requested}::uuid[])
    `;
    if (validUsers.length !== requested.length) return res.status(400).json({ error: "One or more employees are not available" });
    const previousMembers = await sql`SELECT user_id FROM channel_members WHERE channel_id = ${req.params.id}`;
    await sql`DELETE FROM channel_members WHERE channel_id = ${req.params.id} AND user_id <> ALL(${requested}::uuid[])`;
    await sql`
      INSERT INTO channel_members (channel_id, user_id)
      SELECT ${req.params.id}, member_id FROM unnest(${requested}::uuid[]) AS member_id
      ON CONFLICT DO NOTHING
    `;
    const removedIds = previousMembers.map((member) => member.user_id).filter((id) => !requested.includes(id));
    const addedIds = requested.filter((id) => !previousMembers.some((member) => member.user_id === id));
    for (const removedId of removedIds) {
      req.app.get("io")?.in(`user:${removedId}`).socketsLeave(`channel:${req.params.id}`);
      req.app.get("io")?.to(`user:${removedId}`).emit("channel:membership-updated", { channel_id: req.params.id, action: "removed" });
    }
    for (const addedId of addedIds) {
      req.app.get("io")?.in(`user:${addedId}`).socketsJoin(`channel:${req.params.id}`);
      req.app.get("io")?.to(`user:${addedId}`).emit("channel:membership-updated", { channel_id: req.params.id, action: "added" });
    }
    invalidateCache("channel-memberships:", "socket-memberships:");
    const members = await sql`
      SELECT u.id, u.employee_id, u.full_name, u.title, u.department, u.initials, u.avatar_color, u.presence
      FROM channel_members cm JOIN users u ON u.id = cm.user_id
      WHERE cm.channel_id = ${req.params.id} ORDER BY u.full_name
    `;
    res.json({ members, message: "Group members updated" });
  } catch (error) { next(error); }
});

workspaceRouter.patch("/channels/:id/preferences", async (req, res, next) => {
  try {
    const { muted } = z.object({ muted: z.boolean() }).parse(req.body);
    const [membership] = await sql`
      UPDATE channel_members cm
      SET muted = ${muted}
      FROM channels c
      WHERE cm.channel_id = ${req.params.id} AND cm.user_id = ${req.auth.userId}
        AND c.id = cm.channel_id AND c.organization_id = ${req.auth.organizationId}
      RETURNING cm.muted
    `;
    if (!membership) return res.status(404).json({ error: "Group membership not found" });
    invalidateCache(`channel-memberships:${req.auth.organizationId}`, `socket-memberships:${req.auth.organizationId}`);
    res.json({ muted: membership.muted, message: muted ? "Group notifications muted" : "Group notifications enabled" });
  } catch (error) { next(error); }
});

workspaceRouter.delete("/channels/:id", async (req, res, next) => {
  try {
    const role = await currentRole(req.auth.userId);
    const [channel] = await sql`
      SELECT id, name, created_by FROM channels
      WHERE id = ${req.params.id} AND organization_id = ${req.auth.organizationId}
    `;
    if (!channel) return res.status(404).json({ error: "Group not found" });
    const canDelete = ["hr", "senior_leader"].includes(role) || channel.created_by === req.auth.userId;
    if (!canDelete) return res.status(403).json({ error: "Only the group creator, HR, or a senior leader can delete this group" });
    await sql`
      DELETE FROM message_attachments a
      WHERE a.id IN (SELECT attachment_id FROM channel_messages WHERE channel_id = ${channel.id} AND attachment_id IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM direct_messages dm WHERE dm.attachment_id = a.id)
        AND NOT EXISTS (SELECT 1 FROM channel_messages cm WHERE cm.attachment_id = a.id AND cm.channel_id <> ${channel.id})
    `;
    await sql`DELETE FROM channels WHERE id = ${channel.id}`;
    invalidateCache("channel-memberships:", "socket-memberships:");
    req.app.get("io")?.to(`channel:${channel.id}`).emit("channel:deleted", { channel_id: channel.id });
    req.app.get("io")?.in(`channel:${channel.id}`).socketsLeave(`channel:${channel.id}`);
    res.json({ message: `#${channel.name} was permanently deleted` });
  } catch (error) { next(error); }
});

workspaceRouter.post("/announcements", async (req, res, next) => {
  try {
    const role = await currentRole(req.auth.userId);
    if (!announcementRoles.has(role)) return res.status(403).json({ error: "Only HR and senior leaders can publish company announcements" });
    const input = z.object({
      title: z.string().trim().min(2).max(180),
      body: z.string().trim().min(2).max(5000),
      priority: z.enum(["normal", "important"]).default("normal")
    }).parse(req.body);
    const [announcement] = await sql`
      INSERT INTO announcements (organization_id, author_id, title, body, priority)
      VALUES (${req.auth.organizationId}, ${req.auth.userId}, ${input.title}, ${input.body}, ${input.priority})
      RETURNING *
    `;
    const [author] = await sql`SELECT full_name AS author_name FROM users WHERE id = ${req.auth.userId}`;
    invalidateCache(`announcements:${req.auth.organizationId}`);
    req.app.get("io")?.to(`org:${req.auth.organizationId}`).emit("announcement:new", { ...announcement, ...author });
    sendPushToOrganization(req.auth.organizationId, req.auth.userId, {
      title: `Company announcement: ${input.title}`,
      body: input.body.slice(0, 180),
      tag: `announcement-${announcement.id}`,
      url: "/"
    }).catch(console.error);
    res.status(201).json(announcement);
  } catch (error) { next(error); }
});

workspaceRouter.post("/invitations", async (req, res, next) => {
  try {
    const role = await currentRole(req.auth.userId);
    if (!inviteRoles.has(role)) return res.status(403).json({ error: "Only HR, managers, and senior leaders can invite employees" });
    const input = z.object({
      fullName: z.string().trim().min(2).max(120),
      employeeId: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,30}$/, "Employee ID must use letters, numbers, or hyphens").or(z.literal("")).default(""),
      email: z.string().email(),
      title: z.string().trim().min(2).max(120),
      role: z.enum(["employee", "team_lead", "manager", "hr"]).default("employee"),
      department: z.string().trim().min(2).max(100),
      phone: z.string().trim().max(40).default(""),
      location: z.string().trim().max(120).default(""),
      bio: z.string().trim().max(1000).default(""),
      managerId: z.union([z.string().uuid(), z.literal(""), z.null()]).default(""),
      joinedAt: z.string().date()
    }).parse(req.body);
    const [existing] = await sql`SELECT id FROM users WHERE lower(email) = lower(${input.email})`;
    if (existing) return res.status(409).json({ error: "An employee with this email already exists" });
    if (input.employeeId) {
      const [existingId] = await sql`SELECT id FROM users WHERE organization_id = ${req.auth.organizationId} AND employee_id = ${input.employeeId}`;
      if (existingId) return res.status(409).json({ error: "This employee ID is already assigned" });
    }
    if (input.managerId) {
      const [manager] = await sql`SELECT id FROM users WHERE id = ${input.managerId} AND organization_id = ${req.auth.organizationId}`;
      if (!manager) return res.status(400).json({ error: "The selected reporting manager is not available" });
    }

    const token = crypto.randomBytes(24).toString("hex");
    const temporaryPassword = `Ls!${crypto.randomBytes(9).toString("base64url")}7`;
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    let employeeId = input.employeeId;
    if (!employeeId) {
      const [{ next_id: nextId }] = await sql`
        SELECT GREATEST(
          COALESCE(MAX(NULLIF(regexp_replace(employee_id, '\\D', '', 'g'), '')::int), 1000) + 1,
          1001
        )::int AS next_id
        FROM users WHERE organization_id = ${req.auth.organizationId}
      `;
      employeeId = `LUX-${String(nextId).padStart(4, "0")}`;
    }
    const initials = input.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
    const [employee] = await sql`
      INSERT INTO users (
        organization_id, employee_id, email, password_hash, full_name, title, department, role,
        initials, avatar_color, presence, phone, location, bio, manager_id, joined_at, must_change_password
      )
      VALUES (
        ${req.auth.organizationId}, ${employeeId}, ${input.email}, ${passwordHash}, ${input.fullName},
        ${input.title}, ${input.department}, ${input.role}, ${initials}, '#3768D8', 'offline',
        ${input.phone}, ${input.location}, ${input.bio}, ${input.managerId || null}, ${input.joinedAt}, TRUE
      )
      RETURNING id, employee_id, email, full_name, title, department, role, phone, location, bio, manager_id, joined_at
    `;
    await sql`
      INSERT INTO channel_members (channel_id, user_id)
      SELECT id, ${employee.id} FROM channels
      WHERE organization_id = ${req.auth.organizationId} AND is_private = FALSE
      ON CONFLICT DO NOTHING
    `;
    await sql`
      INSERT INTO invitations (organization_id, token, email, role, department, created_by, expires_at)
      VALUES (${req.auth.organizationId}, ${token}, ${input.email}, ${input.role}, ${input.department}, ${req.auth.userId}, NOW() + INTERVAL '1 day')
    `;
    try {
      await sendEmployeeInvitation({
        to: input.email,
        fullName: input.fullName,
        temporaryPassword,
        employeeId,
        department: input.department,
        title: input.title
      });
    } catch (emailError) {
      await sql`DELETE FROM users WHERE id = ${employee.id}`;
      await sql`DELETE FROM invitations WHERE token = ${token}`;
      throw Object.assign(new Error("Employee email could not be delivered. No account was created."), { status: 502, cause: emailError });
    }
    invalidateCache(`people:${req.auth.organizationId}`, "channel-memberships:", "socket-memberships:");
    res.status(201).json({ employee, message: "Employee account created and invitation email sent" });
  } catch (error) {
    if (error?.code === "23505") return res.status(409).json({ error: "This email address or employee ID already exists" });
    next(error);
  }
});

workspaceRouter.get("/channels/:id/messages", async (req, res, next) => {
  try {
    const messages = await sql`
      SELECT cm.id, cm.body, cm.sent_at, u.id AS sender_id, u.full_name AS sender_name,
             u.initials, u.avatar_color, u.title, a.id AS attachment_id, a.file_name,
             a.mime_type, a.file_size
      FROM channel_messages cm JOIN users u ON u.id = cm.sender_id
      LEFT JOIN message_attachments a ON a.id = cm.attachment_id
      JOIN channel_members member ON member.channel_id = cm.channel_id AND member.user_id = ${req.auth.userId}
      WHERE cm.channel_id = ${req.params.id}
      ORDER BY cm.sent_at ASC LIMIT 200
    `;
    res.json({ messages });
  } catch (error) { next(error); }
});

workspaceRouter.post("/channels/:id/messages", async (req, res, next) => {
  try {
    const input = z.object({
      body: z.string().trim().max(5000).default(""),
      attachmentId: z.string().uuid().nullable().optional()
    }).refine((value) => value.body || value.attachmentId, { message: "Enter a message or attach a file" }).parse(req.body);
    const [membership] = await sql`SELECT 1 FROM channel_members WHERE channel_id = ${req.params.id} AND user_id = ${req.auth.userId}`;
    if (!membership) return res.status(403).json({ error: "You are not a member of this channel" });
    const [message] = await sql`
      INSERT INTO channel_messages (channel_id, sender_id, body, attachment_id)
      SELECT ${req.params.id}, ${req.auth.userId}, ${input.body}, a.id
      FROM (SELECT 1) seed
      LEFT JOIN message_attachments a ON a.id = ${input.attachmentId || null}
        AND a.organization_id = ${req.auth.organizationId} AND a.uploader_id = ${req.auth.userId}
      WHERE ${input.attachmentId || null}::uuid IS NULL OR a.id IS NOT NULL
      RETURNING id, body, sent_at, attachment_id
    `;
    if (!message) return res.status(400).json({ error: "The selected attachment is not available" });
    const [attachment] = message.attachment_id ? await sql`
      SELECT file_name, mime_type, file_size FROM message_attachments WHERE id = ${message.attachment_id}
    ` : [null];
    const [sender] = await sql`SELECT id AS sender_id, full_name AS sender_name, initials, avatar_color, title FROM users WHERE id = ${req.auth.userId}`;
    const result = { ...message, ...sender, ...attachment, channel_id: req.params.id };
    req.app.get("io")?.to(`channel:${req.params.id}`).emit("channel:message", result);
    const [channel] = await sql`SELECT name FROM channels WHERE id = ${req.params.id}`;
    sendPushToChannel(req.params.id, req.auth.userId, {
      title: `${sender.sender_name} in #${channel?.name || "group"}`,
      body: (input.body || `Shared ${attachment?.file_name || "a file"}`).slice(0, 180),
      tag: `channel-${req.params.id}`,
      url: "/"
    }).catch(console.error);
    res.status(201).json(result);
  } catch (error) { next(error); }
});

workspaceRouter.get("/direct/:userId", async (req, res, next) => {
  try {
    const [colleague] = await sql`SELECT id FROM users WHERE id = ${req.params.userId} AND organization_id = ${req.auth.organizationId}`;
    if (!colleague) return res.status(404).json({ error: "Employee not found" });
    const messages = await sql`
      SELECT dm.id, dm.body, dm.sent_at, u.id AS sender_id, u.full_name AS sender_name, u.initials, u.avatar_color,
             a.id AS attachment_id, a.file_name, a.mime_type, a.file_size
      FROM direct_messages dm JOIN users u ON u.id = dm.sender_id
      LEFT JOIN message_attachments a ON a.id = dm.attachment_id
      WHERE dm.organization_id = ${req.auth.organizationId}
        AND ((dm.sender_id = ${req.auth.userId} AND dm.recipient_id = ${req.params.userId})
          OR (dm.sender_id = ${req.params.userId} AND dm.recipient_id = ${req.auth.userId}))
      ORDER BY dm.sent_at ASC LIMIT 300
    `;
    res.json({ messages });
  } catch (error) { next(error); }
});

workspaceRouter.post("/direct/:userId", async (req, res, next) => {
  try {
    const input = z.object({
      body: z.string().trim().max(5000).default(""),
      attachmentId: z.string().uuid().nullable().optional()
    }).refine((value) => value.body || value.attachmentId, { message: "Enter a message or attach a file" }).parse(req.body);
    const [colleague] = await sql`SELECT id FROM users WHERE id = ${req.params.userId} AND organization_id = ${req.auth.organizationId}`;
    if (!colleague || colleague.id === req.auth.userId) return res.status(400).json({ error: "Select another employee" });
    const [message] = await sql`
      INSERT INTO direct_messages (organization_id, sender_id, recipient_id, body, attachment_id)
      SELECT ${req.auth.organizationId}, ${req.auth.userId}, ${req.params.userId}, ${input.body}, a.id
      FROM (SELECT 1) seed
      LEFT JOIN message_attachments a ON a.id = ${input.attachmentId || null}
        AND a.organization_id = ${req.auth.organizationId} AND a.uploader_id = ${req.auth.userId}
      WHERE ${input.attachmentId || null}::uuid IS NULL OR a.id IS NOT NULL
      RETURNING id, body, sent_at, attachment_id
    `;
    if (!message) return res.status(400).json({ error: "The selected attachment is not available" });
    const [attachment] = message.attachment_id ? await sql`
      SELECT file_name, mime_type, file_size FROM message_attachments WHERE id = ${message.attachment_id}
    ` : [null];
    const [sender] = await sql`SELECT id AS sender_id, full_name AS sender_name, initials, avatar_color FROM users WHERE id = ${req.auth.userId}`;
    const result = { ...message, ...sender, ...attachment };
    req.app.get("io")?.to(`user:${req.params.userId}`).emit("direct:message", { ...result, recipient_id: req.params.userId });
    sendPushToUser(req.params.userId, {
      title: sender.sender_name,
      body: (input.body || `Shared ${attachment?.file_name || "a file"}`).slice(0, 180),
      tag: `direct-${req.auth.userId}`,
      url: "/"
    }).catch(console.error);
    res.status(201).json(result);
  } catch (error) { next(error); }
});

workspaceRouter.post("/events", async (req, res, next) => {
  try {
    const input = z.object({
      title: z.string().trim().min(1).max(180),
      description: z.string().max(5000).default(""),
      location: z.string().max(255).default("LuxSyncspace meeting"),
      startsAt: z.string().datetime(),
      endsAt: z.string().datetime(),
      attendeeIds: z.array(z.string().uuid()).default([])
    }).parse(req.body);
    if (new Date(input.endsAt) <= new Date(input.startsAt)) return res.status(400).json({ error: "End time must be after start time" });
    const selectedAttendees = [...new Set(input.attendeeIds)].filter((id) => id !== req.auth.userId);
    const validAttendees = selectedAttendees.length ? await sql`
      SELECT id FROM users WHERE organization_id = ${req.auth.organizationId} AND id = ANY(${selectedAttendees}::uuid[])
    ` : [];
    if (validAttendees.length !== selectedAttendees.length) return res.status(400).json({ error: "One or more selected employees are unavailable" });
    const [event] = await sql`
      INSERT INTO events (organization_id, organizer_id, title, description, location, starts_at, ends_at)
      VALUES (${req.auth.organizationId}, ${req.auth.userId}, ${input.title}, ${input.description}, ${input.location}, ${input.startsAt}, ${input.endsAt})
      RETURNING *
    `;
    const allAttendeeIds = [...new Set([req.auth.userId, ...input.attendeeIds])];
    await sql`
      INSERT INTO event_attendees (event_id, user_id, response)
      SELECT ${event.id}, attendee_id, 'accepted' FROM unnest(${allAttendeeIds}::uuid[]) AS attendee_id
      ON CONFLICT DO NOTHING
    `;
    const attendeeIds = selectedAttendees;
    const [organizer] = await sql`SELECT full_name, initials, avatar_color FROM users WHERE id = ${req.auth.userId}`;
    await shareMeetingInvitation({ req, event, recipientIds: attendeeIds, organizer });
    invalidateCache(`events:${req.auth.organizationId}`);
    res.status(201).json(event);
  } catch (error) { next(error); }
});

workspaceRouter.post("/meetings/instant", async (req, res, next) => {
  try {
    const input = z.object({
      title: z.string().trim().min(2).max(180).default("Instant team meeting"),
      attendeeIds: z.array(z.string().uuid()).max(100).default([]),
      mode: z.enum(["audio", "video"]).default("video"),
      isCall: z.boolean().default(false)
    }).parse(req.body || {});
    const recipientIds = [...new Set(input.attendeeIds)].filter((id) => id !== req.auth.userId);
    const validRecipients = recipientIds.length ? await sql`
      SELECT id FROM users WHERE organization_id = ${req.auth.organizationId} AND id = ANY(${recipientIds}::uuid[])
    ` : [];
    if (validRecipients.length !== recipientIds.length) return res.status(400).json({ error: "One or more selected employees are unavailable" });
    const [event] = await sql`
      INSERT INTO events (organization_id, organizer_id, title, description, location, starts_at, ends_at, is_online, meeting_mode)
      VALUES (${req.auth.organizationId}, ${req.auth.userId}, ${input.title}, 'Instant LuxSyncspace meeting',
        'LuxSyncspace meeting', NOW(), NOW() + INTERVAL '1 hour', TRUE, ${input.mode})
      RETURNING *
    `;
    await sql`
      INSERT INTO event_attendees (event_id, user_id, response)
      SELECT ${event.id}, attendee_id, 'accepted'
      FROM unnest(${[req.auth.userId, ...recipientIds]}::uuid[]) AS attendee_id
      ON CONFLICT DO NOTHING
    `;
    const [organizer] = await sql`SELECT id, full_name, initials, avatar_color, title FROM users WHERE id = ${req.auth.userId}`;
    await shareMeetingInvitation({ req, event, recipientIds, organizer, isCall: input.isCall });
    invalidateCache(`events:${req.auth.organizationId}`);
    res.status(201).json(event);
  } catch (error) { next(error); }
});

workspaceRouter.get("/meetings/config", (_req, res) => {
  res.json({ iceServers: config.webrtcIceServers });
});

workspaceRouter.post("/support", async (req, res, next) => {
  try {
    const input = z.object({
      category: z.enum(["Technical issue", "Account access", "Feature request", "General help"]),
      subject: z.string().trim().min(3).max(180),
      message: z.string().trim().min(10).max(5000)
    }).parse(req.body);
    const [user] = await sql`
      SELECT id, employee_id, email, full_name, title, department
      FROM users WHERE id = ${req.auth.userId}
    `;
    await sendSupportRequest({ user, ...input });
    res.status(201).json({ message: "Your support request has been sent" });
  } catch (error) {
    if (error?.name === "ZodError") return next(error);
    next(Object.assign(new Error("We could not send your support request. Please email support directly."), { status: 502, cause: error }));
  }
});

workspaceRouter.get("/push/config", (req, res) => {
  res.json({ publicKey: config.vapid.publicKey || "" });
});

workspaceRouter.post("/push/subscribe", async (req, res, next) => {
  try {
    const input = z.object({
      endpoint: z.string().url().max(2000),
      keys: z.object({
        p256dh: z.string().min(20).max(500),
        auth: z.string().min(8).max(500)
      })
    }).parse(req.body);
    await sql`
      INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
      VALUES (${req.auth.userId}, ${input.endpoint}, ${input.keys.p256dh}, ${input.keys.auth})
      ON CONFLICT (endpoint) DO UPDATE
      SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth
    `;
    res.status(201).json({ message: "This device is subscribed" });
  } catch (error) { next(error); }
});

workspaceRouter.delete("/push/subscribe", async (req, res, next) => {
  try {
    const { endpoint } = z.object({ endpoint: z.string().url().max(2000) }).parse(req.body);
    await sql`DELETE FROM push_subscriptions WHERE user_id = ${req.auth.userId} AND endpoint = ${endpoint}`;
    res.json({ message: "This device is unsubscribed" });
  } catch (error) { next(error); }
});

workspaceRouter.get("/search", async (req, res, next) => {
  try {
    const q = `%${String(req.query.q || "").slice(0, 80)}%`;
    const [people, channels] = await Promise.all([
      sql`SELECT id, full_name, email, title, initials, avatar_color, presence FROM users
          WHERE organization_id = ${req.auth.organizationId} AND (full_name ILIKE ${q} OR email ILIKE ${q} OR title ILIKE ${q}) LIMIT 8`,
      sql`SELECT id, name, description FROM channels
          WHERE organization_id = ${req.auth.organizationId} AND (name ILIKE ${q} OR description ILIKE ${q}) LIMIT 8`
    ]);
    res.json({ people, channels });
  } catch (error) { next(error); }
});
