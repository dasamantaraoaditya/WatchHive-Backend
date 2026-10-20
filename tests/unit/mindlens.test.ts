import { describe, it, expect } from '@jest/globals';

// Test Shannon Entropy logic mathematically
function computeTestEntropy(genreWeights: Record<string, number>) {
    let totalWeight = 0;
    for (const w of Object.values(genreWeights)) totalWeight += w;
    if (totalWeight === 0) return { entropy: 0, normalizedBreadth: 0 };

    let entropy = 0;
    for (const w of Object.values(genreWeights)) {
        const p = w / totalWeight;
        if (p > 0) entropy -= p * Math.log2(p);
    }
    const distinctCount = Object.keys(genreWeights).length;
    const maxEntropy = Math.log2(Math.max(distinctCount, 2));
    const normalizedBreadth = Math.min(1.0, Math.max(0.0, parseFloat((entropy / maxEntropy).toFixed(2))));
    return { entropy: parseFloat(entropy.toFixed(2)), normalizedBreadth };
}

// Test Bayesian Recommender Trust Score
function computeTestTrustScore(
    suggestedCount: number,
    watchedCount: number,
    rawAvgRating: number,
    globalUserRating: number
) {
    const totalSuggested = Math.max(suggestedCount, watchedCount);
    const conversionRate = totalSuggested > 0 ? (watchedCount / totalSuggested) * 100 : 0;
    const C = 3;
    const M = globalUserRating;

    // Smoothed rating
    const smoothedRating = (watchedCount * rawAvgRating + C * M) / (watchedCount + C);
    const sampleFactor = Math.min(1.0, watchedCount / 2);
    const trustScore = Math.round(
        ((0.40 * (conversionRate / 100)) + (0.60 * (smoothedRating / 10))) * sampleFactor * 100
    );
    return { conversionRate, smoothedRating: parseFloat(smoothedRating.toFixed(1)), trustScore };
}

describe('MindLens 2.0 Mathematical Models', () => {
    describe('Shannon Information Entropy (Taste Breadth)', () => {
        it('should yield low normalized breadth for a single-genre specialist', () => {
            const singleGenre = { 'Horror': 10 };
            const result = computeTestEntropy(singleGenre);
            expect(result.entropy).toBe(0);
            expect(result.normalizedBreadth).toBe(0);
        });

        it('should yield high normalized breadth (>= 0.75) for an eclectic distribution', () => {
            const balancedGenres = {
                'Action': 5,
                'Comedy': 5,
                'Drama': 5,
                'Sci-Fi': 5,
                'Animation': 5,
                'Horror': 5,
            };
            const result = computeTestEntropy(balancedGenres);
            expect(result.normalizedBreadth).toBe(1.0);
        });

        it('should scale proportionally for moderate diversity', () => {
            const skewedGenres = {
                'Drama': 10,
                'Thriller': 3,
                'Comedy': 1,
            };
            const result = computeTestEntropy(skewedGenres);
            expect(result.normalizedBreadth).toBeGreaterThan(0.4);
            expect(result.normalizedBreadth).toBeLessThan(0.85);
        });
    });

    describe('Bayesian-Smoothed Recommender Trust Score', () => {
        it('should prevent single-hit distortion from outranking sustained recommenders', () => {
            const globalMean = 7.0;

            // Friend A: 1 suggestion, 1 watched, rated 10/10 (100% raw hit rate)
            const friendA = computeTestTrustScore(1, 1, 10, globalMean);

            // Friend B: 6 suggestions, 5 watched, rated 8.5/10 (sustained great recommendations)
            const friendB = computeTestTrustScore(6, 5, 8.5, globalMean);

            // Friend A's smoothed rating should be pulled down toward global mean
            expect(friendA.smoothedRating).toBe(7.8);
            // Friend B's smoothed rating remains high
            expect(friendB.smoothedRating).toBe(7.9);

            // Friend B must have a significantly higher Trust Score due to sample confidence
            expect(friendB.trustScore).toBeGreaterThan(friendA.trustScore);
        });

        it('should award Golden Compass tier (trustScore >= 75) to high-volume high-accuracy tastemakers', () => {
            const globalMean = 7.2;
            const stellarFriend = computeTestTrustScore(5, 5, 9.0, globalMean);
            expect(stellarFriend.trustScore).toBeGreaterThanOrEqual(75);
            expect(stellarFriend.conversionRate).toBe(100);
        });
    });
});
