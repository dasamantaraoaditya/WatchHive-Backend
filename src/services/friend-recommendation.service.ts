import { db } from '../db/index.js';
import { users, follows, followRequests, entries, blockedUsers } from '../db/schema.js';
import { eq, and, or, inArray, notInArray, desc, count, sql } from 'drizzle-orm';
import { resolveAvatarUrl } from '../utils/avatar.util.js';

export interface SuggestedUserResult {
    id: string;
    username: string;
    displayName: string | null;
    profilePictureUrl: string | null;
    bio: string | null;
    isPrivate: boolean;
    privacyLevel: string;
    isFollowing: boolean;
    isRequested: boolean;
    suggestionReason: string;
    mutualFriendsCount: number;
}

interface CandidateScoring {
    userId: string;
    score: number;
    reason: string;
    mutualCount: number;
}

export const friendRecommendationService = {
    /**
     * Get smart, relevant friend suggestions:
     * 1. Inbound followers (users who follow you)
     * 2. Friends of friends (2nd-degree connections with mutual friend counts)
     * 3. Shared movie/watch taste (users who logged the same movies/shows)
     * 4. Cold-start fallback for new users (top active cinephiles, shared genre preferences)
     */
    async getSuggestedUsers(currentId: string, limit: number = 20): Promise<SuggestedUserResult[]> {
        // Step 1: Collect exclusions (self, already followed, pending follow requests, blocked)
        const [followedRows, pendingRows, blockedRows] = await Promise.all([
            db.select({ followingId: follows.followingId })
                .from(follows)
                .where(eq(follows.followerId, currentId)),
            db.select({ recipientId: followRequests.recipientId })
                .from(followRequests)
                .where(and(eq(followRequests.senderId, currentId), eq(followRequests.status, 'pending'))),
            db.select({ blockerId: blockedUsers.blockerId, blockedId: blockedUsers.blockedId })
                .from(blockedUsers)
                .where(or(eq(blockedUsers.blockerId, currentId), eq(blockedUsers.blockedId, currentId))),
        ]);

        const followedIds = new Set(followedRows.map((r) => r.followingId));
        const pendingIds = new Set(pendingRows.map((r) => r.recipientId));
        const blockedIds = new Set(blockedRows.flatMap((r) => [r.blockerId, r.blockedId]));

        const excludeSet = new Set<string>([
            currentId,
            ...followedIds,
            ...pendingIds,
            ...blockedIds,
        ]);

        const candidateMap = new Map<string, CandidateScoring>();

        // Step 2: Inbound Followers (People who already follow the current user)
        const inboundFollowers = await db
            .select({ followerId: follows.followerId })
            .from(follows)
            .where(eq(follows.followingId, currentId));

        for (const { followerId } of inboundFollowers) {
            if (!excludeSet.has(followerId)) {
                candidateMap.set(followerId, {
                    userId: followerId,
                    score: 100,
                    reason: 'Follows you',
                    mutualCount: 0,
                });
            }
        }

        // Step 3: Friends of Friends (Mutual Connections / 2nd-degree network)
        if (followedIds.size > 0) {
            const followedIdsArray = Array.from(followedIds);
            const friendsOfFriends = await db
                .select({
                    candidateId: follows.followingId,
                    friendId: follows.followerId,
                })
                .from(follows)
                .where(inArray(follows.followerId, followedIdsArray));

            const mutualsMap = new Map<string, string[]>();
            for (const row of friendsOfFriends) {
                if (excludeSet.has(row.candidateId)) continue;
                if (!mutualsMap.has(row.candidateId)) {
                    mutualsMap.set(row.candidateId, []);
                }
                mutualsMap.get(row.candidateId)!.push(row.friendId);
            }

            for (const [candidateId, mutuals] of mutualsMap.entries()) {
                const mCount = mutuals.length;
                const fofScore = 80 + mCount * 15;
                const fofReason = mCount === 1 ? '1 mutual friend' : `${mCount} mutual friends`;

                const existing = candidateMap.get(candidateId);
                if (existing) {
                    existing.score += fofScore;
                    existing.mutualCount = mCount;
                    existing.reason = `${fofReason} • Follows you`;
                } else {
                    candidateMap.set(candidateId, {
                        userId: candidateId,
                        score: fofScore,
                        reason: fofReason,
                        mutualCount: mCount,
                    });
                }
            }
        }

        // Step 4: Shared Movie / Watch Taste
        const userEntries = await db
            .select({ tmdbId: entries.tmdbId })
            .from(entries)
            .where(eq(entries.userId, currentId))
            .limit(100);

        const userTmdbIds = Array.from(new Set(userEntries.map((e) => e.tmdbId)));

        if (userTmdbIds.length > 0) {
            const excludeArray = Array.from(excludeSet);
            const sharedTasteQuery = db
                .select({
                    candidateId: entries.userId,
                    sharedCount: sql<number>`count(distinct ${entries.tmdbId})`,
                })
                .from(entries)
                .where(
                    excludeArray.length > 0
                        ? and(
                              inArray(entries.tmdbId, userTmdbIds),
                              notInArray(entries.userId, excludeArray)
                          )
                        : inArray(entries.tmdbId, userTmdbIds)
                )
                .groupBy(entries.userId)
                .having(sql`count(distinct ${entries.tmdbId}) >= 2`)
                .orderBy(desc(sql`count(distinct ${entries.tmdbId})`))
                .limit(30);

            const sharedEntries = await sharedTasteQuery;

            for (const row of sharedEntries) {
                const countVal = Number(row.sharedCount) || 0;
                const tasteScore = 40 + countVal * 5;
                const existing = candidateMap.get(row.candidateId);
                if (existing) {
                    existing.score += tasteScore;
                } else {
                    candidateMap.set(row.candidateId, {
                        userId: row.candidateId,
                        score: tasteScore,
                        reason: countVal >= 3 ? `${countVal} shared movies` : 'Shared movie taste',
                        mutualCount: 0,
                    });
                }
            }
        }

        // Step 5: Cold-Start / New User Fallback (Community Cinephiles & Genre Matches)
        if (candidateMap.size < limit) {
            const [currentUser] = await db
                .select({ preferences: users.preferences })
                .from(users)
                .where(eq(users.id, currentId))
                .limit(1);

            const userPrefs = currentUser?.preferences as any;
            const userGenreIds: number[] = Array.isArray(userPrefs?.genreIds) ? userPrefs.genreIds : [];

            const excludeArray = Array.from(excludeSet);
            const communityQuery = db
                .select({
                    id: users.id,
                    xp: users.xp,
                    level: users.level,
                    preferences: users.preferences,
                    entriesCount: count(entries.id),
                })
                .from(users)
                .leftJoin(entries, eq(entries.userId, users.id))
                .where(excludeArray.length > 0 ? notInArray(users.id, excludeArray) : undefined)
                .groupBy(users.id)
                .orderBy(desc(count(entries.id)), desc(users.xp))
                .limit(limit * 2);

            const communityUsers = await communityQuery;

            for (const u of communityUsers) {
                if (candidateMap.has(u.id)) continue;

                const candidatePrefs = u.preferences as any;
                const candidateGenreIds: number[] = Array.isArray(candidatePrefs?.genreIds) ? candidatePrefs.genreIds : [];
                const hasGenreOverlap =
                    userGenreIds.length > 0 &&
                    candidateGenreIds.some((gId) => userGenreIds.includes(gId));

                let reason = 'Popular Cinephile';
                let score = 10;

                if (hasGenreOverlap) {
                    reason = 'Shared genre taste';
                    score = 25;
                } else if (Number(u.entriesCount) >= 5) {
                    reason = 'Active Cinephile';
                    score = 20;
                } else if ((u.xp || 0) > 100) {
                    reason = 'Top Reviewer';
                    score = 18;
                }

                candidateMap.set(u.id, {
                    userId: u.id,
                    score,
                    reason,
                    mutualCount: 0,
                });

                if (candidateMap.size >= limit * 2) break;
            }
        }

        // Step 6: Rank candidates and fetch full profile information
        const sortedCandidates = Array.from(candidateMap.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);

        if (sortedCandidates.length === 0) {
            return [];
        }

        const candidateIds = sortedCandidates.map((c) => c.userId);
        const userRows = await db
            .select({
                id: users.id,
                username: users.username,
                displayName: users.displayName,
                profilePictureUrl: users.profilePictureUrl,
                bio: users.bio,
                isPrivate: users.isPrivate,
                privacyLevel: users.privacyLevel,
            })
            .from(users)
            .where(inArray(users.id, candidateIds));

        const userRowMap = new Map(userRows.map((u) => [u.id, u]));

        const results: SuggestedUserResult[] = [];
        for (const candidate of sortedCandidates) {
            const user = userRowMap.get(candidate.userId);
            if (!user) continue;

            results.push({
                id: user.id,
                username: user.username,
                displayName: user.displayName,
                profilePictureUrl: resolveAvatarUrl(user.profilePictureUrl),
                bio: user.bio,
                isPrivate: Boolean(user.isPrivate),
                privacyLevel: user.privacyLevel || 'PUBLIC',
                isFollowing: false,
                isRequested: false,
                suggestionReason: candidate.reason,
                mutualFriendsCount: candidate.mutualCount,
            });
        }

        return results;
    },
};
