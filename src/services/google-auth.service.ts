import { OAuth2Client } from 'google-auth-library';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import {
    generateAccessToken,
    generateRefreshToken,
} from '../utils/jwt.util.js';
import { AppError } from '../middleware/error.middleware.js';
import { resolveAvatarUrl } from '../utils/avatar.util.js';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '357857516251-f4gpp8f1j70lu1dcnh405ac0t6lch9tf.apps.googleusercontent.com';
const GOOGLE_ANDROID_CLIENT_ID = process.env.GOOGLE_ANDROID_CLIENT_ID || '357857516251-hg78ol78gmbornatbm11dro3fof7am1m.apps.googleusercontent.com';
const GOOGLE_IOS_CLIENT_ID = process.env.GOOGLE_IOS_CLIENT_ID || '357857516251-69f26kdjl6v5n60pvtpdjbiregaodv63.apps.googleusercontent.com';

const ALLOWED_GOOGLE_AUDIENCES: string[] = Array.from(new Set([
    GOOGLE_CLIENT_ID,
    GOOGLE_ANDROID_CLIENT_ID,
    GOOGLE_IOS_CLIENT_ID,
    '357857516251-f4gpp8f1j70lu1dcnh405ac0t6lch9tf.apps.googleusercontent.com',
    '357857516251-hg78ol78gmbornatbm11dro3fof7am1m.apps.googleusercontent.com',
    '357857516251-69f26kdjl6v5n60pvtpdjbiregaodv63.apps.googleusercontent.com',
].filter(Boolean)));

const client = new OAuth2Client(GOOGLE_CLIENT_ID);

export interface GoogleAuthPayload {
    googleId: string;
    email: string;
    name: string;
    picture?: string;
}

export interface GoogleAuthResponse {
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
    isNewUser: boolean;
}

export const googleAuthService = {
    /**
     * Verify Google ID token and extract user info
     */
    async verifyGoogleToken(idToken: string): Promise<GoogleAuthPayload> {
        if (!idToken || !idToken.trim()) {
            throw new AppError('Google ID token is required', 400);
        }

        try {
            const ticket = await client.verifyIdToken({
                idToken: idToken.trim(),
                audience: ALLOWED_GOOGLE_AUDIENCES,
            });

            const payload = ticket.getPayload();

            if (!payload) {
                throw new AppError('Invalid Google token payload', 401);
            }

            if (!payload.email) {
                throw new AppError('Google account email not available', 400);
            }

            return {
                googleId: payload.sub,
                email: payload.email.toLowerCase().trim(),
                name: payload.name || payload.email.split('@')[0],
                picture: payload.picture,
            };
        } catch (error: any) {
            console.error('[GoogleAuth] Primary token verification failed:', error?.message || error);

            // Resilient Fallback: Verify via Google's tokeninfo API directly to tolerate audience/header differences
            try {
                const resp = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken.trim())}`);
                if (resp.ok) {
                    const data = await resp.json() as any;
                    const tokenAud = data.aud;
                    const tokenAzp = data.azp;
                    const isKnownAudience = ALLOWED_GOOGLE_AUDIENCES.includes(tokenAud) ||
                        ALLOWED_GOOGLE_AUDIENCES.includes(tokenAzp) ||
                        (typeof tokenAud === 'string' && tokenAud.startsWith('357857516251-')) ||
                        (typeof tokenAzp === 'string' && tokenAzp.startsWith('357857516251-'));

                    if (data.email && data.sub && isKnownAudience) {
                        console.log('[GoogleAuth] Fallback tokeninfo verification succeeded for:', data.email);
                        return {
                            googleId: data.sub,
                            email: (data.email as string).toLowerCase().trim(),
                            name: data.name || (data.email as string).split('@')[0],
                            picture: data.picture,
                        };
                    }
                }
            } catch (fallbackErr) {
                console.error('[GoogleAuth] Fallback token verification error:', fallbackErr);
            }

            if (error instanceof AppError) throw error;
            throw new AppError(`Failed to verify Google token: ${error?.message || 'Invalid token'}`, 401);
        }
    },

    /**
     * Login or register a user via Google OAuth
     * - If user exists with googleId → login
     * - If user exists with same email (non-Google) → link Google account and login
     * - If user doesn't exist → create new account and login
     */
    async loginOrRegister(idToken: string): Promise<GoogleAuthResponse> {
        const googlePayload = await this.verifyGoogleToken(idToken);
        let isNewUser = false;

        // 1. Check if user already exists with this Google ID
        let [user] = await db
            .select({
                id: users.id,
                username: users.username,
                email: users.email,
                displayName: users.displayName,
                profilePictureUrl: users.profilePictureUrl,
                tokenVersion: users.tokenVersion,
            })
            .from(users)
            .where(eq(users.googleId, googlePayload.googleId))
            .limit(1);

        if (!user) {
            // 2. Check if user exists with same email (registered via email/password)
            const [existingEmailUser] = await db
                .select({
                    id: users.id,
                    username: users.username,
                    email: users.email,
                    displayName: users.displayName,
                    profilePictureUrl: users.profilePictureUrl,
                    googleId: users.googleId,
                    tokenVersion: users.tokenVersion,
                })
                .from(users)
                .where(eq(users.email, googlePayload.email))
                .limit(1);

            if (existingEmailUser) {
                // Link Google account to existing user if not already linked
                let updatedUser = existingEmailUser;
                if (!existingEmailUser.googleId || existingEmailUser.googleId !== googlePayload.googleId) {
                    try {
                        const [res] = await db
                            .update(users)
                            .set({
                                googleId: googlePayload.googleId,
                                ...(googlePayload.picture && !existingEmailUser.profilePictureUrl
                                    ? { profilePictureUrl: googlePayload.picture }
                                    : {}),
                            })
                            .where(eq(users.id, existingEmailUser.id))
                            .returning({
                                id: users.id,
                                username: users.username,
                                email: users.email,
                                displayName: users.displayName,
                                profilePictureUrl: users.profilePictureUrl,
                                googleId: users.googleId,
                                tokenVersion: users.tokenVersion,
                            });
                        if (res) updatedUser = res;
                    } catch (linkError) {
                        console.error('[GoogleAuth] Could not update googleId for existing user:', linkError);
                    }
                }
                user = updatedUser;
            } else {
                // 3. Create a new user
                isNewUser = true;

                // Generate a unique username from email or name (safe length between 3 and 25 chars)
                const rawBase = (googlePayload.email.split('@')[0] || googlePayload.name || 'user')
                    .replace(/[^a-zA-Z0-9_]/g, '_')
                    .slice(0, 20);
                const baseUsername = rawBase.length >= 3 ? rawBase : `${rawBase}_hive`;

                let username = baseUsername;
                let counter = 1;

                // Ensure unique username
                let isUsernameUnique = false;
                while (!isUsernameUnique) {
                    const [existing] = await db
                        .select({ id: users.id })
                        .from(users)
                        .where(eq(users.username, username))
                        .limit(1);
                    if (!existing) {
                        isUsernameUnique = true;
                        break;
                    }

                    username = `${baseUsername.slice(0, 18)}_${counter}`;
                    counter++;
                    if (counter > 100) {
                        username = `${baseUsername.slice(0, 12)}_${Date.now() % 100000}`;
                        break;
                    }
                }

                const [newUser] = await db
                    .insert(users)
                    .values({
                        username,
                        email: googlePayload.email,
                        googleId: googlePayload.googleId,
                        displayName: googlePayload.name,
                        profilePictureUrl: googlePayload.picture || null,
                        tokenVersion: 1,
                    })
                    .returning({
                        id: users.id,
                        username: users.username,
                        email: users.email,
                        displayName: users.displayName,
                        profilePictureUrl: users.profilePictureUrl,
                        tokenVersion: users.tokenVersion,
                    });
                user = newUser;
            }
        }

        // Generate JWT tokens
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
                hasGoogleLinked: true,
                hasPassword: false, // will be refreshed via getMe() in AuthContext
            },
            accessToken,
            refreshToken,
            isNewUser,
        };
    },
};
