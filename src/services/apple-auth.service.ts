import jwt from 'jsonwebtoken';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { generateAccessToken, generateRefreshToken } from '../utils/jwt.util.js';
import { AppError } from '../middleware/error.middleware.js';
import { resolveAvatarUrl } from '../utils/avatar.util.js';

export interface AppleAuthRequest {
    identityToken: string;
    userIdentifier: string; // Apple 'sub'
    email?: string;
    givenName?: string;
    familyName?: string;
}

export interface AppleAuthResponse {
    user: {
        id: string;
        username: string;
        email: string;
        displayName: string | null;
        profilePictureUrl: string | null;
        hasGoogleLinked: boolean;
        hasAppleLinked: boolean;
        hasPassword: boolean;
    };
    accessToken: string;
    refreshToken: string;
    isNewUser: boolean;
}

export const appleAuthService = {
    /**
     * Decode and validate Apple identity token payload
     */
    decodeAppleToken(identityToken: string): { sub: string; email?: string; email_verified?: boolean | string } {
        try {
            const decoded = jwt.decode(identityToken) as any;
            if (!decoded || !decoded.sub) {
                throw new AppError('Invalid Apple identity token: missing subject (sub)', 401);
            }
            return {
                sub: decoded.sub,
                email: decoded.email,
                email_verified: decoded.email_verified,
            };
        } catch (error: any) {
            console.error('[AppleAuth] Token decoding failed:', error);
            if (error instanceof AppError) throw error;
            throw new AppError('Failed to parse Apple identity token', 401);
        }
    },

    /**
     * Login or register a user via Apple Sign-In
     */
    async loginOrRegister(payload: AppleAuthRequest): Promise<AppleAuthResponse> {
        const { identityToken, userIdentifier, email: clientEmail, givenName, familyName } = payload;

        // Verify token structure and extract sub & email
        const tokenData = this.decodeAppleToken(identityToken);
        const appleSub = userIdentifier || tokenData.sub;
        const effectiveEmail = (tokenData.email || clientEmail || '').trim().toLowerCase();

        let isNewUser = false;

        // 1. Look for existing user with this appleId
        let [user] = await db
            .select({
                id: users.id,
                username: users.username,
                email: users.email,
                displayName: users.displayName,
                profilePictureUrl: users.profilePictureUrl,
                googleId: users.googleId,
                appleId: users.appleId,
                passwordHash: users.passwordHash,
                tokenVersion: users.tokenVersion,
            })
            .from(users)
            .where(eq(users.appleId, appleSub))
            .limit(1);

        if (!user && effectiveEmail) {
            // 2. Look for existing user with same email (link Apple to existing account)
            const [existingEmailUser] = await db
                .select({
                    id: users.id,
                    username: users.username,
                    email: users.email,
                    displayName: users.displayName,
                    profilePictureUrl: users.profilePictureUrl,
                    googleId: users.googleId,
                    appleId: users.appleId,
                    passwordHash: users.passwordHash,
                    tokenVersion: users.tokenVersion,
                })
                .from(users)
                .where(eq(users.email, effectiveEmail))
                .limit(1);

            if (existingEmailUser) {
                // Link appleId to existing account
                const [updatedUser] = await db
                    .update(users)
                    .set({
                        appleId: appleSub,
                        updatedAt: new Date(),
                    })
                    .where(eq(users.id, existingEmailUser.id))
                    .returning({
                        id: users.id,
                        username: users.username,
                        email: users.email,
                        displayName: users.displayName,
                        profilePictureUrl: users.profilePictureUrl,
                        googleId: users.googleId,
                        appleId: users.appleId,
                        passwordHash: users.passwordHash,
                        tokenVersion: users.tokenVersion,
                    });

                user = updatedUser;
                console.log(`[AppleAuth] Linked Apple account ${appleSub} to existing user ${user.id}`);
            }
        }

        if (!user) {
            // 3. New user registration
            isNewUser = true;

            const nameParts = [givenName, familyName].filter(Boolean);
            const displayName = nameParts.length > 0 ? nameParts.join(' ') : 'Apple Watcher';

            // Generate a clean unique username
            const emailPrefix = effectiveEmail ? effectiveEmail.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '') : 'watcher';
            let candidateUsername = (emailPrefix || 'watcher').substring(0, 15);
            if (candidateUsername.length < 3) candidateUsername = 'watcher';

            let uniqueUsername = candidateUsername;
            let counter = 1;
            let isUnique = false;
            while (!isUnique) {
                const [existing] = await db
                    .select({ id: users.id })
                    .from(users)
                    .where(eq(users.username, uniqueUsername))
                    .limit(1);

                if (!existing) {
                    isUnique = true;
                } else {
                    uniqueUsername = `${candidateUsername}${counter++}`;
                }
            }

            const registrationEmail = effectiveEmail || `${appleSub.substring(0, 12)}@privaterelay.appleid.com`;

            const [newUser] = await db
                .insert(users)
                .values({
                    username: uniqueUsername,
                    email: registrationEmail,
                    appleId: appleSub,
                    displayName,
                    profilePictureUrl: null,
                    isPrivate: false,
                    privacyLevel: 'PUBLIC',
                })
                .returning({
                    id: users.id,
                    username: users.username,
                    email: users.email,
                    displayName: users.displayName,
                    profilePictureUrl: users.profilePictureUrl,
                    googleId: users.googleId,
                    appleId: users.appleId,
                    passwordHash: users.passwordHash,
                    tokenVersion: users.tokenVersion,
                });

            user = newUser;
            console.log(`[AppleAuth] Registered new user ${user.id} (${user.username}) via Sign in with Apple`);
        }

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
                hasGoogleLinked: Boolean(user.googleId),
                hasAppleLinked: Boolean(user.appleId),
                hasPassword: Boolean(user.passwordHash),
            },
            accessToken,
            refreshToken,
            isNewUser,
        };
    },
};
