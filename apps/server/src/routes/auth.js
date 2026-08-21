import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { sql } from "../db/client.js";
import { config } from "../config.js";
import { requireAuth } from "../middleware/auth.js";

export const authRouter = Router();

authRouter.post("/login", async (req, res, next) => {
  try {
    const input = z.object({ email: z.string().email(), password: z.string().min(8) }).parse(req.body);
    const [user] = await sql`
      SELECT u.*, o.name AS organization_name, m.full_name AS manager_name
      FROM users u JOIN organizations o ON o.id = u.organization_id
      LEFT JOIN users m ON m.id = u.manager_id
      WHERE lower(u.email) = lower(${input.email})
    `;
    if (!user || !(await bcrypt.compare(input.password, user.password_hash))) {
      return res.status(401).json({ error: "Email or password is incorrect" });
    }
    if ((user.employment_status || "active") !== "active") {
      return res.status(403).json({ error: user.employment_status === "offboarded" ? "Your account has been offboarded. Contact your administrator." : "This employee account is no longer active." });
    }
    await sql`UPDATE users SET presence = 'online', availability_status = 'online' WHERE id = ${user.id}`;
    user.presence = "online";
    user.availability_status = "online";
    const token = jwt.sign(
      { userId: user.id, organizationId: user.organization_id, email: user.email },
      config.jwtSecret,
      { expiresIn: "12h" }
    );
    delete user.password_hash;
    res.json({ token, user });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/forgot-password", async (req, res, next) => {
  try {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const [user] = await sql`
      SELECT id, organization_id FROM users
      WHERE lower(email) = lower(${email}) AND employment_status = 'active'
    `;
    if (user) {
      await sql`
        INSERT INTO password_reset_requests (organization_id, user_id)
        VALUES (${user.organization_id}, ${user.id})
        ON CONFLICT (user_id) WHERE status = 'pending'
        DO UPDATE SET requested_at = NOW()
      `;
    }
    res.json({ message: "Your password reset request has been sent to the administrator. You will receive an email once it is completed." });
  } catch (error) { next(error); }
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const [user] = await sql`
    SELECT u.id, u.employee_id, u.email, u.full_name, u.title, u.department, u.role, u.phone, u.location,
           u.bio, u.joined_at, u.manager_id, u.must_change_password, u.initials, u.avatar_color, u.presence, u.availability_status, u.employment_status,
           u.display_name, u.hide_full_name, u.hide_email, u.onboarding_completed_at,
           o.name AS organization_name, m.full_name AS manager_name
    FROM users u JOIN organizations o ON o.id = u.organization_id
    LEFT JOIN users m ON m.id = u.manager_id
    WHERE u.id = ${req.auth.userId}
  `;
  res.json({ user });
});

authRouter.post("/change-password", requireAuth, async (req, res, next) => {
  try {
    const input = z.object({
      currentPassword: z.string().min(8).max(128),
      newPassword: z.string().min(12).max(128)
        .regex(/[A-Z]/, "New password must include an uppercase letter")
        .regex(/[a-z]/, "New password must include a lowercase letter")
        .regex(/[0-9]/, "New password must include a number")
        .regex(/[^A-Za-z0-9]/, "New password must include a special character")
    }).parse(req.body);
    const [user] = await sql`SELECT password_hash FROM users WHERE id = ${req.auth.userId}`;
    if (!user || !(await bcrypt.compare(input.currentPassword, user.password_hash))) {
      return res.status(400).json({ error: "Temporary password is incorrect" });
    }
    const passwordHash = await bcrypt.hash(input.newPassword, 12);
    await sql`UPDATE users SET password_hash = ${passwordHash}, must_change_password = FALSE WHERE id = ${req.auth.userId}`;
    res.json({ ok: true });
  } catch (error) { next(error); }
});
