"use strict";

// Compose the real account emails locally; never connect to SMTP or send mail.
const assert = require("node:assert/strict");
const nodemailer = require("nodemailer");
const { createServerAccountSessionHelpers } = require("../server_account_session_helpers");

async function main() {
  const original = nodemailer.createTransport;
  const messages = [];
  nodemailer.createTransport = options => {
    assert.equal(options.host, "smtp.example.test");
    assert.equal(options.port, 587);
    assert.deepEqual(options.auth, { user: "fixture", pass: "fixture" });
    const local = original({ jsonTransport: true });
    return { sendMail: async message => {
      const result = await local.sendMail(message);
      messages.push(JSON.parse(result.message));
      return result;
    } };
  };
  try {
    const helpers = createServerAccountSessionHelpers({
      SMTP_HOST: "smtp.example.test", SMTP_PORT: 587, SMTP_SECURE: false,
      SMTP_USER: "fixture", SMTP_PASS: "fixture", SMTP_FROM: "PixelMania <no-reply@example.test>",
      PUBLIC_BASE_URL: "https://example.test",
      cleanEmail: value => String(value).trim().toLowerCase(),
    });
    const account = { username: "Test <Player>", email: "player@example.test" };
    await helpers.sendVerificationEmail(account, "verification-fixture");
    await helpers.sendPasswordResetEmail(account, "reset-fixture");
    await helpers.sendEmailChangeEmail(account, "new@example.test", "change-fixture");
    assert.equal(messages.length, 3);
    for (const [index, route] of ["verify-email", "reset-password", "change-email"].entries()) {
      const message = messages[index];
      assert.equal(message.to[0].address, index === 2 ? "new@example.test" : account.email);
      assert.ok(message.text.includes(`https://example.test/${route}?token=`));
      assert.ok(message.html.includes("Test &lt;Player&gt;"));
      assert.equal(message.from.address, "no-reply@example.test");
    }
    console.log("MAIL_TRANSPORT_PASS: verification, password reset and email change composed without SMTP");
  } finally {
    nodemailer.createTransport = original;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
