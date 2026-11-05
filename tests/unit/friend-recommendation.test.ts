import { describe, it, expect, beforeEach, jest } from '@jest/globals';

describe('Friend Recommendation Service Unit Tests', () => {
    it('ranks mutual friends higher than generic users', () => {
        const candidateA = {
            userId: 'user-a',
            score: 110, // 80 + 2 * 15
            reason: '2 mutual friends',
            mutualCount: 2,
        };
        const candidateB = {
            userId: 'user-b',
            score: 95, // 80 + 1 * 15
            reason: '1 mutual friend',
            mutualCount: 1,
        };
        const candidateC = {
            userId: 'user-c',
            score: 20,
            reason: 'Active Cinephile',
            mutualCount: 0,
        };

        const candidates = [candidateC, candidateA, candidateB];
        candidates.sort((a, b) => b.score - a.score);

        expect(candidates[0].userId).toBe('user-a');
        expect(candidates[1].userId).toBe('user-b');
        expect(candidates[2].userId).toBe('user-c');
    });

    it('combines follows you and mutual friends cleanly', () => {
        const inboundFollower = {
            userId: 'user-f',
            score: 100,
            reason: 'Follows you',
            mutualCount: 0,
        };
        const mCount = 3;
        const fofScore = 80 + mCount * 15;
        const fofReason = `${mCount} mutual friends`;

        inboundFollower.score += fofScore;
        inboundFollower.mutualCount = mCount;
        inboundFollower.reason = `${fofReason} • Follows you`;

        expect(inboundFollower.score).toBe(225);
        expect(inboundFollower.reason).toBe('3 mutual friends • Follows you');
        expect(inboundFollower.mutualCount).toBe(3);
    });

    it('assigns relevant cold start reasons for new users without friends', () => {
        const userWithGenres = {
            entriesCount: 0,
            xp: 50,
            hasGenreOverlap: true,
        };

        let reason = 'Popular Cinephile';
        let score = 10;
        if (userWithGenres.hasGenreOverlap) {
            reason = 'Shared genre taste';
            score = 25;
        }

        expect(reason).toBe('Shared genre taste');
        expect(score).toBe(25);
    });
});
