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

const cleanStr = (s?: string) => (s ? s.trim().replace(/^["']|["']$/g, '') : '');
const cleanPassStr = (s?: string) => (s ? s.trim().replace(/^["']|["']$/g, '').replace(/\s+/g, '') : '');

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
        const user = cleanStr(smtp.user || process.env.SMTP_USER);
        const pass = cleanPassStr(smtp.pass || process.env.SMTP_PASS);
        const service = cleanStr(smtp.service || process.env.SMTP_SERVICE) || 'gmail';
        const host = cleanStr(smtp.host || process.env.SMTP_HOST) || 'smtp.gmail.com';
        const configuredPort = smtp.port || parseInt(process.env.SMTP_PORT || '587', 10);
        
        // On cloud container platforms (Railway/Render/AWS), direct SSL on port 465 is vastly
        // more reliable and bypasses STARTTLS port 587 handshake blocks/timeouts.
        const isGmail = service.toLowerCase() === 'gmail' || host.includes('gmail');
        const port = isGmail ? 465 : configuredPort;
        const secure = isGmail ? true : (smtp.secure || process.env.SMTP_SECURE === 'true' || port === 465);

        if ((service || host) && user && pass) {
            try {
                this.smtpTransporter = nodemailer.createTransport({
                    host: isGmail ? 'smtp.gmail.com' : host,
                    port,
                    secure,
                    auth: { user, pass },
                    connectionTimeout: 4000,
                    greetingTimeout: 4000,
                    socketTimeout: 5000,
                });
                console.log(`[EmailService] SMTP transporter initialized (${isGmail ? 'smtp.gmail.com:465 SSL' : `${host}:${port}`}) for ${user}`);
            } catch (err: any) {
                console.error('[EmailService] Failed to initialize SMTP transporter:', err?.message || err);
            }
        } else {
            console.log('[EmailService] SMTP credentials not provided. Set SMTP_USER and SMTP_PASS (or RESEND_API_KEY) in environment variables to enable email sending.');
        }
    }

    /**
     * Sends an email trying available providers in order: Resend (HTTPS) -> SMTP -> SendGrid.
     */
    async sendEmail(options: SendEmailOptions): Promise<EmailResult> {
        const to = (options.to || '').trim().toLowerCase();
        const { subject, html, text } = options;
        const fromAddress = config.email.from;
        const fromName = config.email.fromName || 'WatchersHive';
        const formattedFrom = `${fromName} <${fromAddress}>`;
        let lastError = '';

        // 1. Try Resend first if configured (Fast, HTTPS Port 443 — reliable on Railway)
        const resendKey = cleanStr(config.email.resendApiKey || process.env.RESEND_API_KEY || process.env.RESEND_KEY || process.env.RESEND_TOKEN);
        if (resendKey && !resendKey.includes('placeholder') && !resendKey.includes('your-resend-api-key')) {
            try {
                // watchershive.com is verified on Resend!
                // If EMAIL_FROM is support@watchershive.com or any watchershive.com address, use it directly.
                // If EMAIL_FROM is still set to @gmail.com, route via support@watchershive.com.
                let resendSender = formattedFrom;
                if (process.env.RESEND_FORCE_ONBOARDING === 'true') {
                    resendSender = `${fromName} <onboarding@resend.dev>`;
                } else if (fromAddress.includes('watchershive.com')) {
                    resendSender = formattedFrom;
                } else if (fromAddress.toLowerCase().endsWith('@gmail.com') || !fromAddress.includes('@')) {
                    resendSender = `${fromName} <support@watchershive.com>`;
                }

                let res = await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${resendKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        from: resendSender,
                        to: [to],
                        subject,
                        html,
                        text,
                    }),
                });

                let data: any = await res.json().catch(() => ({}));

                // If domain verification failed, auto-fallback to onboarding@resend.dev
                if (!res.ok && (data?.message?.includes('domain is not verified') || data?.message?.includes('validation_error'))) {
                    console.log('[EmailService] Domain unverified on Resend. Falling back to onboarding@resend.dev...');
                    resendSender = `${fromName} <onboarding@resend.dev>`;
                    res = await fetch('https://api.resend.com/emails', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${resendKey}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            from: resendSender,
                            to: [to],
                            subject,
                            html,
                            text,
                        }),
                    });
                    data = await res.json().catch(() => ({}));
                }

                if (res.ok) {
                    console.log(`[EmailService] Email delivered to ${to} via Resend. ID: ${data?.id}`);
                    return { success: true, provider: 'resend', messageId: data?.id };
                } else {
                    const errDetail = data?.message || JSON.stringify(data);
                    lastError = `Resend delivery rejected (${res.status}) [from=${resendSender}, to=${to}]: ${errDetail}`;
                    console.error(`[EmailService] ${lastError}`);
                    // Return immediately so the explicit Resend rejection is surfaced to the client
                    return {
                        success: false,
                        provider: 'resend',
                        error: lastError,
                    };
                }
            } catch (resendErr: any) {
                lastError = `Resend network exception: ${resendErr?.message || resendErr}`;
                console.error('[EmailService]', lastError);
            }
        }

        // 2. Try SMTP if configured (e.g. Gmail SMTP)
        if (!this.smtpTransporter) {
            this.initSmtp();
        }
        const user = cleanStr(config.email.smtp.user || process.env.SMTP_USER);
        const pass = cleanPassStr(config.email.smtp.pass || process.env.SMTP_PASS);

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
                lastError = `SMTP error: ${smtpErr?.message || smtpErr}`;
                console.error('[EmailService]', lastError);

                // Auto-fallback: try alternate port if connection timed out or failed on primary port
                if (user && pass && (smtpErr?.message?.includes('timeout') || smtpErr?.code === 'ETIMEDOUT' || smtpErr?.code === 'ECONNRESET' || smtpErr?.code === 'ESOCKET')) {
                    console.log('[EmailService] Primary SMTP timed out, attempting port 587 STARTTLS fallback...');
                    try {
                        const fallbackTransporter = nodemailer.createTransport({
                            host: 'smtp.gmail.com',
                            port: 587,
                            secure: false,
                            auth: { user, pass },
                            connectionTimeout: 4000,
                            greetingTimeout: 4000,
                            socketTimeout: 5000,
                        });
                        const fallbackInfo = await fallbackTransporter.sendMail({
                            from: formattedFrom,
                            to,
                            subject,
                            html,
                            text,
                        });
                        console.log(`[EmailService] Email delivered to ${to} via fallback SMTP (port 587). MessageId: ${fallbackInfo.messageId}`);
                        this.smtpTransporter = fallbackTransporter;
                        return { success: true, provider: 'smtp', messageId: fallbackInfo.messageId };
                    } catch (fallbackErr: any) {
                        lastError = `Fallback SMTP error: ${fallbackErr?.message || fallbackErr}`;
                        console.error('[EmailService]', lastError);
                    }
                }
            }
        }

        // 3. Try SendGrid if configured
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
                    lastError = `SendGrid error status ${res.status}: ${errBody}`;
                    console.error(`[EmailService] ${lastError}`);
                }
            } catch (sendgridErr: any) {
                lastError = `SendGrid network exception: ${sendgridErr?.message || sendgridErr}`;
                console.error('[EmailService]', lastError);
            }
        }

        console.warn(`[EmailService] No configured email providers could deliver email to ${to}. ${lastError}`);
        return {
            success: false,
            error: lastError || 'Email delivery provider is unconfigured or failed to transmit message.',
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
                                            <div style="margin-top: 12px; font-size: 12px; color: #8C827A;">
                                                On mobile? <a href="watchershive://reset-password?${resetLink.split('?')[1] || ''}" style="color: #B38000; font-weight: 700; text-decoration: underline;">Open in WatchHive App</a>
                                            </div>
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
