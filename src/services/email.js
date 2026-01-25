import crypto from "crypto";
import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM = process.env.RESEND_FROM || "Kue <no-reply@kueapp.local>";
const APP_BASE_URL = process.env.APP_BASE_URL || "http://localhost:5173";
const TOKEN_TTL_HOURS = Number(process.env.EMAIL_VERIFY_TTL_HOURS || 24);
const RESET_TTL_HOURS = Number(process.env.PASSWORD_RESET_TTL_HOURS || 2);

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

function buildVerifyUrl(token) {
  return `${APP_BASE_URL.replace(/\/$/, "")}/verify?token=${encodeURIComponent(token)}`;
}

export function generateVerificationToken() {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000);
  return { token, tokenHash, expiresAt };
}

export function generateResetToken() {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + RESET_TTL_HOURS * 60 * 60 * 1000);
  return { token, tokenHash, expiresAt };
}

function buildResetUrl(token) {
  return `${APP_BASE_URL.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
}

export async function sendVerificationEmail({ to, token }) {
  const verifyUrl = buildVerifyUrl(token);
  if (!resend) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Email service is not configured");
    }
    console.log(`[dev] Verification email link for ${to}: ${verifyUrl}`);
    return { skipped: true };
  }

  const subject = "Verify your Kue account";
  const html = `
  <div style="background:#f6efe7;padding:32px 16px;font-family:Arial,sans-serif;color:#1f1c17;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;margin:0 auto;background:#fffaf4;border-radius:16px;border:1px solid #e6d6c4;overflow:hidden;">
      <tr>
        <td style="padding:24px 24px 8px;">
          <div style="font-size:20px;font-weight:700;letter-spacing:0.02em;color:#1f1c17;">Kue</div>
          <div style="font-size:12px;color:#7b6f62;">Queue control for courts</div>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 24px 0;">
          <h2 style="margin:0 0 8px;font-size:22px;color:#1f1c17;">Verify your email</h2>
          <p style="margin:0 0 14px;font-size:14px;color:#5b5248;line-height:1.6;">
            Thanks for signing up. Confirm your email to activate your account and start running live sessions.
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:8px 24px 16px;">
          <a href="${verifyUrl}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#0f9d8a;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;">
            Verify Email
          </a>
        </td>
      </tr>
      <tr>
        <td style="padding:0 24px 16px;">
          <p style="margin:0;font-size:12px;color:#7b6f62;">
            This link expires in ${TOKEN_TTL_HOURS} hours.
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 24px 20px;">
          <div style="padding:12px 14px;border-radius:12px;background:#f7efe5;border:1px dashed #e4d4c2;">
            <p style="margin:0;font-size:12px;color:#7b6f62;line-height:1.5;">
              If the button does not work, copy and paste this URL into your browser:
              <br />
              <span style="word-break:break-all;color:#1f1c17;">${verifyUrl}</span>
            </p>
          </div>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 24px;background:#f2e6d7;border-top:1px solid #e6d6c4;">
          <p style="margin:0;font-size:12px;color:#7b6f62;line-height:1.5;">
            You received this email because a Kue account was created with this address. If this was not you, you can safely ignore this message.
          </p>
        </td>
      </tr>
    </table>
  </div>
  `;
  const text = [
    "Verify your Kue account",
    "",
    "Confirm your email to activate your account:",
    verifyUrl,
    "",
    `This link expires in ${TOKEN_TTL_HOURS} hours.`,
    "",
    "If you did not create this account, you can ignore this message."
  ].join("\n");

  return resend.emails.send({
    from: RESEND_FROM,
    to,
    subject,
    html,
    text
  });
}

export async function sendPasswordResetEmail({ to, token }) {
  const resetUrl = buildResetUrl(token);
  if (!resend) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Email service is not configured");
    }
    console.log(`[dev] Password reset link for ${to}: ${resetUrl}`);
    return { skipped: true };
  }

  const subject = "Reset your Kue password";
  const html = `
  <div style="background:#f6efe7;padding:32px 16px;font-family:Arial,sans-serif;color:#1f1c17;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;margin:0 auto;background:#fffaf4;border-radius:16px;border:1px solid #e6d6c4;overflow:hidden;">
      <tr>
        <td style="padding:24px 24px 8px;">
          <div style="font-size:20px;font-weight:700;letter-spacing:0.02em;color:#1f1c17;">Kue</div>
          <div style="font-size:12px;color:#7b6f62;">Queue control for courts</div>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 24px 0;">
          <h2 style="margin:0 0 8px;font-size:22px;color:#1f1c17;">Reset your password</h2>
          <p style="margin:0 0 14px;font-size:14px;color:#5b5248;line-height:1.6;">
            Use the link below to set a new password for your Kue account.
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:8px 24px 16px;">
          <a href="${resetUrl}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#4f7bff;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;">
            Reset Password
          </a>
        </td>
      </tr>
      <tr>
        <td style="padding:0 24px 16px;">
          <p style="margin:0;font-size:12px;color:#7b6f62;">
            This link expires in ${RESET_TTL_HOURS} hours.
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 24px 20px;">
          <div style="padding:12px 14px;border-radius:12px;background:#f7efe5;border:1px dashed #e4d4c2;">
            <p style="margin:0;font-size:12px;color:#7b6f62;line-height:1.5;">
              If the button does not work, copy and paste this URL into your browser:
              <br />
              <span style="word-break:break-all;color:#1f1c17;">${resetUrl}</span>
            </p>
          </div>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 24px;background:#f2e6d7;border-top:1px solid #e6d6c4;">
          <p style="margin:0;font-size:12px;color:#7b6f62;line-height:1.5;">
            If you didn’t request a password reset, you can safely ignore this email.
          </p>
        </td>
      </tr>
    </table>
  </div>
  `;
  const text = [
    "Reset your Kue password",
    "",
    "Use this link to set a new password:",
    resetUrl,
    "",
    `This link expires in ${RESET_TTL_HOURS} hours.`,
    "",
    "If you did not request this, you can ignore this message."
  ].join("\n");

  return resend.emails.send({
    from: RESEND_FROM,
    to,
    subject,
    html,
    text
  });
}
