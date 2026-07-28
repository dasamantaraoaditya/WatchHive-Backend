import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq, or } from 'drizzle-orm';
import { hashPassword, comparePassword } from '../utils/bcrypt.util.js';
import {
    generateAccessToken,
    generateRefreshToken,
    verifyRefreshToken,
} from '../utils/jwt.util.js';
import { AppError } from '../middleware/error.middleware.js';
import crypto from 'crypto';
import { config } from '../config.js';

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
            });

        // Generate tokens
        const accessToken = generateAccessToken({
            userId: user.id,
            email: user.email,
        });
        const refreshToken = generateRefreshToken({
            userId: user.id,
            email: user.email,
        });

        return {
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                displayName: user.displayName,
                profilePictureUrl: user.profilePictureUrl,
                hasGoogleLinked: !!user.googleId,
                hasPassword: !!user.passwordHash,
            },
            accessToken,
            refreshToken,
        };
    },

    async login(data: LoginData): Promise<AuthResponse> {
        // Find user
        const [user] = await db
            .select({
                id: users.id,
                username: users.username,
                email: users.email,
                displayName: users.displayName,
                profilePictureUrl: users.profilePictureUrl,
                passwordHash: users.passwordHash,
                googleId: users.googleId,
            })
            .from(users)
            .where(eq(users.email, data.email))
            .limit(1);

        if (!user) {
            throw new AppError('Invalid email or password', 401);
        }

        // If user has no password (Google-only account), return a structured error
        // so the frontend can show an actionable recovery UI instead of a dead-end.
        if (!user.passwordHash) {
            const err = new AppError(
                'This account was created with Google Sign-In. Please use Google to sign in, or use "Forgot password?" to set a password.',
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
            throw new AppError('Invalid email or password', 401);
        }

        // Generate tokens
        const accessToken = generateAccessToken({
            userId: user.id,
            email: user.email,
        });
        const refreshToken = generateRefreshToken({
            userId: user.id,
            email: user.email,
        });

        return {
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                displayName: user.displayName,
                profilePictureUrl: user.profilePictureUrl,
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

            // Generate new tokens
            const accessToken = generateAccessToken({
                userId: user.id,
                email: user.email,
            });
            const refreshToken = generateRefreshToken({
                userId: user.id,
                email: user.email,
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
     * Always returns success to prevent email enumeration attacks.
     * In dev mode, logs the raw token to console.
     */
    async forgotPassword(email: string): Promise<{ message: string; devToken?: string }> {
        const [user] = await db
            .select({ id: users.id, email: users.email })
            .from(users)
            .where(eq(users.email, email))
            .limit(1);

        // Always return success regardless of whether user exists (security)
        if (!user) {
            return { message: 'If that email is registered, a reset link has been sent.' };
        }

        // Generate a secure random token
        const rawToken = crypto.randomBytes(32).toString('hex');
        const hashedToken = hashResetToken(rawToken);
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

        // Store hashed token + expiry
        await db
            .update(users)
            .set({
                passwordResetToken: hashedToken,
                passwordResetExpiresAt: expiresAt,
            })
            .where(eq(users.id, user.id));

        // The reset link
        const frontendUrl = config.cors.origin.split(',')[0].trim() || 'http://localhost:3000';
        const resetLink = `${frontendUrl}/watch-hive/reset-password?token=${rawToken}&email=${encodeURIComponent(email)}`;

        // Send email via SendGrid if API key is configured
        if (config.email.sendgridApiKey) {
            try {
                await fetch('https://api.sendgrid.com/v3/mail/send', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${config.email.sendgridApiKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        personalizations: [{ to: [{ email }] }],
                        from: { email: config.email.from, name: 'WatchHive' },
                        subject: 'Reset Your WatchHive Password',
                        content: [{
                            type: 'text/html',
                            value: `<p>Hello,</p><p>Click the link below to reset your WatchHive password. This link is valid for 1 hour:</p><p><a href="${resetLink}">${resetLink}</a></p><p>If you did not request this, please ignore this email.</p>`,
                        }],
                    }),
                });
            } catch (emailErr) {
                console.error('Failed to send password reset email via SendGrid:', emailErr);
            }
        }

        if (config.nodeEnv === 'development') {
            console.log('\n=== PASSWORD RESET (DEV MODE) ===');
            console.log(`Reset link for ${email}:`);
            console.log(resetLink);
            console.log('=================================\n');
            return {
                message: 'If that email is registered, a reset link has been sent.',
                devToken: rawToken, // Only returned in dev for easy testing
            };
        }

        return { message: 'If that email is registered, a reset link has been sent.' };
    },

    /**
     * Complete a password reset using the token from the reset email.
     */
    async resetPassword(token: string, email: string, newPassword: string): Promise<{ message: string }> {
        const hashedToken = hashResetToken(token);

        const [user] = await db
            .select({
                id: users.id,
                email: users.email,
                passwordResetToken: users.passwordResetToken,
                passwordResetExpiresAt: users.passwordResetExpiresAt,
            })
            .from(users)
            .where(eq(users.email, email))
            .limit(1);

        if (
            !user ||
            !user.passwordResetToken ||
            !user.passwordResetExpiresAt ||
            user.passwordResetToken !== hashedToken ||
            user.passwordResetExpiresAt < new Date()
        ) {
            throw new AppError('Invalid or expired reset link. Please request a new one.', 400);
        }

        const passwordHash = await hashPassword(newPassword);

        // Update password and clear the reset token
        await db
            .update(users)
            .set({
                passwordHash,
                passwordResetToken: null,
                passwordResetExpiresAt: null,
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
                updatedAt: new Date(),
            })
            .where(eq(users.id, user.id));

        return { message: 'Password set successfully. You can now sign in with either Google or your email and password.' };
    },
};
