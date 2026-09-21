import { Router } from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { sql } from "../db/client.js";
import { config } from "../config.js";
import { sendEmployeeInvitation } from "../services/email.js";
import { invalidateCache } from "../services/cache.js";

export const provisioningRouter = Router();

function hasValidToken(request) {
  const token = request.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const expected = config.provisioning.token || "";
  if (!token || !expected || token.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

provisioningRouter.post("/employees", async (req, res, next) => {
  try {
    if (!config.provisioning.token || !config.provisioning.organizationId) {
      return res.status(503).json({ error: "HRMS provisioning is not configured" });
    }
    if (!hasValidToken(req)) return res.status(401).json({ error: "Unauthorized" });

    const input = z.object({
      email: z.string().email(),
      employeeId: z.string().trim().toUpperCase().min(3).max(30),
      fullName: z.string().trim().min(2).max(120),
      title: z.string().trim().min(2).max(120),
      department: z.string().trim().min(2).max(100),
      joinedAt: z.string().date(),
      role: z.enum(["employee", "team_lead", "manager", "hr"]).default("employee"),
    }).parse(req.body);

    const [existingByEmail] = await sql`
      SELECT id, employee_id FROM users WHERE lower(email) = lower(${input.email})
    `;
    const [existingByEmployeeId] = await sql`
      SELECT id, email FROM users
      WHERE organization_id = ${config.provisioning.organizationId} AND employee_id = ${input.employeeId}
    `;
    if (existingByEmail || existingByEmployeeId) {
      const sameAccount = existingByEmail?.id === existingByEmployeeId?.id
        || (existingByEmail && !existingByEmployeeId && existingByEmail.employee_id === input.employeeId)
        || (existingByEmployeeId && !existingByEmail && existingByEmployeeId.email.toLowerCase() === input.email.toLowerCase());
      if (sameAccount) return res.json({ provisioned: false, alreadyProvisioned: true });
      return res.status(409).json({ error: "An Outlook account already uses this email or employee ID" });
    }

    const temporaryPassword = `Ls!${crypto.randomBytes(9).toString("base64url")}7`;
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    const initials = input.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
    const [employee] = await sql`
      INSERT INTO users (
        organization_id, employee_id, email, password_hash, full_name, title, department, role,
        initials, avatar_color, presence, joined_at, must_change_password, onboarding_completed_at
      ) VALUES (
        ${config.provisioning.organizationId}, ${input.employeeId}, ${input.email}, ${passwordHash}, ${input.fullName},
        ${input.title}, ${input.department}, ${input.role}, ${initials}, '#3768D8', 'offline',
        ${input.joinedAt}, TRUE, NULL
      )
      RETURNING id, employee_id, email, full_name, title, department, role, joined_at
    `;
    await sql`
      INSERT INTO channel_members (channel_id, user_id)
      SELECT id, ${employee.id} FROM channels
      WHERE organization_id = ${config.provisioning.organizationId} AND is_private = FALSE
      ON CONFLICT DO NOTHING
    `;
    try {
      await sendEmployeeInvitation({
        to: employee.email,
        fullName: employee.full_name,
        temporaryPassword,
        employeeId: employee.employee_id,
        department: employee.department,
        title: employee.title,
      });
    } catch (emailError) {
      await sql`DELETE FROM users WHERE id = ${employee.id}`;
      throw Object.assign(new Error("The Outlook access email could not be delivered, so no account was created."), { status: 502, cause: emailError });
    }

    invalidateCache(`people:${config.provisioning.organizationId}`, "channel-memberships:", "socket-memberships:");
    res.status(201).json({ provisioned: true, email: employee.email, employeeId: employee.employee_id });
  } catch (error) {
    if (error?.code === "23505") return res.status(409).json({ error: "An Outlook account already uses this email or employee ID" });
    next(error);
  }
});
