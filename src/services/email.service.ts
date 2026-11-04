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

    public isConfigured(): boolean {
        if (!this.smtpTransporter) {
            this.initSmtp();
        }
        return !!(
            this.smtpTransporter ||
            (config.email.resendApiKey && !config.email.resendApiKey.includes('placeholder')) ||
            (config.email.sendgridApiKey && !config.email.sendgridApiKey.includes('placeholder'))
        );
    }

    private initSmtp() {
        const { smtp } = config.email;
        const user = smtp.user || process.env.SMTP_USER;
        const pass = smtp.pass || process.env.SMTP_PASS;
        const service = smtp.service || process.env.SMTP_SERVICE;
        const host = smtp.host || process.env.SMTP_HOST;
        const port = smtp.port || parseInt(process.env.SMTP_PORT || '587', 10);
        const secure = smtp.secure || process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465';

        if ((service || host) && user && pass) {
            try {
                if (service) {
                    this.smtpTransporter = nodemailer.createTransport({
                        service,
                        auth: { user, pass },
                        connectionTimeout: 5000,
                        greetingTimeout: 5000,
                        socketTimeout: 8000,
                    });
                } else if (host) {
                    this.smtpTransporter = nodemailer.createTransport({
                        host,
                        port,
                        secure,
                        auth: { user, pass },
                        connectionTimeout: 5000,
                        greetingTimeout: 5000,
                        socketTimeout: 8000,
                    });
                }
                console.log(`[EmailService] SMTP transporter initialized (${service || host}) for ${user}`);
            } catch (err: any) {
                console.error('[EmailService] Failed to initialize SMTP transporter:', err?.message || err);
            }
        } else {
            console.log('[EmailService] SMTP credentials not provided. Set SMTP_USER and SMTP_PASS (or RESEND_API_KEY) in environment variables to enable email sending.');
        }
    }

    /**
     * Sends an email trying available providers in order: Resend -> SendGrid -> SMTP.
     */
    async sendEmail(options: SendEmailOptions): Promise<EmailResult> {
        if (!this.smtpTransporter) {
            this.initSmtp();
        }
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

        const result = await this.sendEmail({
            to,
            subject: 'Reset Your WatchersHive Password',
            html,
            text,
        });

        if (!result.success) {
            console.warn(
                `\n╔══════════════════════════════════════════════════════════════════════════╗\n` +
                `║ 🔑 [WatchersHive Password Reset OTP]                                      ║\n` +
                `║ To:   ${to}\n` +
                `║ Code: ${code}\n` +
                `║ Link: ${resetLink}\n` +
                `║ Note: Configure SMTP_USER / SMTP_PASS in .env to deliver real emails.     ║\n` +
                `╚══════════════════════════════════════════════════════════════════════════╝\n`
            );
        }

        return result;
    }

    /**
     * Send formatted email verification with 6-digit code and direct confirmation link.
     */
    async sendVerificationEmail(params: {
        to: string;
        username: string;
        code: string;
        verificationLink: string;
    }): Promise<EmailResult> {
        const { to, username, code, verificationLink } = params;

        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Verify Your Email Address</title>
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
                                            Welcome to WatchersHive, ${username}!
                                        </h2>
                                        <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.6; color: #5C554E;">
                                            Please verify your email address to secure your account and start logging your movie journey:
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
                                            You can also verify directly by clicking the button below:
                                        </p>

                                        <div style="text-align: center; margin: 24px 0;">
                                            <a href="${verificationLink}" style="background-color: #FFB700; color: #2D2926; font-size: 15px; font-weight: 800; padding: 14px 28px; border-radius: 10px; text-decoration: none; display: inline-block;">
                                                Verify Email Address
                                            </a>
                                        </div>

                                        <p style="margin: 24px 0 0 0; font-size: 12.5px; line-height: 1.5; color: #8C827A;">
                                            ⏱️ This verification link expires in <strong>24 hours</strong>.<br>
                                            🔒 If you did not create an account on WatchersHive, you can safely ignore this email.
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
Welcome to WatchersHive, ${username}!

Your verification code is: ${code}

Or verify directly with this link:
${verificationLink}

This code and link expire in 24 hours.
        `.trim();

        const result = await this.sendEmail({
            to,
            subject: 'Verify Your WatchersHive Email Address',
            html,
            text,
        });

        if (!result.success) {
            console.warn(
                `\n╔══════════════════════════════════════════════════════════════════════════╗\n` +
                `║ 🔑 [WatchersHive Email Verification OTP]                                 ║\n` +
                `║ To:   ${to}\n` +
                `║ Code: ${code}\n` +
                `║ Link: ${verificationLink}\n` +
                `║ Note: Configure SMTP_USER / SMTP_PASS in .env to deliver real emails.     ║\n` +
                `╚══════════════════════════════════════════════════════════════════════════╝\n`
            );
        }

        return result;
    }
}

export const emailService = new EmailService();
