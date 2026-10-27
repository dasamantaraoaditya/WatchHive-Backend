import { describe, it, expect } from '@jest/globals';

describe('SmartSuggest Scoring Engine Formula Tests', () => {
    function computeMockScore(options: {
        mode: 'social' | 'critic' | 'explore';
        isFriendSuggestion: boolean;
        friendTrustMultiplier: number;
        networkBuzzCount: number;
        voteAvg: number;
        voteCount: number;
        matchesGenre: boolean;
        isContrastingGenre: boolean;
        isDuplicateStreak: boolean;
        isWatchlist: boolean;
    }) {
        let socialScore = 0;
        let consensusScore = 0;
        let tasteScore = 0;
        let diversityBonus = 0;
        let fatiguePenalty = 0;

        if (options.isFriendSuggestion) {
            socialScore += 35 * options.friendTrustMultiplier;
        }

        if (options.networkBuzzCount > 0) {
            socialScore += Math.min(options.networkBuzzCount * 8, 20);
        }

        if (options.voteAvg > 0) {
            consensusScore += (options.voteAvg / 10) * 28;
            if (options.voteAvg >= 7.8 && options.voteCount >= 400) {
                consensusScore += 7;
            }
        }

        if (options.matchesGenre) {
            tasteScore += 18;
        }

        if (options.isWatchlist) {
            tasteScore += 12;
        }

        if (options.isContrastingGenre) {
            diversityBonus += options.mode === 'explore' ? 25 : 12;
        }

        if (options.isDuplicateStreak && options.mode === 'explore') {
            fatiguePenalty += 15;
        }

        let finalScore = 0;
        if (options.mode === 'social') {
            finalScore = (socialScore * 1.5) + (consensusScore * 0.8) + (tasteScore * 0.9) + (diversityBonus * 0.8) - fatiguePenalty;
        } else if (options.mode === 'critic') {
            finalScore = (socialScore * 0.6) + (consensusScore * 1.6) + (tasteScore * 0.9) + (diversityBonus * 0.6) - fatiguePenalty;
        } else { // explore
            finalScore = (socialScore * 0.7) + (consensusScore * 0.8) + (tasteScore * 0.7) + (diversityBonus * 1.8) - (fatiguePenalty * 1.4);
        }

        return Math.min(99, Math.max(62, Math.round(finalScore)));
    }

    it('should heavily boost a movie in Social Mode when suggested by a high-impact friend', () => {
        const socialPick = computeMockScore({
            mode: 'social',
            isFriendSuggestion: true,
            friendTrustMultiplier: 1.3,
            networkBuzzCount: 2,
            voteAvg: 8.0,
            voteCount: 1200,
            matchesGenre: true,
            isContrastingGenre: false,
            isDuplicateStreak: false,
            isWatchlist: false,
        });

        const genericPick = computeMockScore({
            mode: 'social',
            isFriendSuggestion: false,
            friendTrustMultiplier: 1.0,
            networkBuzzCount: 0,
            voteAvg: 8.0,
            voteCount: 1200,
            matchesGenre: true,
            isContrastingGenre: false,
            isDuplicateStreak: false,
            isWatchlist: false,
        });

        expect(socialPick).toBeGreaterThan(genericPick);
        expect(socialPick).toBeGreaterThanOrEqual(90);
    });

    it('should prioritize high critical consensus in Critic Mode', () => {
        const highAcclaim = computeMockScore({
            mode: 'critic',
            isFriendSuggestion: false,
            friendTrustMultiplier: 1.0,
            networkBuzzCount: 0,
            voteAvg: 9.2,
            voteCount: 2500,
            matchesGenre: true,
            isContrastingGenre: false,
            isDuplicateStreak: false,
            isWatchlist: false,
        });

        const lowAcclaimFriendPick = computeMockScore({
            mode: 'critic',
            isFriendSuggestion: true,
            friendTrustMultiplier: 1.0,
            networkBuzzCount: 0,
            voteAvg: 6.2,
            voteCount: 100,
            matchesGenre: false,
            isContrastingGenre: false,
            isDuplicateStreak: false,
            isWatchlist: false,
        });

        expect(highAcclaim).toBeGreaterThan(lowAcclaimFriendPick);
    });

    it('should reward Palate Cleansers and penalize duplicate genre streaks in Explore Mode', () => {
        const palateCleanser = computeMockScore({
            mode: 'explore',
            isFriendSuggestion: false,
            friendTrustMultiplier: 1.0,
            networkBuzzCount: 0,
            voteAvg: 7.9,
            voteCount: 800,
            matchesGenre: false,
            isContrastingGenre: true,
            isDuplicateStreak: false,
            isWatchlist: false,
        });

        const fatigueDuplicate = computeMockScore({
            mode: 'explore',
            isFriendSuggestion: false,
            friendTrustMultiplier: 1.0,
            networkBuzzCount: 0,
            voteAvg: 7.9,
            voteCount: 800,
            matchesGenre: true,
            isContrastingGenre: false,
            isDuplicateStreak: true,
            isWatchlist: false,
        });

        expect(palateCleanser).toBeGreaterThan(fatigueDuplicate);
    });
});
