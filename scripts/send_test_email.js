require("dotenv").config({ quiet: true });

const nodemailer = require("nodemailer");

const SMTP_HOST = String(process.env.SMTP_HOST || "").trim();
const SMTP_PORT = Math.max(1, Math.trunc(Number(process.env.SMTP_PORT) || 587));
const SMTP_SECURE = String(process.env.SMTP_SECURE || "").trim().toLowerCase() === "true";
const SMTP_USER = String(process.env.SMTP_USER || "").trim();
const SMTP_PASS = String(process.env.SMTP_PASS || "");
const SMTP_FROM = String(process.env.SMTP_FROM || SMTP_USER || "PixelMania <no-reply@pixelmania.local>").trim();
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 8080}`).replace(/\/+$/, "");

const to = String(process.argv[2] || process.env.TEST_EMAIL_TO || "").trim();

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!SMTP_HOST) {
  fail("SMTP_HOST is missing. Add SMTP settings to .env first.");
}

if (!to) {
  fail("Missing recipient. Use TEST_EMAIL_TO in .env or run: npm run email:test -- you@example.com");
}

const transportOptions = {
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_SECURE,
};

if (SMTP_USER !== "" || SMTP_PASS !== "") {
  transportOptions.auth = {
    user: SMTP_USER,
    pass: SMTP_PASS,
  };
}

async function main() {
  const transporter = nodemailer.createTransport(transportOptions);
  await transporter.verify();
  const result = await transporter.sendMail({
    from: SMTP_FROM,
    to,
    subject: "PixelMania email verification test",
    text: [
      "PixelMania SMTP is configured correctly.",
      "",
      `Verification base URL: ${PUBLIC_BASE_URL}/verify-email`,
      "",
      "If this reached your inbox, account verification emails can be sent by the server.",
    ].join("\n"),
    html: [
      "<p>PixelMania SMTP is configured correctly.</p>",
      `<p>Verification base URL: <code>${PUBLIC_BASE_URL}/verify-email</code></p>`,
      "<p>If this reached your inbox, account verification emails can be sent by the server.</p>",
    ].join("\n"),
  });

  console.log(`Sent PixelMania SMTP test email to ${to}.`);
  if (result.messageId) {
    console.log(`Message ID: ${result.messageId}`);
  }
}

main().catch((error) => {
  fail(`Could not send test email: ${error.message}`);
});
