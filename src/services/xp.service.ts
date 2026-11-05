import { db } from '../db/index.js';
import { users, entries, likes } from '../db/schema.js';
import { eq, sql, count, and, isNotNull } from 'drizzle-orm';

export enum XpAction {
    LOG_WATCH = 'LOG_WATCH',
    RECEIVE_LIKE = 'RECEIVE_LIKE',
    WRITE_REVIEW = 'WRITE_REVIEW',
    COMMENT = 'COMMENT',
    COMPLETE_SUGGESTION = 'COMPLETE_SUGGESTION'
}

const XP_VALUES: Record<XpAction, number> = {
    [XpAction.LOG_WATCH]: 50,
    [XpAction.RECEIVE_LIKE]: 10,
    [XpAction.WRITE_REVIEW]: 30,
    [XpAction.COMMENT]: 15,
    [XpAction.COMPLETE_SUGGESTION]: 40
};

export interface Badge {
    id: string;
    name: string;
    description: string;
    icon: string;
    emoji: string;
    category?: 'watch' | 'suggestion' | 'streak' | 'community';
    unlockedAt: string;
}

export const HONEY_BADGES = [
    {
        id: 'pioneer',
        name: 'First Log',
        description: 'Log your first watch entry',
        icon: 'play_circle',
        emoji: '🎬',
        category: 'watch' as const
    },
    {
        id: 'century_watcher',
        name: 'Century Watcher',
        description: 'Log your 100th watch entry',
        icon: 'military_tech',
        emoji: '💯',
        category: 'watch' as const
    },
    {
        id: 'suggestion_starter',
        name: 'Suggestion Starter',
        description: 'Complete 1 suggestion from a friend',
        icon: 'recommend',
        emoji: '🤝',
        category: 'suggestion' as const
    },
    {
        id: 'suggestion_veteran',
        name: 'Suggestion Veteran',
        description: 'Complete 100 suggestions',
        icon: 'stars',
        emoji: '🌟',
        category: 'suggestion' as const
    },
    {
        id: 'streak_10',
        name: 'Serious Watcher',
        description: '10 days watching streak',
        icon: 'local_fire_department',
        emoji: '🔥',
        category: 'streak' as const
    },
    {
        id: 'streak_20',
        name: 'Jobless',
        description: '20 days watching streak',
        icon: 'whatshot',
        emoji: '🌋',
        category: 'streak' as const
    },
    {
        id: 'streak_30',
        name: 'Maniac',
        description: '30 days watching streak',
        icon: 'bolt',
        emoji: '⚡',
        category: 'streak' as const
    },
    // Legacy badges for backwards compatibility
    { id: 'cinephile', name: 'Cinephile', description: 'Log 10 movies', icon: 'movie', emoji: '🍿', category: 'watch' as const },
    { id: 'binge_master', name: 'Binge Master', description: 'Log 10 TV show entries', icon: 'tv', emoji: '📺', category: 'watch' as const },
    { id: 'social_bee', name: 'Social Bee', description: 'Receive 10 likes from others', icon: 'hive', emoji: '🐝', category: 'community' as const },
    { id: 'critic', name: 'Critic', description: 'Write 5 reviews', icon: 'rate_review', emoji: '✍️', category: 'community' as const }
];

export const xpService = {
    /**
     * Calculates the level based on total XP using an exponential formula:
     * XP = 100 * (Level - 1)^1.5
     * Level = (XP / 100)^(1/1.5) + 1
     */
    calculateLevelFromXp(xp: number): number {
        if (xp <= 0) return 1;
        return Math.floor(Math.pow(xp / 100, 1 / 1.5)) + 1;
    },

    /**
     * Calculates the total XP required to reach a specific level.
     */
    getXpRequiredForLevel(level: number): number {
        if (level <= 1) return 0;
        return Math.floor(100 * Math.pow(level - 1, 1.5));
    },

    /**
     * Updates consecutive daily watch streak and checks streak-related badges.
     */
    async updateStreakAndCheckBadges(userId: string): Promise<number> {
        try {
            const [user]: any = await db.select({
                id: users.id,
                watchStreak: users.watchStreak,
                lastWatchDate: users.lastWatchDate,
                badges: users.badges
            }).from(users).where(eq(users.id, userId as any)).limit(1);

            if (!user) return 0;

            const now = new Date();
            const todayStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
            const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            const yesterdayStr = yesterday.toISOString().slice(0, 10);

            let newStreak = user.watchStreak || 0;
            const lastDate = user.lastWatchDate;

            if (lastDate === todayStr) {
                // Already watched today, streak unchanged
                return newStreak;
            } else if (lastDate === yesterdayStr) {
                // Watched yesterday, increment streak
                newStreak = (newStreak || 0) + 1;
            } else {
                // Streak broken or starting fresh today
                newStreak = 1;
            }

            const currentBadges: Badge[] = (user.badges as Badge[]) || [];
            const earnedBadgeIds = new Set(currentBadges.map(b => b.id));
            const newBadges: Badge[] = [...currentBadges];

            // Check streak badges
            const checkAndAddBadge = (badgeId: string) => {
                if (!earnedBadgeIds.has(badgeId)) {
                    const badge = HONEY_BADGES.find(b => b.id === badgeId);
                    if (badge) {
                        newBadges.push({ ...badge, unlockedAt: new Date().toISOString() });
                        earnedBadgeIds.add(badgeId);
                    }
                }
            };

            if (newStreak >= 10) checkAndAddBadge('streak_10');
            if (newStreak >= 20) checkAndAddBadge('streak_20');
            if (newStreak >= 30) checkAndAddBadge('streak_30');

            await db.update(users)
                .set({
                    watchStreak: newStreak,
                    lastWatchDate: todayStr,
                    badges: newBadges,
                    updatedAt: new Date()
                })
                .where(eq(users.id, userId as any));

            return newStreak;
        } catch (err) {
            console.error('[xpService.updateStreakAndCheckBadges] Error:', err);
            return 0;
        }
    },

    /**
     * Checks suggestion completion badges:
     * - suggestion_starter: 1 completed suggestion
     * - suggestion_veteran: 100 completed suggestions
     */
    async checkSuggestionBadges(userId: string) {
        try {
            const [user]: any = await db.select({
                id: users.id,
                badges: users.badges
            }).from(users).where(eq(users.id, userId as any)).limit(1);

            if (!user) return;

            const currentBadges: Badge[] = (user.badges as Badge[]) || [];
            const earnedBadgeIds = new Set(currentBadges.map(b => b.id));
            const newBadges: Badge[] = [...currentBadges];

            // Count suggestions completed by this user (entries where suggestedByUserId is not null)
            const [suggestedEntries]: any = await db.select({ val: count() })
                .from(entries)
                .where(and(eq(entries.userId, userId as any), isNotNull(entries.suggestedByUserId)));

            const completedCount = Number(suggestedEntries?.val) || 0;

            const checkAndAddBadge = (badgeId: string) => {
                if (!earnedBadgeIds.has(badgeId)) {
                    const badge = HONEY_BADGES.find(b => b.id === badgeId);
                    if (badge) {
                        newBadges.push({ ...badge, unlockedAt: new Date().toISOString() });
                        earnedBadgeIds.add(badgeId);
                    }
                }
            };

            if (completedCount >= 1) checkAndAddBadge('suggestion_starter');
            if (completedCount >= 100) checkAndAddBadge('suggestion_veteran');

            if (newBadges.length > currentBadges.length) {
                await db.update(users)
                    .set({ badges: newBadges, updatedAt: new Date() })
                    .where(eq(users.id, userId as any));
            }
        } catch (err) {
            console.error('[xpService.checkSuggestionBadges] Error:', err);
        }
    },

    /**
     * Awards XP to a user and handles potential level ups and badges.
     */
    async awardXp(userId: string, action: XpAction) {
        const xpAmount = XP_VALUES[action] || 10;
        
        // 1. Fetch current user state
        const [user]: any = await db.select().from(users).where(eq(users.id, userId as any));
        if (!user) return;

        const oldXp = user.xp || 0;
        const newXp = oldXp + xpAmount;
        const oldLevel = user.level || 1;
        const newLevel = this.calculateLevelFromXp(newXp);

        // 2. Check for new badges
        const currentBadges: Badge[] = (user.badges as Badge[]) || [];
        const earnedBadgeIds = new Set(currentBadges.map(b => b.id));
        const newBadges: Badge[] = [...currentBadges];

        const checkAndAddBadge = (badgeId: string) => {
            if (!earnedBadgeIds.has(badgeId)) {
                const badge = HONEY_BADGES.find(b => b.id === badgeId);
                if (badge) {
                    newBadges.push({ ...badge, unlockedAt: new Date().toISOString() });
                    earnedBadgeIds.add(badgeId);
                }
            }
        };

        // 1 - Log your first watch (pioneer / first_log)
        if (!earnedBadgeIds.has('pioneer') && !earnedBadgeIds.has('first_log')) {
            const [entriesCount]: any = await db.select({ val: count() }).from(entries).where(eq(entries.userId, userId as any));
            if (entriesCount.val >= 1) {
                checkAndAddBadge('pioneer');
            }
        }

        // 2 - Log your 100th watch (century_watcher)
        if (!earnedBadgeIds.has('century_watcher')) {
            const [entriesCount]: any = await db.select({ val: count() }).from(entries)
                .where(and(eq(entries.userId, userId as any), eq(entries.isWatching, false)));
            if (entriesCount.val >= 100) {
                checkAndAddBadge('century_watcher');
            }
        }

        // Cinephile (10 movies)
        if (!earnedBadgeIds.has('cinephile')) {
            const [movieCount]: any = await db.select({ val: count() }).from(entries)
                .where(sql`${entries.userId} = ${userId} AND ${entries.type} = 'MOVIE'`);
            if (movieCount.val >= 10) {
                checkAndAddBadge('cinephile');
            }
        }

        // Binge Master (10 TV shows)
        if (!earnedBadgeIds.has('binge_master')) {
            const [tvCount]: any = await db.select({ val: count() }).from(entries)
                .where(sql`${entries.userId} = ${userId} AND ${entries.type} = 'TV_SHOW'`);
            if (tvCount.val >= 10) {
                checkAndAddBadge('binge_master');
            }
        }

        // Social Bee (10 likes)
        if (!earnedBadgeIds.has('social_bee')) {
            const [likesCount]: any = await db.select({ val: count() }).from(likes)
                .innerJoin(entries, eq(likes.entryId, entries.id))
                .where(eq(entries.userId, userId as any));
            if (likesCount.val >= 10) {
                checkAndAddBadge('social_bee');
            }
        }

        // Critic (5 reviews)
        if (!earnedBadgeIds.has('critic')) {
            const [reviewCount]: any = await db.select({ val: count() }).from(entries)
                .where(sql`${entries.userId} = ${userId} AND length(${entries.review}) > 10`);
            if (reviewCount.val >= 5) {
                checkAndAddBadge('critic');
            }
        }

        // 3. Update user
        await db.update(users)
            .set({ 
                xp: newXp, 
                level: newLevel,
                badges: newBadges,
                updatedAt: new Date()
            })
            .where(eq(users.id, userId as any));

        return {
            leveledUp: newLevel > oldLevel,
            newLevel,
            newBadges: newBadges.length > currentBadges.length
        };
    }
};
