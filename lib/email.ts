// Email delivery via Resend (https://resend.com).
//
// Sends a short transactional email to a creator with the finished video URL.
// Resend free tier: 100 emails/day, 3000/month. We send a single email per
// brief delivery — well within free tier.
//
// Env:
//   RESEND_API_KEY      — required
//   RESEND_FROM         — required, e.g. "Mosaic Creator <hello@yourdomain.com>"
//                         (Resend requires a verified sender domain; for the
//                          trial you can use Resend's onboarding sender:
//                          "Mosaic <onboarding@resend.dev>")

import { Resend } from "resend";

const FROM_DEFAULT = "Mosaic Creator <onboarding@resend.dev>";

export type SendEmailOpts = {
  to: string;
  creator_handle: string;
  product_name: string;
  hook: string;
  cta: string;
  video_url: string;
  posting_notes?: string;
};

export type SendEmailResult = { id: string };

export async function sendDeliveryEmail(opts: SendEmailOpts): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY not set");
  const from = process.env.RESEND_FROM || FROM_DEFAULT;

  const resend = new Resend(apiKey);
  const subject = `New video drop for @${opts.creator_handle} — ${opts.product_name}`;

  const html = render({
    creator: opts.creator_handle,
    product: opts.product_name,
    hook: opts.hook,
    cta: opts.cta,
    video_url: opts.video_url,
    posting_notes: opts.posting_notes,
  });

  const text = [
    `Hey @${opts.creator_handle},`,
    ``,
    `Fresh ${opts.product_name} video ready for you.`,
    ``,
    `Hook: "${opts.hook}"`,
    `CTA:  "${opts.cta}"`,
    ``,
    `Watch / download: ${opts.video_url}`,
    ``,
    opts.posting_notes ? `Notes: ${opts.posting_notes}\n` : "",
    `— Mosaic Creator Engine`,
  ].join("\n");

  const { data, error } = await resend.emails.send({
    from,
    to: opts.to,
    subject,
    html,
    text,
  });
  if (error) throw new Error(`resend error: ${error.message ?? JSON.stringify(error)}`);
  if (!data?.id) throw new Error("resend returned no id");
  return { id: data.id };
}

function render(o: {
  creator: string;
  product: string;
  hook: string;
  cta: string;
  video_url: string;
  posting_notes?: string;
}): string {
  return `<!doctype html>
<html><body style="margin:0;background:#f6f5f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f6f5f1;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="540" style="max-width:540px;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e3e2dd;">
        <tr><td style="padding:32px 32px 18px;">
          <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#7cb47c;font-weight:600;">New drop</div>
          <h1 style="font-family:Georgia,serif;font-size:26px;line-height:1.2;margin:8px 0 0;font-weight:500;">Fresh video for @${escapeHtml(o.creator)}</h1>
          <p style="margin:8px 0 0;color:#5e6660;font-size:14px;">${escapeHtml(o.product)}</p>
        </td></tr>

        <tr><td style="padding:8px 32px 24px;">
          <p style="margin:18px 0 4px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#7e857f;font-weight:600;">Hook</p>
          <p style="font-family:Georgia,serif;font-size:20px;line-height:1.25;margin:0;">&ldquo;${escapeHtml(o.hook)}&rdquo;</p>
          <p style="margin:18px 0 4px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#7e857f;font-weight:600;">CTA</p>
          <p style="font-family:Georgia,serif;font-size:18px;line-height:1.25;margin:0;">&ldquo;${escapeHtml(o.cta)}&rdquo;</p>
        </td></tr>

        <tr><td style="padding:0 32px 28px;">
          <a href="${escapeHtml(o.video_url)}" style="display:inline-block;background:#7cb47c;color:#0b0d0c;font-weight:600;padding:14px 22px;border-radius:10px;text-decoration:none;font-size:15px;">Watch the video →</a>
          <p style="margin:14px 0 0;color:#7e857f;font-size:12px;word-break:break-all;">${escapeHtml(o.video_url)}</p>
        </td></tr>

        ${o.posting_notes ? `<tr><td style="padding:0 32px 28px;">
          <p style="margin:0 0 6px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#7e857f;font-weight:600;">Posting notes</p>
          <p style="margin:0;color:#3a3f3b;font-size:14px;line-height:1.5;">${escapeHtml(o.posting_notes)}</p>
        </td></tr>` : ""}

        <tr><td style="padding:18px 32px 26px;border-top:1px solid #ece9e0;">
          <p style="margin:0;color:#7e857f;font-size:12px;">Sent by Mosaic Creator Engine · Root Labs.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
