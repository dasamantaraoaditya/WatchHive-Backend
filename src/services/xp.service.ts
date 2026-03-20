import { db } from '../db/index.js';
import { users, entries, likes } from '../db/schema.js';
import { eq, sql, count } from 'drizzle-orm';

export enum XpAction {
    LOG_WATCH = 'LOG_WATCH',
    RECEIVE_LIKE = 'RECEIVE_LIKE',
    WRITE_REVIEW = 'WRITE_REVIEW',
    COMMENT = 'COMMENT'
}

const XP_VALUES: Record<XpAction, number> = {
    [XpAction.LOG_WATCH]: 50,
    [XpAction.RECEIVE_LIKE]: 10,
    [XpAction.WRITE_REVIEW]: 30,
    [XpAction.COMMENT]: 15
};

export interface Badge {
    id: string;
    name: string;
    description: string;
    icon: string;
    unlockedAt: string;
}

const AVAILABLE_BADGES = [
    { id: 'pioneer', name: 'Pioneer', description: 'Log your first watch entry', icon: 'auto_awesome' },
    { id: 'cinephile', name: 'Cinephile', description: 'Log 10 movies', icon: 'movie' },
    { id: 'binge_master', name: 'Binge Master', description: 'Log 10 TV show entries', icon: 'tv' },
    { id: 'social_bee', name: 'Social Bee', description: 'Receive 10 likes from others', icon: 'recommend' },
    { id: 'critic', name: 'Critic', description: 'Write 5 reviews', icon: 'rate_review' }
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
     * Awards XP to a user and handles potential level ups and badges.
     */
    async awardXp(userId: string, action: XpAction) {
        const xpAmount = XP_VALUES[action];
        
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

        // Trigger logic
        if (!earnedBadgeIds.has('pioneer')) {
            const [entriesCount]: any = await db.select({ val: count() }).from(entries).where(eq(entries.userId, userId as any));
            if (entriesCount.val >= 1) {
                const badge = AVAILABLE_BADGES.find(b => b.id === 'pioneer')!;
                newBadges.push({ ...badge, unlockedAt: new Date().toISOString() });
            }
        }

        if (!earnedBadgeIds.has('cinephile')) {
            const [movieCount]: any = await db.select({ val: count() }).from(entries)
                .where(sql`${entries.userId} = ${userId} AND ${entries.type} = 'MOVIE'`);
            if (movieCount.val >= 10) {
                const badge = AVAILABLE_BADGES.find(b => b.id === 'cinephile')!;
                newBadges.push({ ...badge, unlockedAt: new Date().toISOString() });
            }
        }

        if (!earnedBadgeIds.has('binge_master')) {
            const [tvCount]: any = await db.select({ val: count() }).from(entries)
                .where(sql`${entries.userId} = ${userId} AND ${entries.type} = 'TV_SHOW'`);
            if (tvCount.val >= 10) {
                const badge = AVAILABLE_BADGES.find(b => b.id === 'binge_master')!;
                newBadges.push({ ...badge, unlockedAt: new Date().toISOString() });
            }
        }

        if (!earnedBadgeIds.has('social_bee')) {
            const [likesCount]: any = await db.select({ val: count() }).from(likes)
                .innerJoin(entries, eq(likes.entryId, entries.id))
                .where(eq(entries.userId, userId as any));
            if (likesCount.val >= 10) {
                const badge = AVAILABLE_BADGES.find(b => b.id === 'social_bee')!;
                newBadges.push({ ...badge, unlockedAt: new Date().toISOString() });
            }
        }

        if (!earnedBadgeIds.has('critic')) {
            const [reviewCount]: any = await db.select({ val: count() }).from(entries)
                .where(sql`${entries.userId} = ${userId} AND length(${entries.review}) > 10`);
            if (reviewCount.val >= 5) {
                const badge = AVAILABLE_BADGES.find(b => b.id === 'critic')!;
                newBadges.push({ ...badge, unlockedAt: new Date().toISOString() });
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
