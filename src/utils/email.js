const nodemailer = require("nodemailer");

// SMTP is optional in development — when SMTP_HOST is not configured
// (or a user is set without a password), emails are printed to the
// console instead of being sent.
const smtpConfigured =
  !!process.env.SMTP_HOST &&
  (!process.env.SMTP_USER || !!process.env.SMTP_PASS);

const transporter = smtpConfigured
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER
        ? {
            user: process.env.SMTP_USER,
            // Google displays App Passwords with spaces — strip them
            pass: (process.env.SMTP_PASS || "").replace(/\s+/g, ""),
          }
        : undefined,
    })
  : null;

const FROM = process.env.EMAIL_FROM || '"CollabFlow" <no-reply@collabflow.local>';

const sendMail = async ({ to, subject, html, text }) => {
  if (!smtpConfigured) {
    console.info(`\n[email] SMTP not configured — email to ${to}`);
    console.info(`[email] Subject: ${subject}`);
    console.info(`[email] ${text}\n`);
    return;
  }
  await transporter.sendMail({ from: FROM, to, subject, html, text });
};

const layout = (title, bodyHtml) => `
  <div style="background:#f4f4f7;padding:32px 16px;font-family:Segoe UI,Arial,sans-serif">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
      <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:24px;text-align:center">
        <h1 style="margin:0;color:#ffffff;font-size:20px">CollabFlow</h1>
      </div>
      <div style="padding:28px 24px;color:#374151;font-size:14px;line-height:1.6">
        <h2 style="margin:0 0 12px;color:#111827;font-size:18px">${title}</h2>
        ${bodyHtml}
      </div>
      <div style="padding:16px 24px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:12px;text-align:center">
        If you didn't request this, you can safely ignore this email.
      </div>
    </div>
  </div>`;

const sendVerificationEmail = async (to, name, verifyUrl) => {
  await sendMail({
    to,
    subject: "Verify your CollabFlow email address",
    text: `Hi ${name},\n\nConfirm your email address to activate your CollabFlow account:\n${verifyUrl}\n\nThis link expires in 24 hours.`,
    html: layout(
      "Confirm your email address",
      `<p>Hi ${name},</p>
       <p>Thanks for signing up for CollabFlow! Click the button below to verify your email address and activate your account.</p>
       <p style="text-align:center;margin:24px 0">
         <a href="${verifyUrl}" style="background:#6366f1;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;display:inline-block">Verify email</a>
       </p>
       <p>Or copy and paste this link into your browser:</p>
       <p style="word-break:break-all;color:#6366f1">${verifyUrl}</p>
       <p style="color:#9ca3af">This link expires in 24 hours.</p>`,
    ),
  });
};

module.exports = { sendMail, sendVerificationEmail };
