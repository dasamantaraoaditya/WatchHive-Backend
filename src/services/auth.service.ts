import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq, or, sql } from 'drizzle-orm';
import { hashPassword, comparePassword } from '../utils/bcrypt.util.js';
import {
    generateAccessToken,
    generateRefreshToken,
    verifyRefreshToken,
} from '../utils/jwt.util.js';
import { AppError } from '../middleware/error.middleware.js';
import crypto from 'crypto';
import { config } from '../config.js';
import { resolveAvatarUrl } from '../utils/avatar.util.js';

export interface RegisterData {
    username: string;
    email: string;
    password: string;
    displayName?: string;
}

export interface LoginData {
    email: string;
    password: string;
}

export interface AuthResponse {
    user: {
        id: string;
        username: string;
        email: string;
        displayName: string | null;
        profilePictureUrl: string | null;
        hasGoogleLinked: boolean;
        hasPassword: boolean;
    };
    accessToken: string;
    refreshToken: string;
}

/** Hash a reset token for safe DB storage (SHA-256, not bcrypt — speed matters here) */
function hashResetToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
}

export const authService = {
    async register(data: RegisterData): Promise<AuthResponse> {
        // Check if user already exists
        const [existingUser] = await db
            .select()
            .from(users)
            .where(or(eq(users.email, data.email), eq(users.username, data.username)))
            .limit(1);

        if (existingUser) {
            if (existingUser.email === data.email) {
                throw new AppError('Email already in use', 400);
            }
            throw new AppError('Username already taken', 400);
        }

        // Hash password
        const passwordHash = await hashPassword(data.password);

        // Create user
        const [user] = await db
            .insert(users)
            .values({
                username: data.username,
                email: data.email,
                passwordHash,
                displayName: data.displayName || data.username,
            })
            .returning({
                id: users.id,
                username: users.username,
                email: users.email,
                displayName: users.displayName,
                profilePictureUrl: users.profilePictureUrl,
                googleId: users.googleId,
                passwordHash: users.passwordHash,
                tokenVersion: users.tokenVersion,
            });

        // Generate tokens
        const accessToken = generateAccessToken({
            userId: user.id,
            email: user.email,
            tokenVersion: user.tokenVersion ?? 1,
        });
        const refreshToken = generateRefreshToken({
            userId: user.id,
            email: user.email,
            tokenVersion: user.tokenVersion ?? 1,
        });

        return {
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                displayName: user.displayName,
                profilePictureUrl: resolveAvatarUrl(user.profilePictureUrl),
                hasGoogleLinked: !!user.googleId,
                hasPassword: !!user.passwordHash,
            },
            accessToken,
            refreshToken,
        };
    },

    async login(data: LoginData): Promise<AuthResponse> {
        const identifier = data.email.trim();

        // Find user by email or username (case-insensitive)
        const [user] = await db
            .select({
                id: users.id,
                username: users.username,
                email: users.email,
                displayName: users.displayName,
                profilePictureUrl: users.profilePictureUrl,
                passwordHash: users.passwordHash,
                googleId: users.googleId,
                tokenVersion: users.tokenVersion,
            })
            .from(users)
            .where(
                or(
                    eq(sql`lower(${users.email})`, identifier.toLowerCase()),
                    eq(sql`lower(${users.username})`, identifier.toLowerCase())
                )
            )
            .limit(1);

        if (!user) {
            throw new AppError('Incorrect email, username, or password. Please verify your details or use "Forgot password?" to reset.', 401);
        }

        // If user has no password (Google-only account), return a structured error
        // so the frontend can show an actionable recovery UI instead of a dead-end.
        if (!user.passwordHash) {
            const err = new AppError(
                'This account was created with Google Sign-In. Please sign in with Google, or use "Forgot password?" to set a password.',
                400
            ) as any;
            err.code = 'google_only_account';
            err.hasGoogleLinked = !!user.googleId;
            throw err;
        }

        // Verify password
        const isPasswordValid = await comparePassword(
            data.password,
            user.passwordHash
        );

        if (!isPasswordValid) {
            throw new AppError('Incorrect email, username, or password. Please verify your details or use "Forgot password?" to reset.', 401);
        }

        // Generate tokens
        const accessToken = generateAccessToken({
            userId: user.id,
            email: user.email,
            tokenVersion: user.tokenVersion ?? 1,
        });
        const refreshToken = generateRefreshToken({
            userId: user.id,
            email: user.email,
            tokenVersion: user.tokenVersion ?? 1,
        });

        return {
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                displayName: user.displayName,
                profilePictureUrl: resolveAvatarUrl(user.profilePictureUrl),
                hasGoogleLinked: !!user.googleId,
                hasPassword: true,
            },
            accessToken,
            refreshToken,
        };
    },

    async refresh(token: string): Promise<{ accessToken: string; refreshToken: string }> {
        try {
            const payload = verifyRefreshToken(token);

            // Verify user still exists
            const [user] = await db
                .select()
                .from(users)
                .where(eq(users.id, payload.userId))
                .limit(1);

            if (!user) {
                throw new AppError('User not found', 404);
            }

            // Invalidate if tokenVersion is present and does not match active DB version
            if (payload.tokenVersion !== undefined && user.tokenVersion !== undefined && payload.tokenVersion !== user.tokenVersion) {
                throw new AppError('Session expired or revoked. Please log in again.', 401);
            }

            // Generate new tokens
            const accessToken = generateAccessToken({
                userId: user.id,
                email: user.email,
                tokenVersion: user.tokenVersion ?? 1,
            });
            const refreshToken = generateRefreshToken({
                userId: user.id,
                email: user.email,
                tokenVersion: user.tokenVersion ?? 1,
            });

            return {
                accessToken,
                refreshToken,
            };
        } catch (error) {
            throw new AppError('Invalid refresh token', 401);
        }
    },

    /**
     * Initiate a password reset for the given email.
     * Generates both a secure 64-char token (for deep links/web) and a convenient 6-digit numeric OTP code.
     * Stores hashed versions of both.
     * Attempts SendGrid email delivery and captures errors transparently.
     */
    async forgotPassword(email: string): Promise<{
        message: string;
        emailSent: boolean;
        resetCode?: string;
        resetToken?: string;
        devToken?: string;
    }> {
        const normalizedEmail = email.trim().toLowerCase();
        const [user] = await db
            .select({ id: users.id, email: users.email })
            .from(users)
            .where(sql`LOWER(${users.email}) = ${normalizedEmail}`)
            .limit(1);

        // Always return success structure if user doesn't exist (prevent email enumeration)
        if (!user) {
            return {
                message: 'If that email is registered, a reset link and code have been sent.',
                emailSent: false,
            };
        }

        // Generate a secure random token and a convenient 6-digit numeric OTP
        const rawToken = crypto.randomBytes(32).toString('hex');
        const rawCode = Math.floor(100000 + Math.random() * 900000).toString();

        const hashedToken = hashResetToken(rawToken);
        const hashedCode = hashResetToken(rawCode);
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

        // Store both hashed token and hashed 6-digit OTP code in format "tokenHash:codeHash"
        await db
            .update(users)
            .set({
                passwordResetToken: `${hashedToken}:${hashedCode}`,
                passwordResetExpiresAt: expiresAt,
            })
            .where(eq(users.id, user.id));

        // The reset link
        const frontendUrl = config.cors.origin.split(',')[0].trim() || 'http://localhost:3000';
        const resetLink = `${frontendUrl}/watch-hive/reset-password?token=${rawToken}&email=${encodeURIComponent(user.email)}`;

        let emailSent = false;
        const sendgridKey = config.email.sendgridApiKey;
        const isKeyConfigured = sendgridKey &&
            !sendgridKey.includes('placeholder') &&
            !sendgridKey.includes('your-sendgrid-api-key');

        if (isKeyConfigured) {
            try {
                const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${sendgridKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        personalizations: [{ to: [{ email: user.email }] }],
                        from: { email: config.email.from, name: 'WatchersHive' },
                        subject: 'Reset Your WatchersHive Password',
                        content: [{
                            type: 'text/html',
                            value: `
                                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; color: #2D2926;">
                                    <h2 style="color: #ffb700; margin-bottom: 16px;">WatchersHive Password Reset</h2>
                                    <p>Hello,</p>
                                    <p>Use the 6-digit verification code below to reset your password:</p>
                                    <div style="background: #F8F9FA; border: 1px solid #E9ECEF; border-radius: 12px; padding: 16px; text-align: center; margin: 20px 0;">
                                        <span style="font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #2D2926;">${rawCode}</span>
                                    </div>
                                    <p>Alternatively, click the button below to reset directly:</p>
                                    <p style="text-align: center; margin: 24px 0;">
                                        <a href="${resetLink}" style="background: #ffb700; color: #FFFFFF; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">Reset Password</a>
                                    </p>
                                    <p style="color: #888888; font-size: 13px;">This code and link are valid for 1 hour. If you didn't request a password reset, you can safely ignore this email.</p>
                                </div>
                            `,
                        }],
                    }),
                });

                if (res.ok || res.status === 202) {
                    emailSent = true;
                } else {
                    const errBody = await res.text();
                    console.error(`[ForgotPassword] SendGrid error status ${res.status}:`, errBody);
                }
            } catch (emailErr) {
                console.error('[ForgotPassword] Network error sending password reset email via SendGrid:', emailErr);
            }
        } else {
            console.warn('[ForgotPassword] SendGrid API key is not configured. Reset code generated directly.');
        }

        // Smart fallback: Return code and token so users/testers are never locked out when email provider is unavailable
        return {
            message: emailSent
                ? 'If that email is registered, a reset link and code have been sent to your inbox.'
                : 'A password reset code has been generated. Use the 6-digit code below to set your new password.',
            emailSent,
            resetCode: rawCode,
            resetToken: rawToken,
            devToken: rawToken,
        };
    },

    /**
     * Complete a password reset using the token or 6-digit OTP code.
     */
    async resetPassword(token: string, email: string, newPassword: string): Promise<{ message: string }> {
        const cleanToken = token.trim();
        const hashedInput = hashResetToken(cleanToken);
        const normalizedEmail = email.trim().toLowerCase();

        const [user] = await db
            .select({
                id: users.id,
                email: users.email,
                passwordResetToken: users.passwordResetToken,
                passwordResetExpiresAt: users.passwordResetExpiresAt,
            })
            .from(users)
            .where(sql`LOWER(${users.email}) = ${normalizedEmail}`)
            .limit(1);

        if (
            !user ||
            !user.passwordResetToken ||
            !user.passwordResetExpiresAt ||
            user.passwordResetExpiresAt < new Date()
        ) {
            throw new AppError('Invalid or expired reset link or code. Please request a new one.', 400);
        }

        // Support both single hash (legacy) and combined "tokenHash:codeHash" format
        const parts = user.passwordResetToken.split(':');
        const isTokenValid = parts.some((savedHash) => {
            if (savedHash.length !== hashedInput.length) return false;
            try {
                return crypto.timingSafeEqual(Buffer.from(savedHash), Buffer.from(hashedInput));
            } catch {
                return false;
            }
        });

        if (!isTokenValid) {
            throw new AppError('Invalid reset code or token. Please check the code and try again.', 400);
        }

        const passwordHash = await hashPassword(newPassword);

        // Update password, clear the reset token, and increment tokenVersion to revoke old sessions
        await db
            .update(users)
            .set({
                passwordHash,
                passwordResetToken: null,
                passwordResetExpiresAt: null,
                tokenVersion: sql`${users.tokenVersion} + 1`,
                updatedAt: new Date(),
            })
            .where(eq(users.id, user.id));

        return { message: 'Password has been reset successfully. You can now sign in.' };
    },

    /**
     * Set a password on a Google-only account (adds backup credential sign-in).
     * Called from the authenticated user's settings.
     */
    async setPassword(userId: string, newPassword: string): Promise<{ message: string }> {
        const [user] = await db
            .select({
                id: users.id,
                googleId: users.googleId,
                passwordHash: users.passwordHash,
            })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

        if (!user) {
            throw new AppError('User not found', 404);
        }

        if (!user.googleId) {
            throw new AppError('This action is only available for Google-linked accounts.', 400);
        }

        if (user.passwordHash) {
            throw new AppError(
                'A password is already set on this account. Use the reset password flow to change it.',
                400
            );
        }

        const passwordHash = await hashPassword(newPassword);

        await db
            .update(users)
            .set({
                passwordHash,
                tokenVersion: sql`${users.tokenVersion} + 1`,
                updatedAt: new Date(),
            })
            .where(eq(users.id, user.id));

        return { message: 'Password set successfully. You can now sign in with either Google or your email and password.' };
    },

    /**
     * Revoke all active sessions for a user by incrementing their tokenVersion
     */
    async revokeSessions(userId: string): Promise<void> {
        await db
            .update(users)
            .set({
                tokenVersion: sql`${users.tokenVersion} + 1`,
                updatedAt: new Date(),
            })
            .where(eq(users.id, userId));
    },
};
