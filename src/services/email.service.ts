import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';

export interface SendEmailOptions {
    to: string;
    subject: string;
    html: string;
    text?: string;
}

export interface EmailResult {
    success: boolean;
    provider?: 'resend' | 'sendgrid' | 'smtp';
    messageId?: string;
    error?: string;
}

class EmailService {
    private smtpTransporter: Transporter | null = null;

    constructor() {
        this.initSmtp();
    }

    private initSmtp() {
        const { smtp } = config.email;
        if (smtp && (smtp.service || smtp.host) && smtp.user && smtp.pass) {
            try {
                if (smtp.service) {
                    this.smtpTransporter = nodemailer.createTransport({
                        service: smtp.service,
                        auth: {
                            user: smtp.user,
                            pass: smtp.pass,
                        },
                    });
                } else if (smtp.host) {
                    this.smtpTransporter = nodemailer.createTransport({
                        host: smtp.host,
                        port: smtp.port,
                        secure: smtp.secure,
                        auth: {
                            user: smtp.user,
                            pass: smtp.pass,
                        },
                    });
                }
            } catch (err: any) {
                console.error('[EmailService] Failed to initialize SMTP transporter:', err?.message || err);
            }
        }
    }

    /**
     * Sends an email trying available providers in order: Resend -> SendGrid -> SMTP.
     */
    async sendEmail(options: SendEmailOptions): Promise<EmailResult> {
        const { to, subject, html, text } = options;
        const fromAddress = config.email.from;
        const fromName = config.email.fromName || 'WatchersHive';
        const formattedFrom = `${fromName} <${fromAddress}>`;

        // 1. Try Resend if configured
        const resendKey = config.email.resendApiKey;
        if (resendKey && !resendKey.includes('placeholder') && !resendKey.includes('your-resend-api-key')) {
            try {
                const res = await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${resendKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        from: formattedFrom,
                        to: [to],
                        subject,
                        html,
                        text,
                    }),
                });

                if (res.ok) {
                    const data: any = await res.json().catch(() => ({}));
                    console.log(`[EmailService] Email delivered to ${to} via Resend. ID: ${data?.id}`);
                    return { success: true, provider: 'resend', messageId: data?.id };
                } else {
                    const errText = await res.text().catch(() => '');
                    console.error(`[EmailService] Resend API error (${res.status}): ${errText}`);
                }
            } catch (resendErr: any) {
                console.error('[EmailService] Network exception sending email via Resend:', resendErr?.message || resendErr);
            }
        }

        // 2. Try SendGrid if configured
        const sendgridKey = config.email.sendgridApiKey;
        if (sendgridKey && !sendgridKey.includes('placeholder') && !sendgridKey.includes('your-sendgrid-api-key')) {
            try {
                const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${sendgridKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        personalizations: [{ to: [{ email: to }] }],
                        from: { email: fromAddress, name: fromName },
                        subject,
                        content: [
                            { type: 'text/html', value: html },
                            ...(text ? [{ type: 'text/plain', value: text }] : []),
                        ],
                    }),
                });

                if (res.ok || res.status === 202) {
                    console.log(`[EmailService] Email delivered to ${to} via SendGrid.`);
                    return { success: true, provider: 'sendgrid' };
                } else {
                    const errBody = await res.text().catch(() => '');
                    console.error(`[EmailService] SendGrid error status ${res.status}: ${errBody}`);
                }
            } catch (sendgridErr: any) {
                console.error('[EmailService] Network exception sending email via SendGrid:', sendgridErr?.message || sendgridErr);
            }
        }

        // 3. Try SMTP if configured
        if (this.smtpTransporter) {
            try {
                const info = await this.smtpTransporter.sendMail({
                    from: formattedFrom,
                    to,
                    subject,
                    html,
                    text,
                });
                console.log(`[EmailService] Email delivered to ${to} via SMTP. MessageId: ${info.messageId}`);
                return { success: true, provider: 'smtp', messageId: info.messageId };
            } catch (smtpErr: any) {
                console.error('[EmailService] SMTP send error:', smtpErr?.message || smtpErr);
            }
        }

        console.warn(`[EmailService] No configured email providers could deliver email to ${to}. Please configure RESEND_API_KEY, SENDGRID_API_KEY, or SMTP credentials.`);
        return {
            success: false,
            error: 'Email delivery provider is unconfigured or failed to transmit message.',
        };
    }

    /**
     * Send formatted password reset email with 6-digit code and direct link.
     */
    async sendPasswordResetEmail(params: {
        to: string;
        code: string;
        resetLink: string;
    }): Promise<EmailResult> {
        const { to, code, resetLink } = params;

        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Reset Your Password</title>
            </head>
            <body style="margin: 0; padding: 0; background-color: #FAF8F5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #FAF8F5; padding: 40px 20px;">
                    <tr>
                        <td align="center">
                            <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 520px; background-color: #FFFFFF; border-radius: 16px; border: 1px solid #EBE5DF; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.03);">
                                <tr>
                                    <td style="padding: 32px 32px 20px 32px; text-align: center; border-bottom: 1px solid #F3EFEA;">
                                        <h1 style="margin: 0; font-size: 24px; font-weight: 800; color: #2D2926; letter-spacing: -0.5px;">
                                            🎬 Watchers<span style="color: #FFB700;">Hive</span>
                                        </h1>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding: 32px;">
                                        <h2 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 700; color: #2D2926;">
                                            Reset Your Password
                                        </h2>
                                        <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.6; color: #5C554E;">
                                            We received a request to reset the password for your WatchersHive account. Use the 6-digit verification code below to set a new password:
                                        </p>

                                        <!-- Verification Code Box -->
                                        <div style="background-color: #FFF9E6; border: 2px dashed #FFB700; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0;">
                                            <div style="font-size: 11px; font-weight: 800; letter-spacing: 1.5px; color: #B38000; text-transform: uppercase; margin-bottom: 8px;">
                                                Verification Code
                                            </div>
                                            <span style="font-size: 36px; font-weight: 900; letter-spacing: 8px; color: #2D2926; font-family: monospace;">
                                                ${code}
                                            </span>
                                        </div>

                                        <p style="margin: 20px 0 16px 0; font-size: 14px; line-height: 1.6; color: #5C554E;">
                                            Alternatively, you can tap the button below to reset your password directly in your browser or app:
                                        </p>

                                        <div style="text-align: center; margin: 24px 0;">
                                            <a href="${resetLink}" style="background-color: #FFB700; color: #2D2926; font-size: 15px; font-weight: 800; padding: 14px 28px; border-radius: 10px; text-decoration: none; display: inline-block;">
                                                Reset Password Directly
                                            </a>
                                        </div>

                                        <p style="margin: 24px 0 0 0; font-size: 12.5px; line-height: 1.5; color: #8C827A;">
                                            ⏱️ This verification code and link will expire in <strong>1 hour</strong>.<br>
                                            🔒 If you did not request a password reset, you can safely ignore this email. Your account remains completely secure.
                                        </p>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding: 20px 32px; background-color: #FAF8F5; border-top: 1px solid #F3EFEA; text-align: center;">
                                        <p style="margin: 0; font-size: 12px; color: #8C827A;">
                                            © ${new Date().getFullYear()} WatchersHive. All rights reserved.
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </body>
            </html>
        `;

        const text = `
WatchersHive Password Reset

We received a request to reset your password.

Your 6-digit verification code is: ${code}

Or reset directly using this link:
${resetLink}

This code and link expire in 1 hour. If you didn't request this, ignore this email.
        `.trim();

        return this.sendEmail({
            to,
            subject: 'Reset Your WatchersHive Password',
            html,
            text,
        });
    }
}

export const emailService = new EmailService();
