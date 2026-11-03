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
import { emailService } from './email.service.js';

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
        isEmailVerified: boolean;
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

        // Generate verification token and code
        const rawToken = crypto.randomBytes(32).toString('hex');
        const rawCode = Math.floor(100000 + Math.random() * 900000).toString();
        const hashedToken = hashResetToken(rawToken);
        const hashedCode = hashResetToken(rawCode);
        const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        // Create user
        const [user] = await db
            .insert(users)
            .values({
                username: data.username,
                email: data.email,
                passwordHash,
                displayName: data.displayName || data.username,
                isEmailVerified: false,
                emailVerificationToken: `${hashedToken}:${hashedCode}`,
                emailVerificationExpiresAt: verificationExpiresAt,
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
                isEmailVerified: users.isEmailVerified,
            });

        // Generate tokens
        const accessToken = generateAccessToken({
            userId: user.id,
            email: user.email,
            tokenVersion: user.tokenVersion ?? 1,
            isEmailVerified: false,
        });
        const refreshToken = generateRefreshToken({
            userId: user.id,
            email: user.email,
            tokenVersion: user.tokenVersion ?? 1,
            isEmailVerified: false,
        });

        // Dispatch verification email safely in background
        const frontendUrl = config.cors.origin.split(',')[0].trim() || 'http://localhost:3000';
        const verificationLink = `${frontendUrl}/watch-hive/verify-email?token=${rawToken}&email=${encodeURIComponent(user.email)}`;

        try {
            await emailService.sendVerificationEmail({
                to: user.email,
                username: user.username,
                code: rawCode,
                verificationLink,
            });
        } catch (emailErr) {
            console.error('[Register] Failed to send verification email:', emailErr);
        }

        return {
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                displayName: user.displayName,
                profilePictureUrl: resolveAvatarUrl(user.profilePictureUrl),
                hasGoogleLinked: !!user.googleId,
                hasPassword: !!user.passwordHash,
                isEmailVerified: false,
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
                isEmailVerified: users.isEmailVerified,
                failedLoginAttempts: users.failedLoginAttempts,
                lockoutUntil: users.lockoutUntil,
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

        // Check for active lockout
        const now = new Date();
        if (user.lockoutUntil && user.lockoutUntil > now) {
            const minutesLeft = Math.ceil((user.lockoutUntil.getTime() - now.getTime()) / (60 * 1000));
            const lockoutErr = new AppError(
                `Account temporarily locked due to consecutive failed login attempts. Please try again in ${minutesLeft} minute${minutesLeft > 1 ? 's' : ''} or reset your password.`,
                423
            ) as any;
            lockoutErr.code = 'account_locked';
            lockoutErr.lockoutUntil = user.lockoutUntil;
            throw lockoutErr;
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
            const currentAttempts = (user.failedLoginAttempts || 0) + 1;
            const MAX_ATTEMPTS = 5;

            if (currentAttempts >= MAX_ATTEMPTS) {
                const lockoutUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
                await db
                    .update(users)
                    .set({
                        failedLoginAttempts: currentAttempts,
                        lockoutUntil,
                        updatedAt: new Date(),
                    })
                    .where(eq(users.id, user.id));

                const err = new AppError(
                    'Account locked due to 5 consecutive failed login attempts. Please try again in 15 minutes or reset your password.',
                    423
                ) as any;
                err.code = 'account_locked';
                err.lockoutUntil = lockoutUntil;
                throw err;
            } else {
                await db
                    .update(users)
                    .set({
                        failedLoginAttempts: currentAttempts,
                        updatedAt: new Date(),
                    })
                    .where(eq(users.id, user.id));

                const remaining = MAX_ATTEMPTS - currentAttempts;
                throw new AppError(
                    `Incorrect email, username, or password. ${remaining} attempt${remaining > 1 ? 's' : ''} remaining before temporary lockout.`,
                    401
                );
            }
        }

        // Reset failed login attempts and lockout upon successful login
        if (user.failedLoginAttempts > 0 || user.lockoutUntil) {
            await db
                .update(users)
                .set({
                    failedLoginAttempts: 0,
                    lockoutUntil: null,
                    updatedAt: new Date(),
                })
                .where(eq(users.id, user.id));
        }

        // Generate tokens
        const accessToken = generateAccessToken({
            userId: user.id,
            email: user.email,
            tokenVersion: user.tokenVersion ?? 1,
            isEmailVerified: user.isEmailVerified,
        });
        const refreshToken = generateRefreshToken({
            userId: user.id,
            email: user.email,
            tokenVersion: user.tokenVersion ?? 1,
            isEmailVerified: user.isEmailVerified,
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
                isEmailVerified: user.isEmailVerified,
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
     * Sends the verification email securely via configured EmailService (Resend, SendGrid, or SMTP).
     * NEVER returns raw codes or tokens in the HTTP response to prevent account takeover vulnerabilities.
     */
    async forgotPassword(email: string): Promise<{
        message: string;
        emailSent: boolean;
    }> {
        const normalizedEmail = email.trim().toLowerCase();
        const [user] = await db
            .select({ id: users.id, email: users.email })
            .from(users)
            .where(sql`LOWER(${users.email}) = ${normalizedEmail}`)
            .limit(1);

        // Always return success message if user doesn't exist (prevent email enumeration)
        if (!user) {
            return {
                message: 'If that email is registered, a password reset link and code have been sent to your inbox.',
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

        // Dispatch email via EmailService
        const emailResult = await emailService.sendPasswordResetEmail({
            to: user.email,
            code: rawCode,
            resetLink,
        });

        if (!emailResult.success) {
            console.error(`[ForgotPassword] Failed to deliver reset email to ${user.email}:`, emailResult.error);
        } else {
            console.log(`[ForgotPassword] Password reset email successfully dispatched to ${user.email} via ${emailResult.provider}.`);
        }

        return {
            message: 'If that email is registered, a password reset link and code have been sent to your inbox.',
            emailSent: emailResult.success,
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

        // Update password, clear the reset token, reset failed attempts & lockout, and increment tokenVersion to revoke old sessions
        await db
            .update(users)
            .set({
                passwordHash,
                passwordResetToken: null,
                passwordResetExpiresAt: null,
                failedLoginAttempts: 0,
                lockoutUntil: null,
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
                failedLoginAttempts: 0,
                lockoutUntil: null,
                tokenVersion: sql`${users.tokenVersion} + 1`,
                updatedAt: new Date(),
            })
            .where(eq(users.id, user.id));

        return { message: 'Password set successfully. You can now sign in with either Google or your email and password.' };
    },

    /**
     * Verify email with 64-char token or 6-digit OTP code.
     */
    async verifyEmail(token: string, email: string): Promise<{ message: string; isEmailVerified: boolean }> {
        const cleanToken = token.trim();
        const hashedInput = hashResetToken(cleanToken);
        const normalizedEmail = email.trim().toLowerCase();

        const [user] = await db
            .select({
                id: users.id,
                email: users.email,
                isEmailVerified: users.isEmailVerified,
                emailVerificationToken: users.emailVerificationToken,
                emailVerificationExpiresAt: users.emailVerificationExpiresAt,
            })
            .from(users)
            .where(sql`LOWER(${users.email}) = ${normalizedEmail}`)
            .limit(1);

        if (!user) {
            throw new AppError('User not found', 404);
        }

        if (user.isEmailVerified) {
            return { message: 'Email address is already verified.', isEmailVerified: true };
        }

        if (
            !user.emailVerificationToken ||
            !user.emailVerificationExpiresAt ||
            user.emailVerificationExpiresAt < new Date()
        ) {
            throw new AppError('Verification link or code has expired. Please request a new one.', 400);
        }

        const parts = user.emailVerificationToken.split(':');
        const isTokenValid = parts.some((savedHash) => {
            if (savedHash.length !== hashedInput.length) return false;
            try {
                return crypto.timingSafeEqual(Buffer.from(savedHash), Buffer.from(hashedInput));
            } catch {
                return false;
            }
        });

        if (!isTokenValid) {
            throw new AppError('Invalid verification code or link. Please check and try again.', 400);
        }

        await db
            .update(users)
            .set({
                isEmailVerified: true,
                emailVerificationToken: null,
                emailVerificationExpiresAt: null,
                updatedAt: new Date(),
            })
            .where(eq(users.id, user.id));

        return { message: 'Email address verified successfully!', isEmailVerified: true };
    },

    /**
     * Resend email verification link and code.
     */
    async resendVerification(email: string): Promise<{ message: string; emailSent: boolean }> {
        const normalizedEmail = email.trim().toLowerCase();
        const [user] = await db
            .select({
                id: users.id,
                username: users.username,
                email: users.email,
                isEmailVerified: users.isEmailVerified,
            })
            .from(users)
            .where(sql`LOWER(${users.email}) = ${normalizedEmail}`)
            .limit(1);

        // Always return success response to prevent email enumeration
        if (!user) {
            return {
                message: 'If the email address is registered, a new verification link has been sent.',
                emailSent: false,
            };
        }

        if (user.isEmailVerified) {
            return {
                message: 'Email address is already verified.',
                emailSent: false,
            };
        }

        const rawToken = crypto.randomBytes(32).toString('hex');
        const rawCode = Math.floor(100000 + Math.random() * 900000).toString();
        const hashedToken = hashResetToken(rawToken);
        const hashedCode = hashResetToken(rawCode);
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        await db
            .update(users)
            .set({
                emailVerificationToken: `${hashedToken}:${hashedCode}`,
                emailVerificationExpiresAt: expiresAt,
                updatedAt: new Date(),
            })
            .where(eq(users.id, user.id));

        const frontendUrl = config.cors.origin.split(',')[0].trim() || 'http://localhost:3000';
        const verificationLink = `${frontendUrl}/watch-hive/verify-email?token=${rawToken}&email=${encodeURIComponent(user.email)}`;

        const emailResult = await emailService.sendVerificationEmail({
            to: user.email,
            username: user.username,
            code: rawCode,
            verificationLink,
        });

        return {
            message: 'If the email address is registered, a new verification link has been sent.',
            emailSent: emailResult.success,
        };
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
