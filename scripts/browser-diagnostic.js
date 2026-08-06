import "dotenv/config";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import bcrypt from "bcryptjs";
import { sql } from "../apps/server/src/db/client.js";

const testEmail = "browser-check@luxmorai.invalid";
await sql`DELETE FROM direct_messages WHERE sender_id IN (SELECT id FROM users WHERE email = ${testEmail}) OR recipient_id IN (SELECT id FROM users WHERE email = ${testEmail})`;
await sql`DELETE FROM users WHERE email = ${testEmail}`;
const [organization] = await sql`SELECT id FROM organizations WHERE domain = 'luxmorai.com'`;
const testPasswordHash = await bcrypt.hash("BrowserCheck!2026", 4);
const [testEmployee] = await sql`
  INSERT INTO users (
    organization_id, employee_id, email, password_hash, full_name, title, department, role,
    initials, avatar_color, presence, must_change_password
  )
  VALUES (${organization.id}, 'LUX-BROWSER-TEST', ${testEmail}, ${testPasswordHash}, 'Browser Test Employee',
    'Quality Analyst', 'Quality', 'employee', 'BT', '#7C4DFF', 'online', TRUE)
  RETURNING id
`;
const testChannels = await sql`SELECT id FROM channels WHERE organization_id = ${organization.id} AND is_private = FALSE`;
for (const channel of testChannels) {
  await sql`INSERT INTO channel_members (channel_id, user_id) VALUES (${channel.id}, ${testEmployee.id}) ON CONFLICT DO NOTHING`;
}

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profilePath = path.join(os.tmpdir(), `synapse-browser-${Date.now()}`);
const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--remote-debugging-port=9223",
  `--user-data-dir=${profilePath}`,
  "http://localhost:5173"
], { stdio: "ignore", windowsHide: true });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket;
let callId = 0;
const pending = new Map();
const exceptions = [];

try {
  let target;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await wait(200);
    const targets = await fetch("http://127.0.0.1:9223/json/list").then((response) => response.json()).catch(() => []);
    target = targets.find((item) => item.type === "page");
    if (target) break;
  }
  if (!target) throw new Error("Chrome debugging target did not start");

  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  socket.on("message", (raw) => {
    const message = JSON.parse(raw);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
    if (message.method === "Runtime.exceptionThrown") {
      exceptions.push(message.params.exceptionDetails);
    }
  });
  const command = (method, params = {}) => new Promise((resolve) => {
    const id = ++callId;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
  await command("Runtime.enable");
  await command("Page.enable");

  const login = await fetch("http://localhost:4000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })
  }).then((response) => response.json());

  await command("Runtime.evaluate", {
    expression: `localStorage.removeItem("luxsyncspace_token"); localStorage.setItem("synapse_token", ${JSON.stringify(login.token)})`,
    awaitPromise: true
  });
  await command("Page.reload", { ignoreCache: true });
  await wait(6000);
  await command("Runtime.evaluate", { expression: `[...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Chat")?.click()` });
  await wait(1200);
  const chatResult = await command("Runtime.evaluate", { expression: `document.body.innerText.includes("Start a conversation")`, returnByValue: true });
  await command("Runtime.evaluate", { expression: `document.querySelector(".employee-chat-grid .button-secondary")?.click()` });
  await wait(1500);
  const employeeResult = await command("Runtime.evaluate", { expression: `JSON.stringify({ conversation: document.body.innerText.includes("Conversation with"), recovery: document.body.innerText.includes("We couldn’t open this page") })`, returnByValue: true });
  await command("Runtime.evaluate", { expression: `[...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Settings")?.click()` });
  await wait(1200);
  const settingsResult = await command("Runtime.evaluate", { expression: `document.body.innerText.includes("Profile & organization")`, returnByValue: true });
  await command("Runtime.evaluate", { expression: `[...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Invite employees")?.click()` });
  await wait(500);
  const inviteFieldsResult = await command("Runtime.evaluate", {
    expression: `["Employee name","Work email","Designation","Department","Access role","Phone number","Work location","Reporting manager","Joining date","Employee profile summary"].every((label) => document.body.innerText.includes(label))`,
    returnByValue: true
  });
  const temporaryLogin = await fetch("http://localhost:4000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: testEmail, password: "BrowserCheck!2026" })
  }).then((response) => response.json());
  await command("Runtime.evaluate", {
    expression: `localStorage.setItem("luxsyncspace_token", ${JSON.stringify(temporaryLogin.token)})`
  });
  await command("Page.reload", { ignoreCache: true });
  await wait(2500);
  const passwordResult = await command("Runtime.evaluate", { expression: `document.body.innerText.includes("Create your private password")`, returnByValue: true });
  const result = await command("Runtime.evaluate", {
    expression: `JSON.stringify({ text: document.body.innerText.slice(0, 1200), html: document.getElementById("root")?.innerHTML.slice(0, 500), url: location.href })`,
    returnByValue: true
  });
  console.log("PAGE", result.result?.result?.value);
  console.log("CHAT_RENDERED", chatResult.result?.result?.value);
  console.log("EMPLOYEE_CLICK", employeeResult.result?.result?.value);
  console.log("SETTINGS_RENDERED", settingsResult.result?.result?.value);
  console.log("ALL_INVITE_PROFILE_FIELDS", inviteFieldsResult.result?.result?.value);
  console.log("TEMPORARY_PASSWORD_SCREEN", passwordResult.result?.result?.value);
  console.log("EXCEPTIONS", JSON.stringify(exceptions, null, 2));
} finally {
  socket?.close();
  chrome.kill();
  await sql`DELETE FROM direct_messages WHERE sender_id = ${testEmployee.id} OR recipient_id = ${testEmployee.id}`;
  await sql`DELETE FROM users WHERE id = ${testEmployee.id}`;
}
