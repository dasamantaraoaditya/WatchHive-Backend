import { db } from '../db/index.js';
import { users, entries, follows } from '../db/schema.js';
import { eq, or, sql, count } from 'drizzle-orm';
import { hashPassword, comparePassword } from '../utils/bcrypt.util.js';
import {
    generateAccessToken,
    generateRefreshToken,
    verifyRefreshToken,
} from '../utils/jwt.util.js';
import { AppError } from '../middleware/error.middleware.js';
import crypto from 'crypto';
import { resolveAvatarUrl } from '../utils/avatar.util.js';
import { getCanonicalFrontendUrl } from '../utils/url.util.js';
import { emailService } from './email.service.js';
import { emailMatchSql, cleanEmail, getCanonicalEmail } from '../utils/email.util.js';
import { userProfileCache } from '../utils/cache.util.js';

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

export interface RegisterResult {
    requiresVerification: true;
    email: string;
    username: string;
    message: string;
}

export interface AuthUser {
    id: string;
    username: string;
    email: string;
    displayName: string | null;
    bio?: string | null;
    profilePictureUrl: string | null;
    location?: string | null;
    isPrivate?: boolean;
    privacyLevel?: string;
    showWatchEntries?: boolean;
    showCurrentlyWatching?: boolean;
    showWatchlist?: boolean;
    showRankings?: boolean;
    notifyFollowingActivity?: boolean;
    xp?: number;
    level?: number;
    badges?: any;
    watchStreak?: number;
    lastWatchDate?: string | null;
    preferences?: any;
    hasCompletedOnboarding?: boolean;
    hasGoogleLinked: boolean;
    hasAppleLinked: boolean;
    hasPassword: boolean;
    isEmailVerified: boolean;
    entriesCount?: number;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    _count?: {
        entries: number;
        followers: number;
        following: number;
    };
}

export interface AuthResponse {
    user: AuthUser;
    accessToken: string;
    refreshToken: string;
}

/**
 * Fetch complete user profile data with calculated streaks and counts.
 * Returns null if user is not found.
 */
export async function getFullAuthUser(userId: string): Promise<AuthUser | null> {
    const cached = userProfileCache.get(userId);
    if (cached) return cached;

    try {
        const [
            userRows,
            followersRes,
            followingRes
        ] = await Promise.all([
            db
                .select({
                    id: users.id,
                    username: users.username,
                    email: users.email,
                    displayName: users.displayName,
                    bio: users.bio,
                    profilePictureUrl: users.profilePictureUrl,
                    location: users.location,
                    isPrivate: users.isPrivate,
                    privacyLevel: users.privacyLevel,
                    showWatchEntries: users.showWatchEntries,
                    showCurrentlyWatching: users.showCurrentlyWatching,
                    showWatchlist: users.showWatchlist,
                    showRankings: users.showRankings,
                    notifyFollowingActivity: users.notifyFollowingActivity,
                    xp: users.xp,
                    level: users.level,
                    badges: users.badges,
                    watchStreak: users.watchStreak,
                    lastWatchDate: users.lastWatchDate,
                    preferences: users.preferences,
                    hasCompletedOnboarding: users.hasCompletedOnboarding,
                    createdAt: users.createdAt,
                    updatedAt: users.updatedAt,
                    entriesCount: count(entries.id),
                    googleId: users.googleId,
                    appleId: users.appleId,
                    passwordHash: users.passwordHash,
                    isEmailVerified: users.isEmailVerified,
                })
                .from(users)
                .leftJoin(entries, eq(entries.userId, users.id))
                .where(eq(users.id, userId))
                .groupBy(users.id)
                .limit(1),
            db.select({ followersCount: count() }).from(follows).where(eq(follows.followingId, userId)),
            db.select({ followingCount: count() }).from(follows).where(eq(follows.followerId, userId)),
        ]);

        const userResult = userRows[0];
        if (!userResult) return null;

        const todayStr = new Date().toISOString().slice(0, 10);
        const yesterdayStr = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        const isStreakAlive = userResult.lastWatchDate === todayStr || userResult.lastWatchDate === yesterdayStr;
        const activeStreak = isStreakAlive ? (userResult.watchStreak || 0) : 0;

        const followersCount = followersRes[0]?.followersCount ?? 0;
        const followingCount = followingRes[0]?.followingCount ?? 0;

        const { googleId, appleId, passwordHash, ...safeUser } = userResult;

        const fullUser: AuthUser = {
            ...safeUser,
            badges: (userResult.badges as any[]) || [],
            watchStreak: activeStreak,
            hasGoogleLinked: !!googleId,
            hasAppleLinked: Boolean(appleId),
            hasPassword: !!passwordHash,
            profilePictureUrl: resolveAvatarUrl(userResult.profilePictureUrl),
            entriesCount: Number(userResult.entriesCount) || 0,
            _count: {
                entries: Number(userResult.entriesCount) || 0,
                followers: Number(followersCount) || 0,
                following: Number(followingCount) || 0,
            },
        };

        userProfileCache.set(userId, fullUser, 30 * 1000); // 30s in-memory TTL
        return fullUser;
    } catch (err) {
        console.error('[getFullAuthUser] Error fetching user profile details:', err);
        return null;
    }
}

/**
 * Fast lookup of the current active tokenVersion for a user.
 * Cached in memory (30s) to avoid hitting PostgreSQL on every micro-request.
 */
export async function getActiveTokenVersion(userId: string): Promise<number | null> {
    try {
        const cached = tokenVersionCache.get(userId);
        if (cached !== undefined) return cached;

        const [user] = await db
            .select({ tokenVersion: users.tokenVersion })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

        if (!user) return null;
        const version = user.tokenVersion ?? 1;
        tokenVersionCache.set(userId, version, 30 * 1000);
        return version;
    } catch {
        return null;
    }
}

/** Hash a reset token for safe DB storage (SHA-256, not bcrypt — speed matters here) */
function hashResetToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
}

export const authService = {
    async register(data: RegisterData): Promise<RegisterResult> {
        const normalizedEmail = cleanEmail(data.email);
        const cleanUsername = data.username.trim();

        // Check if user already exists
        const [existingUser] = await db
            .select()
            .from(users)
            .where(
                or(
                    emailMatchSql(users.email, normalizedEmail),
                    sql`LOWER(${users.username}) = ${cleanUsername.toLowerCase()}`
                )
            )
            .limit(1);

        if (existingUser) {
            if (getCanonicalEmail(existingUser.email) === getCanonicalEmail(normalizedEmail)) {
                // If already registered AND verified -> prompt user to sign in directly
                if (existingUser.isEmailVerified) {
                    const err = new AppError('This email is already registered. Please sign in.', 409) as any;
                    err.code = 'email_already_registered';
                    throw err;
                }

                // If already registered BUT NOT verified -> resend 6-digit code and direct them to verification screen
                const rawCode = Math.floor(100000 + Math.random() * 900000).toString();
                const rawToken = crypto.randomBytes(32).toString('hex');
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
                    .where(eq(users.id, existingUser.id));

                const frontendUrl = getCanonicalFrontendUrl();
                const verificationLink = `${frontendUrl}/watch-hive/verify-email?token=${rawToken}&email=${encodeURIComponent(existingUser.email)}`;

                emailService.sendVerificationEmail({
                    to: existingUser.email,
                    username: existingUser.username,
                    code: rawCode,
                    verificationLink,
                }).catch((emailErr) => {
                    console.error('[Register] Failed to send verification email in background:', emailErr);
                });

                return {
                    requiresVerification: true,
                    email: existingUser.email,
                    username: existingUser.username,
                    message: 'Account pending verification. A fresh 6-digit verification code has been sent to your email.',
                };
            }
            throw new AppError('Username already taken', 400);
        }

        // Hash password
        const passwordHash = await hashPassword(data.password);

        // Generate verification token and 6-digit OTP code
        const rawToken = crypto.randomBytes(32).toString('hex');
        const rawCode = Math.floor(100000 + Math.random() * 900000).toString();
        const hashedToken = hashResetToken(rawToken);
        const hashedCode = hashResetToken(rawCode);
        const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        // Create unverified user (requires email verification before active session)
        const [user] = await db
            .insert(users)
            .values({
                username: cleanUsername,
                email: normalizedEmail,
                passwordHash,
                displayName: data.displayName || cleanUsername,
                isEmailVerified: false,
                emailVerificationToken: `${hashedToken}:${hashedCode}`,
                emailVerificationExpiresAt: verificationExpiresAt,
            })
            .returning({
                id: users.id,
                username: users.username,
                email: users.email,
            });

        // Dispatch verification email safely in background
        const frontendUrl = getCanonicalFrontendUrl();
        const verificationLink = `${frontendUrl}/watch-hive/verify-email?token=${rawToken}&email=${encodeURIComponent(user.email)}`;

        emailService.sendVerificationEmail({
            to: user.email,
            username: user.username,
            code: rawCode,
            verificationLink,
        }).catch((emailErr) => {
            console.error('[Register] Failed to dispatch verification email in background:', emailErr);
        });

        return {
            requiresVerification: true,
            email: user.email,
            username: user.username,
            message: 'Account created! Please enter the 6-digit verification code sent to your email to complete registration.',
        };
    },

    async login(data: LoginData): Promise<AuthResponse> {
        const identifier = cleanEmail(data.email);

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
                preferences: users.preferences,
                hasCompletedOnboarding: users.hasCompletedOnboarding,
            })
            .from(users)
            .where(
                or(
                    emailMatchSql(users.email, identifier),
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
            const MAX_ATTEMPTS = 3;

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
                    'Account locked due to 3 consecutive failed login attempts. Please try again in 15 minutes or reset your password.',
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
                    `Incorrect email, username, or password. ${remaining} attempt${remaining > 1 ? 's' : ''} remaining before account lockout.`,
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

        // Email Verification Enforcement: Deny login if email is not verified
        if (user.isEmailVerified === false) {
            const err = new AppError(
                'Please verify your email address to log in. Check your inbox for the verification code.',
                403
            ) as any;
            err.code = 'email_not_verified';
            err.email = user.email;
            throw err;
        }

        // Generate tokens
        const accessToken = generateAccessToken({
            userId: user.id,
            email: user.email,
            tokenVersion: user.tokenVersion ?? 1,
            isEmailVerified: true,
        });
        const refreshToken = generateRefreshToken({
            userId: user.id,
            email: user.email,
            tokenVersion: user.tokenVersion ?? 1,
            isEmailVerified: user.isEmailVerified,
        });

        const fullUser = await getFullAuthUser(user.id);
        const resolvedUser: AuthUser = fullUser || {
            id: user.id,
            username: user.username,
            email: user.email,
            displayName: user.displayName,
            profilePictureUrl: resolveAvatarUrl(user.profilePictureUrl),
            hasGoogleLinked: !!user.googleId,
            hasAppleLinked: false,
            hasPassword: true,
            isEmailVerified: user.isEmailVerified,
            preferences: user.preferences,
            hasCompletedOnboarding: user.hasCompletedOnboarding,
        };

        return {
            user: resolvedUser,
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
        const normalizedEmail = cleanEmail(email);
        const [user] = await db
            .select({ id: users.id, email: users.email })
            .from(users)
            .where(emailMatchSql(users.email, normalizedEmail))
            .limit(1);

        // Return explicit 404 if user doesn't exist so user is not misled by false success
        if (!user) {
            throw new AppError('No account found with this email address. Please check your spelling or sign up.', 404);
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
        const frontendUrl = getCanonicalFrontendUrl();
        const resetLink = `${frontendUrl}/watch-hive/reset-password?token=${rawToken}&email=${encodeURIComponent(user.email)}`;

        // Dispatch email via EmailService
        const emailResult = await emailService.sendPasswordResetEmail({
            to: user.email,
            code: rawCode,
            resetLink,
        });

        if (!emailResult.success) {
            console.error(`[ForgotPassword] Failed to deliver reset email to ${user.email}:`, emailResult.error);
            throw new AppError(
                `Failed to deliver password reset email: ${emailResult.error || 'Email service unavailable'}. Please verify SMTP credentials or try again later.`,
                503
            );
        }

        console.log(`[ForgotPassword] Password reset email successfully dispatched to ${user.email} via ${emailResult.provider}.`);

        return {
            message: 'A password reset link and 6-digit code have been sent to your inbox.',
            emailSent: true,
        };
    },

    /**
     * Complete a password reset using the token or 6-digit OTP code.
     */
    async resetPassword(token: string, email: string, newPassword: string): Promise<{ message: string }> {
        const cleanToken = token.trim();
        const hashedInput = hashResetToken(cleanToken);
        const normalizedEmail = cleanEmail(email);

        const [user] = await db
            .select({
                id: users.id,
                email: users.email,
                passwordResetToken: users.passwordResetToken,
                passwordResetExpiresAt: users.passwordResetExpiresAt,
            })
            .from(users)
            .where(emailMatchSql(users.email, normalizedEmail))
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

        invalidateUserCaches(user.id);

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

        invalidateUserCaches(user.id);

        return { message: 'Password set successfully. You can now sign in with either Google or your email and password.' };
    },

    /**
     * Change password for an authenticated user.
     * Verifies current password, updates to new password hash, resets failed attempts,
     * and increments tokenVersion to revoke all other active sessions globally.
     */
    async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<{ message: string; accessToken: string; refreshToken: string }> {
        const [user] = await db
            .select({
                id: users.id,
                email: users.email,
                passwordHash: users.passwordHash,
                tokenVersion: users.tokenVersion,
                isEmailVerified: users.isEmailVerified,
            })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

        if (!user) {
            throw new AppError('User not found', 404);
        }

        if (!user.passwordHash) {
            throw new AppError('This account does not have a password set. Please use the set password option.', 400);
        }

        const isCurrentValid = await comparePassword(currentPassword, user.passwordHash);
        if (!isCurrentValid) {
            throw new AppError('Current password is incorrect.', 400);
        }

        const newHash = await hashPassword(newPassword);
        const nextTokenVersion = (user.tokenVersion ?? 1) + 1;

        await db
            .update(users)
            .set({
                passwordHash: newHash,
                failedLoginAttempts: 0,
                lockoutUntil: null,
                tokenVersion: nextTokenVersion,
                updatedAt: new Date(),
            })
            .where(eq(users.id, user.id));

        invalidateUserCaches(user.id);
        tokenVersionCache.set(user.id, nextTokenVersion, 30 * 1000);

        const accessToken = generateAccessToken({
            userId: user.id,
            email: user.email,
            tokenVersion: nextTokenVersion,
            isEmailVerified: user.isEmailVerified,
        });

        const refreshToken = generateRefreshToken({
            userId: user.id,
            email: user.email,
            tokenVersion: nextTokenVersion,
            isEmailVerified: user.isEmailVerified,
        });

        return {
            message: 'Password changed successfully. All other active sessions have been signed out.',
            accessToken,
            refreshToken,
        };
    },

    /**
     * Verify email with 64-char token or 6-digit OTP code.
     * Activates user account and logs them in immediately with fresh JWT tokens.
     */
    async verifyEmail(token: string, email: string): Promise<AuthResponse> {
        const cleanToken = token.trim();
        const hashedInput = hashResetToken(cleanToken);
        const normalizedEmail = cleanEmail(email);

        const [user] = await db
            .select()
            .from(users)
            .where(emailMatchSql(users.email, normalizedEmail))
            .limit(1);

        if (!user) {
            throw new AppError('User not found', 404);
        }

        // If not verified, validate token or 6-digit code
        if (!user.isEmailVerified) {
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
        }

        // Generate full active session tokens upon successful verification
        const accessToken = generateAccessToken({
            userId: user.id,
            email: user.email,
            tokenVersion: user.tokenVersion ?? 1,
            isEmailVerified: true,
        });

        const refreshToken = generateRefreshToken({
            userId: user.id,
            email: user.email,
            tokenVersion: user.tokenVersion ?? 1,
            isEmailVerified: true,
        });

        const fullUser = await getFullAuthUser(user.id);
        const resolvedUser: AuthUser = fullUser || {
            id: user.id,
            username: user.username,
            email: user.email,
            displayName: user.displayName,
            profilePictureUrl: resolveAvatarUrl(user.profilePictureUrl),
            hasGoogleLinked: !!user.googleId,
            hasAppleLinked: false,
            hasPassword: !!user.passwordHash,
            isEmailVerified: true,
            preferences: user.preferences,
            hasCompletedOnboarding: user.hasCompletedOnboarding,
        };

        return {
            user: resolvedUser,
            accessToken,
            refreshToken,
        };
    },

    /**
     * Resend email verification link and code.
     */
    async resendVerification(email: string): Promise<{ message: string; emailSent: boolean }> {
        const normalizedEmail = cleanEmail(email);
        const [user] = await db
            .select({
                id: users.id,
                username: users.username,
                email: users.email,
                isEmailVerified: users.isEmailVerified,
            })
            .from(users)
            .where(emailMatchSql(users.email, normalizedEmail))
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

        const frontendUrl = getCanonicalFrontendUrl();
        const verificationLink = `${frontendUrl}/watch-hive/verify-email?token=${rawToken}&email=${encodeURIComponent(user.email)}`;

        const emailResult = await emailService.sendVerificationEmail({
            to: user.email,
            username: user.username,
            code: rawCode,
            verificationLink,
        });

        if (!emailResult.success) {
            console.error(`[ResendVerification] Failed to deliver verification email to ${user.email}:`, emailResult.error);
            throw new AppError(
                `Failed to deliver verification email: ${emailResult.error || 'Email service unavailable'}. Please verify SMTP credentials or try again later.`,
                503
            );
        }

        return {
            message: 'A new 6-digit verification code has been sent to your email.',
            emailSent: true,
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

        invalidateUserCaches(userId);
    },

    /**
     * Request a passwordless 6-digit OTP sign-in / registration code.
     * Supports both email address and username lookups.
     * If the account exists -> sends login code.
     * If the account is new -> automatically initializes an account and sends registration code.
     */
    async requestEmailOtp(emailOrUsername: string): Promise<{ message: string; email: string; isNewUser: boolean }> {
        const cleanInput = cleanEmail(emailOrUsername);
        if (!cleanInput) {
            throw new AppError('A valid email address or username is required', 400);
        }

        let existingUser: any = null;
        let normalizedEmail = cleanInput.toLowerCase();

        if (cleanInput.includes('@')) {
            if (!/\S+@\S+\.\S+/.test(cleanInput)) {
                throw new AppError('A valid email address is required', 400);
            }
            [existingUser] = await db
                .select({
                    id: users.id,
                    username: users.username,
                    email: users.email,
                    hasCompletedOnboarding: users.hasCompletedOnboarding,
                })
                .from(users)
                .where(emailMatchSql(users.email, normalizedEmail))
                .limit(1);
        } else {
            // Username lookup
            [existingUser] = await db
                .select({
                    id: users.id,
                    username: users.username,
                    email: users.email,
                    hasCompletedOnboarding: users.hasCompletedOnboarding,
                })
                .from(users)
                .where(sql`LOWER(${users.username}) = ${cleanInput.toLowerCase()}`)
                .limit(1);

            if (!existingUser) {
                throw new AppError('No account found with this username. Please enter a valid email address to sign up.', 404);
            }
            normalizedEmail = existingUser.email.toLowerCase();
        }

        const rawCode = Math.floor(100000 + Math.random() * 900000).toString();
        const hashedCode = hashResetToken(rawCode);
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

        let isNewUser = false;
        let username = '';
        const targetEmail = existingUser ? existingUser.email : normalizedEmail;

        if (existingUser) {
            isNewUser = !existingUser.hasCompletedOnboarding;
            username = existingUser.username;
            await db
                .update(users)
                .set({
                    emailVerificationToken: hashedCode,
                    emailVerificationExpiresAt: expiresAt,
                    updatedAt: new Date(),
                })
                .where(eq(users.id, existingUser.id));
        } else {
            isNewUser = true;
            let baseUsername = targetEmail.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
            if (baseUsername.length < 3) baseUsername = `user_${baseUsername}`;
            let candidateUsername = baseUsername;

            const [taken] = await db
                .select({ id: users.id })
                .from(users)
                .where(sql`LOWER(${users.username}) = ${candidateUsername.toLowerCase()}`)
                .limit(1);

            if (taken) {
                candidateUsername = `${baseUsername}_${Math.floor(1000 + Math.random() * 9000)}`;
            }

            const [newUser] = await db
                .insert(users)
                .values({
                    email: targetEmail,
                    username: candidateUsername,
                    displayName: candidateUsername,
                    isEmailVerified: false,
                    emailVerificationToken: hashedCode,
                    emailVerificationExpiresAt: expiresAt,
                    hasCompletedOnboarding: false,
                })
                .returning({ id: users.id, username: users.username });

            username = newUser.username;
        }

        // Send OTP email in background
        emailService.sendLoginOtpEmail({
            to: targetEmail,
            code: rawCode,
            isNewUser,
            username,
        }).catch((err) => {
            console.error('[requestEmailOtp] Failed to send login OTP email in background:', err);
        });

        return {
            message: `A 6-digit sign-in code has been sent to ${targetEmail}.`,
            email: targetEmail,
            isNewUser,
        };
    },

    /**
     * Verify the 6-digit OTP code and log the user in immediately.
     */
    async verifyEmailOtp(emailOrUsername: string, code: string): Promise<AuthResponse & { isNewUser: boolean }> {
        const cleanInput = cleanEmail(emailOrUsername);
        const cleanCode = code.trim();

        if (!cleanCode || cleanCode.length < 6) {
            throw new AppError('Please enter a valid 6-digit sign-in code.', 400);
        }

        const hashedInput = hashResetToken(cleanCode);

        let user: any = null;
        if (cleanInput.includes('@')) {
            [user] = await db
                .select()
                .from(users)
                .where(emailMatchSql(users.email, cleanInput))
                .limit(1);
        } else {
            [user] = await db
                .select()
                .from(users)
                .where(sql`LOWER(${users.username}) = ${cleanInput.toLowerCase()}`)
                .limit(1);
        }

        if (
            !user ||
            !user.emailVerificationToken ||
            !user.emailVerificationExpiresAt ||
            user.emailVerificationExpiresAt < new Date()
        ) {
            throw new AppError('The sign-in code has expired or is invalid. Please request a new code.', 400);
        }

        // Support both single hash and legacy "token:code" format
        const parts = (user.emailVerificationToken as string).split(':');
        const isCodeValid = parts.some((savedHash: string) => {
            if (savedHash.length !== hashedInput.length) return false;
            try {
                return crypto.timingSafeEqual(Buffer.from(savedHash), Buffer.from(hashedInput));
            } catch {
                return false;
            }
        });

        if (!isCodeValid) {
            throw new AppError('Incorrect sign-in code. Please check your email and try again.', 400);
        }

        // Activate user and clear OTP tokens
        await db
            .update(users)
            .set({
                isEmailVerified: true,
                emailVerificationToken: null,
                emailVerificationExpiresAt: null,
                failedLoginAttempts: 0,
                lockoutUntil: null,
                tokenVersion: sql`${users.tokenVersion} + 1`,
                updatedAt: new Date(),
            })
            .where(eq(users.id, user.id));

        const nextTokenVersion = (user.tokenVersion ?? 1) + 1;

        const accessToken = generateAccessToken({
            userId: user.id,
            email: user.email,
            tokenVersion: nextTokenVersion,
            isEmailVerified: true,
        });

        const refreshToken = generateRefreshToken({
            userId: user.id,
            email: user.email,
            tokenVersion: nextTokenVersion,
            isEmailVerified: true,
        });

        const fullUser = await getFullAuthUser(user.id);
        const resolvedUser: AuthUser = fullUser || {
            id: user.id,
            username: user.username,
            email: user.email,
            displayName: user.displayName,
            profilePictureUrl: resolveAvatarUrl(user.profilePictureUrl),
            hasGoogleLinked: !!user.googleId,
            hasAppleLinked: false,
            hasPassword: false,
            isEmailVerified: true,
            preferences: user.preferences,
            hasCompletedOnboarding: user.hasCompletedOnboarding,
        };

        return {
            user: resolvedUser,
            accessToken,
            refreshToken,
            isNewUser: !user.hasCompletedOnboarding,
        };
    },
};
