import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { db } from '../db/index.js';
import { entries, users, suggestions, listItems, lists } from '../db/schema.js';
import { eq, desc, and, isNotNull, aliasedTable, count } from 'drizzle-orm';
import { resolveAvatarUrl } from '../utils/avatar.util.js';

const router = Router();

// Genre to Psychological Theme Mapping (Uses & Gratifications Theory)
const GENRE_THEMES: Record<string, string> = {
    'Action': 'Adrenaline Seeking',
    'Adventure': 'Exploration & Novelty',
    'Animation': 'Imagination & Playfulness',
    'Comedy': 'Stress Relief & Optimism',
    'Crime': 'Justice & Order Seeking',
    'Documentary': 'Intellectual Curiosity',
    'Drama': 'Emotional Processing',
    'Family': 'Comfort & Connection',
    'Fantasy': 'Escapism & Creativity',
    'History': 'Context & Perspective',
    'Horror': 'Thrill Seeking',
    'Music': 'Aesthetic Appreciation',
    'Mystery': 'Problem Solving',
    'Romance': 'Emotional Connection',
    'Science Fiction': 'Future-Oriented Thinking',
    'Sci-Fi': 'Future-Oriented Thinking',
    'TV Movie': 'Comfort Viewing',
    'Thriller': 'Suspense & Stimulation',
    'War': 'Intensity & Conflict Awareness',
    'Western': 'Independence & Justice',
};

// Russell's Circumplex Model of Affect Coordinates: [Valence (-1..1), Arousal (-1..1)]
const GENRE_AFFECT_COORDINATES: Record<string, [number, number]> = {
    'Comedy': [0.85, -0.15],
    'Animation': [0.70, 0.20],
    'Family': [0.75, -0.25],
    'Romance': [0.65, -0.30],
    'Music': [0.60, 0.10],
    'Action': [0.30, 0.85],
    'Adventure': [0.55, 0.65],
    'Sci-Fi': [0.25, 0.70],
    'Science Fiction': [0.25, 0.70],
    'Fantasy': [0.50, 0.50],
    'Thriller': [-0.25, 0.85],
    'Horror': [-0.60, 0.90],
    'Crime': [-0.20, 0.65],
    'Mystery': [0.00, 0.55],
    'Drama': [-0.25, -0.50],
    'History': [0.05, -0.40],
    'Documentary': [0.15, -0.55],
    'War': [-0.55, 0.50],
    'Western': [0.10, 0.40],
};

// 6 Scientifically Grounded Cognitive Archetypes
interface CognitiveArchetype {
    id: string;
    name: string;
    tagline: string;
    description: string;
    icon: string;
    color: string;
    scientificBasis: string;
    coreTraits: string[];
}

const COGNITIVE_ARCHETYPES: CognitiveArchetype[] = [
    {
        id: 'contemplative_eudaimonist',
        name: 'The Contemplative Eudaimonist',
        tagline: 'Seeking Meaning, Catharsis & Emotional Depth',
        description: 'You treat cinema as an emotional and philosophical mirror, gravitating toward character-driven narratives, moral complexity, and human vulnerability.',
        icon: 'psychology',
        color: '#8b5cf6', // Violet
        scientificBasis: 'Oliver & Raney (2011) Eudaimonic Media Consumption Theory',
        coreTraits: ['High Empathy Processing', 'Moral Nuance', 'Emotional Resilience']
    },
    {
        id: 'adrenaline_synthesizer',
        name: 'The Adrenaline Synthesizer',
        tagline: 'High-Tempo Stimulus & Dopamine Momentum',
        description: 'You are energized by physiological activation, fast-paced world-building, suspense, and high-stakes cinematic momentum.',
        icon: 'bolt',
        color: '#f59e0b', // Amber
        scientificBasis: 'Zillmann (1988) Excitatory Homeostasis Model',
        coreTraits: ['Dopamine Seeking', 'High Arousal Appetite', 'Dynamic Pacing']
    },
    {
        id: 'comfort_restorer',
        name: 'The Comfort Restorer',
        tagline: 'Emotional Grounding, Warmth & Stress Alleviation',
        description: 'You utilize cinema for affective self-care and mental decompression, turning to trusted narratives, humor, and wholesome worlds for psychological safety.',
        icon: 'spa',
        color: '#10b981', // Emerald
        scientificBasis: 'Uses & Gratifications Stress Reduction Hypothesis',
        coreTraits: ['Affective Safety', 'Rewatch Comfort', 'Optimistic Recharge']
    },
    {
        id: 'analytic_purist',
        name: 'The Analytic Purist',
        tagline: 'Technical Rigor, Discerning Standards & Craft',
        description: 'You evaluate cinema through a deliberate critical lens, holding direction, screenplay execution, and thematic coherence to uncompromising standards.',
        icon: 'balance',
        color: '#3b82f6', // Blue
        scientificBasis: 'Bourdieu Aesthetic Distinction & Discretion Metric',
        coreTraits: ['High Critical Rigor', 'Selective Acclaim', 'Structural Insight']
    },
    {
        id: 'eclectic_polymath',
        name: 'The Eclectic Polymath',
        tagline: 'High Cognitive Openness & Boundary-Crossing Taste',
        description: 'Your appetite spans disparate genres, eras, and aesthetic horizons with high information entropy and an adventurous resistance to echo chambers.',
        icon: 'public',
        color: '#06b6d4', // Cyan
        scientificBasis: 'Shannon Information Entropy & Cognitive Openness to Experience',
        coreTraits: ['High Genre Entropy', 'Novelty Seeking', 'Curious Exploration']
    },
    {
        id: 'social_connector',
        name: 'The Social Connector',
        tagline: 'Cinema as Shared Currency & Relational Bridge',
        description: 'You experience cinema socially, actively trading recommendations with friends and converting peer taste into meaningful shared discussions.',
        icon: 'groups',
        color: '#ec4899', // Pink
        scientificBasis: 'McPherson et al. Homophily & Social Resonance Theory',
        coreTraits: ['High Suggestion Velocity', 'Peer Resonance', 'Collaborative Taste']
    }
];

/**
 * Compute Shannon Information Entropy across genre distribution
 */
function computeTasteEntropy(entriesList: any[]) {
    const genreWeights: Record<string, number> = {};
    let totalWeight = 0;

    entriesList.forEach(entry => {
        // Exclude heavily disliked entries (< 5.0) from taste affinity calculations
        const rating = entry.rating ? parseFloat(entry.rating) : null;
        if (rating !== null && rating < 5.0) return;

        if (entry.tags && Array.isArray(entry.tags) && entry.tags.length > 0) {
            entry.tags.forEach((tag: string, index: number) => {
                const normTag = tag.trim();
                for (const genre of Object.keys(GENRE_THEMES)) {
                    if (normTag.toLowerCase().includes(genre.toLowerCase())) {
                        // Primary tag gets full weight 1.0; secondary tags get 0.3
                        const weight = index === 0 ? 1.0 : 0.3;
                        genreWeights[genre] = (genreWeights[genre] || 0) + weight;
                        totalWeight += weight;
                        break;
                    }
                }
            });
        }
    });

    const distinctGenres = Object.keys(genreWeights).length;
    if (distinctGenres === 0 || totalWeight === 0) {
        return {
            entropy: 0,
            normalizedBreadth: 0.5,
            label: 'Calibrating Taste',
            description: 'Log more entries to map your genre dispersion.',
            genreDistribution: [],
        };
    }

    // Shannon Entropy H = -Sum(p * log2(p))
    let entropy = 0;
    const genreDistribution: { genre: string; percentage: number; weight: number }[] = [];

    for (const [genre, weight] of Object.entries(genreWeights)) {
        const p = weight / totalWeight;
        if (p > 0) {
            entropy -= p * Math.log2(p);
        }
        genreDistribution.push({
            genre,
            percentage: Math.round(p * 100),
            weight: parseFloat(weight.toFixed(1)),
        });
    }

    genreDistribution.sort((a, b) => b.weight - a.weight);

    // Theoretical maximum entropy for K distinct genres = log2(K)
    const maxEntropy = Math.log2(Math.max(distinctGenres, 2));
    const normalizedBreadth = Math.min(1.0, Math.max(0.0, parseFloat((entropy / maxEntropy).toFixed(2))));

    let label = 'Balanced Explorer';
    let description = 'Healthy core taste with steady exploratory branches.';

    if (normalizedBreadth >= 0.75) {
        label = 'Eclectic Polymath';
        description = `High cognitive openness across ${distinctGenres} distinct genres with wide appetite for novelty.`;
    } else if (normalizedBreadth < 0.40) {
        label = 'Genre Specialist';
        description = `Strong focus on favorite comfort genres with high stylistic consistency.`;
    }

    return {
        entropy: parseFloat(entropy.toFixed(2)),
        normalizedBreadth,
        label,
        description,
        genreDistribution: genreDistribution.slice(0, 6),
    };
}

/**
 * Predict current mental state & affective mood based on Russell's Circumplex Model
 * with exponential recency decay weighting over the last 7 entries
 */
function computeAffectiveState(recentEntries: any[]) {
    if (!recentEntries || recentEntries.length === 0) {
        return {
            mood: 'Neutral Baseline',
            status: 'Calm & Steady',
            quadrant: 'Equilibrium',
            valence: 0,
            arousal: 0,
            description: 'Not enough recent logs to detect an active affective shift.',
            icon: '🧘',
            confidence: 50,
            recentTitles: [],
        };
    }

    let weightedValence = 0;
    let weightedArousal = 0;
    let totalWeight = 0;
    const recentTitles: string[] = [];

    // Recency decay: lambda = 0.20 (index 0 is most recent)
    recentEntries.slice(0, 7).forEach((entry, idx) => {
        const weight = Math.exp(-0.20 * idx);
        recentTitles.push(entry.title);

        let entryValence = 0.1;
        let entryArousal = 0.0;
        let matchCount = 0;

        if (entry.tags && Array.isArray(entry.tags)) {
            entry.tags.forEach((t: string) => {
                for (const [genre, coords] of Object.entries(GENRE_AFFECT_COORDINATES)) {
                    if (t.toLowerCase().includes(genre.toLowerCase())) {
                        entryValence += coords[0];
                        entryArousal += coords[1];
                        matchCount++;
                        break;
                    }
                }
            });
        }

        if (matchCount > 0) {
            entryValence /= matchCount;
            entryArousal /= matchCount;
        }

        weightedValence += entryValence * weight;
        weightedArousal += entryArousal * weight;
        totalWeight += weight;
    });

    const valence = totalWeight > 0 ? parseFloat((weightedValence / totalWeight).toFixed(2)) : 0.1;
    const arousal = totalWeight > 0 ? parseFloat((weightedArousal / totalWeight).toFixed(2)) : 0.0;

    let quadrant = 'Equilibrium';
    let mood = 'Balanced Viewing';
    let status = 'Observational Baseline';
    let description = 'Recent viewing reflects a steady, balanced emotional tone.';
    let icon = '⚖️';

    if (arousal >= 0.25 && valence >= 0.10) {
        quadrant = 'Dopamine & Energy';
        mood = 'Excited & Immersive';
        status = 'High Energy & Momentum';
        description = 'Recent watches prioritize momentum, bold world-building, and adrenaline activation.';
        icon = '🚀';
    } else if (arousal >= 0.25 && valence < 0.10) {
        quadrant = 'Tension & Arousal';
        mood = 'High-Alert Thrill Seeking';
        status = 'Suspense & Focus Stimulation';
        description = 'Gravitating toward high-stakes, suspenseful narratives to channel mental focus.';
        icon = '⚡️';
    } else if (arousal < 0.25 && valence >= 0.15) {
        quadrant = 'Comfort & Recharge';
        mood = 'Lighthearted & Recharging';
        status = 'Emotional Safety & Warmth';
        description = 'Recent choices emphasize laughter, reassurance, and psychological decompression.';
        icon = '☀️';
    } else {
        quadrant = 'Eudaimonic Reflection';
        mood = 'Contemplative Reflection';
        status = 'Deep Meaning & Empathy';
        description = 'Leaning toward character-driven stories exploring existential nuance and emotional processing.';
        icon = '🌊';
    }

    return {
        mood,
        status,
        quadrant,
        valence,
        arousal,
        description,
        icon,
        confidence: Math.min(94, 60 + recentEntries.length * 5),
        recentTitles: recentTitles.slice(0, 4),
    };
}

/**
 * Compute Critical Rigor & Standard Deviation
 */
function computeCriticalRigor(allEntries: any[]) {
    let ratedSum = 0;
    const ratings: number[] = [];
    let reviewCount = 0;

    allEntries.forEach(e => {
        if (e.rating) {
            const r = parseFloat(e.rating);
            if (r > 0) {
                ratedSum += r;
                ratings.push(r);
            }
        }
        if (e.review && e.review.trim().length > 20) {
            reviewCount++;
        }
    });

    const totalRated = ratings.length;
    const averageRating = totalRated > 0 ? parseFloat((ratedSum / totalRated).toFixed(1)) : 7.0;

    // Variance & Standard Deviation
    let variance = 0;
    if (totalRated > 1) {
        const sumSquareDiffs = ratings.reduce((acc, r) => acc + Math.pow(r - averageRating, 2), 0);
        variance = parseFloat((sumSquareDiffs / (totalRated - 1)).toFixed(2));
    }
    const standardDeviation = parseFloat(Math.sqrt(variance).toFixed(2));
    const reviewRatio = allEntries.length > 0 ? Math.round((reviewCount / allEntries.length) * 100) : 0;

    let label = 'Balanced Critic';
    if (averageRating < 6.5) {
        label = 'Discerning Judge';
    } else if (averageRating >= 8.2) {
        label = 'Generous Enthusiast';
    } else if (standardDeviation >= 1.8) {
        label = 'High Variance Critic';
    }

    return {
        averageRating,
        variance,
        standardDeviation,
        label,
        reviewRatio,
        totalRated,
    };
}

/**
 * Select the best Cognitive Archetype based on rigorous behavioral metrics
 */
function determineCognitiveArchetype(
    allEntries: any[],
    entropyData: ReturnType<typeof computeTasteEntropy>,
    rigorData: ReturnType<typeof computeCriticalRigor>,
    suggestionStats: any
): CognitiveArchetype {
    const total = allEntries.length;
    if (total === 0) return COGNITIVE_ARCHETYPES[0];

    const rewatchCount = allEntries.filter(e => e.isRewatch).length;
    const rewatchRatio = total > 0 ? (rewatchCount / total) : 0;

    const genreDist = entropyData.genreDistribution;
    const dramaWeight = genreDist.find(g => ['Drama', 'History', 'Documentary'].includes(g.genre))?.percentage || 0;
    const actionWeight = genreDist.find(g => ['Action', 'Thriller', 'Crime', 'Horror'].includes(g.genre))?.percentage || 0;
    const comfortWeight = genreDist.find(g => ['Comedy', 'Animation', 'Family', 'Romance'].includes(g.genre))?.percentage || 0;

    // 1. Social Connector: High suggestion reliance
    if (suggestionStats.summary.totalSuggestionsWatched >= 3 && suggestionStats.summary.overallConversionRate >= 50) {
        return COGNITIVE_ARCHETYPES.find(a => a.id === 'social_connector')!;
    }

    // 2. Analytic Purist: High variance, low mean rating, or high review ratio
    if (total >= 10 && (rigorData.averageRating <= 6.6 || (rigorData.reviewRatio >= 35 && rigorData.standardDeviation >= 1.4))) {
        return COGNITIVE_ARCHETYPES.find(a => a.id === 'analytic_purist')!;
    }

    // 3. Eclectic Polymath: High Shannon Entropy
    if (entropyData.normalizedBreadth >= 0.75 && total >= 8) {
        return COGNITIVE_ARCHETYPES.find(a => a.id === 'eclectic_polymath')!;
    }

    // 4. Comfort Restorer: High rewatch or high comedy/animation/family
    if (rewatchRatio >= 0.20 || comfortWeight >= 40) {
        return COGNITIVE_ARCHETYPES.find(a => a.id === 'comfort_restorer')!;
    }

    // 5. Adrenaline Synthesizer: High action/thriller/crime
    if (actionWeight >= 45) {
        return COGNITIVE_ARCHETYPES.find(a => a.id === 'adrenaline_synthesizer')!;
    }

    // 6. Contemplative Eudaimonist: High drama/history/doc or default
    if (dramaWeight >= 35) {
        return COGNITIVE_ARCHETYPES.find(a => a.id === 'contemplative_eudaimonist')!;
    }

    return COGNITIVE_ARCHETYPES.find(a => a.id === 'contemplative_eudaimonist')!;
}

/**
 * Compute Suggestion Analytics & Bayesian-Smoothed Recommender Trust Scores
 */
async function computeSuggestionAnalytics(userId: string, globalUserRating: number) {
    try {
        // 1. Fetch suggestions sent to this user
        const receivedSuggestions = await db
            .select({
                id: suggestions.id,
                fromUserId: suggestions.fromUserId,
                tmdbId: suggestions.tmdbId,
                mediaType: suggestions.mediaType,
                createdAt: suggestions.createdAt,
                fromUser: {
                    id: users.id,
                    username: users.username,
                    displayName: users.displayName,
                    profilePictureUrl: users.profilePictureUrl,
                }
            })
            .from(suggestions)
            .innerJoin(users, eq(suggestions.fromUserId, users.id))
            .where(eq(suggestions.toUserId, userId));

        // 2. Fetch user's entries that have suggestedByUserId
        const suggestorAlias = aliasedTable(users, 'suggestor_user');
        const suggestedEntries = await db
            .select({
                id: entries.id,
                suggestedByUserId: entries.suggestedByUserId,
                rating: entries.rating,
                isWatching: entries.isWatching,
                review: entries.review,
                suggestor: {
                    id: suggestorAlias.id,
                    username: suggestorAlias.username,
                    displayName: suggestorAlias.displayName,
                    profilePictureUrl: suggestorAlias.profilePictureUrl,
                }
            })
            .from(entries)
            .innerJoin(suggestorAlias, eq(entries.suggestedByUserId, suggestorAlias.id))
            .where(and(eq(entries.userId, userId), isNotNull(entries.suggestedByUserId)));

        // 3. Fetch user's watchlist items that have suggestedByUserId
        const userWatchlist = await db.query.lists.findFirst({
            where: and(eq(lists.userId, userId), eq(lists.name, 'Watchlist')),
            with: {
                items: {
                    where: isNotNull(listItems.suggestedByUserId),
                    with: {
                        suggestedByUser: {
                            columns: {
                                id: true,
                                username: true,
                                displayName: true,
                                profilePictureUrl: true,
                            }
                        }
                    }
                }
            }
        });

        const watchlistSuggestedItems = userWatchlist?.items || [];

        const recommenderMap = new Map<string, {
            user: { id: string; username: string; displayName: string | null; profilePictureUrl: string | null };
            suggestedCount: number;
            watchedCount: number;
            currentlyWatchingCount: number;
            ratings: number[];
            highHitCount: number;
        }>();

        receivedSuggestions.forEach(s => {
            if (!s.fromUser || !s.fromUserId) return;
            if (!recommenderMap.has(s.fromUserId)) {
                recommenderMap.set(s.fromUserId, {
                    user: s.fromUser,
                    suggestedCount: 0,
                    watchedCount: 0,
                    currentlyWatchingCount: 0,
                    ratings: [],
                    highHitCount: 0,
                });
            }
            recommenderMap.get(s.fromUserId)!.suggestedCount++;
        });

        suggestedEntries.forEach(e => {
            if (!e.suggestor || !e.suggestedByUserId) return;
            if (!recommenderMap.has(e.suggestedByUserId)) {
                recommenderMap.set(e.suggestedByUserId, {
                    user: e.suggestor,
                    suggestedCount: 0,
                    watchedCount: 0,
                    currentlyWatchingCount: 0,
                    ratings: [],
                    highHitCount: 0,
                });
            }
            const stats = recommenderMap.get(e.suggestedByUserId)!;
            stats.watchedCount++;
            if (e.isWatching) stats.currentlyWatchingCount++;

            if (e.rating) {
                const r = parseFloat(e.rating);
                if (r > 0) {
                    stats.ratings.push(r);
                    if (r >= 8.0) stats.highHitCount++;
                }
            }
        });

        watchlistSuggestedItems.forEach(item => {
            if (!item.suggestedByUser || !item.suggestedByUserId) return;
            if (!recommenderMap.has(item.suggestedByUserId)) {
                recommenderMap.set(item.suggestedByUserId, {
                    user: item.suggestedByUser,
                    suggestedCount: 0,
                    watchedCount: 0,
                    currentlyWatchingCount: 0,
                    ratings: [],
                    highHitCount: 0,
                });
            }
            const stats = recommenderMap.get(item.suggestedByUserId)!;
            stats.suggestedCount = Math.max(stats.suggestedCount, stats.watchedCount + 1);
        });

        const C = 3; // Empirical Bayesian prior confidence weight
        const M = globalUserRating > 0 ? globalUserRating : 7.2;

        const recommendersList = Array.from(recommenderMap.values()).map(r => {
            const totalSuggested = Math.max(r.suggestedCount, r.watchedCount);
            const conversionRate = totalSuggested > 0 ? Math.round((r.watchedCount / totalSuggested) * 100) : 0;
            const rawAvgRating = r.ratings.length > 0
                ? parseFloat((r.ratings.reduce((a, b) => a + b, 0) / r.ratings.length).toFixed(1))
                : null;

            // Bayesian smoothed rating to prevent 1-hit sample bias
            const smoothedRating = r.ratings.length > 0
                ? parseFloat(((r.watchedCount * (rawAvgRating || M) + C * M) / (r.watchedCount + C)).toFixed(1))
                : parseFloat(M.toFixed(1));

            // Trust Score (0 - 100) combining conversion velocity, smoothed rating, and sample damping
            const sampleFactor = Math.min(1.0, r.watchedCount / 2);
            const trustScore = Math.round(
                ((0.40 * (conversionRate / 100)) + (0.60 * (smoothedRating / 10))) * sampleFactor * 100
            );

            let badge = 'Film Friend';
            if (trustScore >= 75 && r.watchedCount >= 2) badge = '🏆 Golden Compass';
            else if (rawAvgRating && rawAvgRating >= M + 0.8 && r.watchedCount >= 2) badge = '🎯 Precision Tastemaker';
            else if (conversionRate >= 60 && r.watchedCount >= 2) badge = '🤝 Faithful Pitcher';
            else if (r.watchedCount >= 3) badge = '🔥 Trend Setter';

            return {
                userId: r.user.id,
                username: r.user.username,
                displayName: r.user.displayName,
                profilePictureUrl: resolveAvatarUrl(r.user.profilePictureUrl),
                totalSuggested,
                watchedCount: r.watchedCount,
                currentlyWatchingCount: r.currentlyWatchingCount,
                conversionRate,
                avgRating: rawAvgRating,
                smoothedRating,
                trustScore,
                highHitCount: r.highHitCount,
                influenceScore: trustScore, // Maintain backwards compatibility
                badge,
            };
        }).sort((a, b) => b.trustScore - a.trustScore);

        const totalSuggestionsReceived = recommendersList.reduce((acc, r) => acc + r.totalSuggested, 0);
        const totalSuggestionsWatched = recommendersList.reduce((acc, r) => acc + r.watchedCount, 0);
        const overallConversionRate = totalSuggestionsReceived > 0
            ? Math.round((totalSuggestionsWatched / totalSuggestionsReceived) * 100)
            : 0;

        const topInfluencer = recommendersList[0] || null;
        const bestTasteMatch = [...recommendersList]
            .filter(r => r.avgRating !== null)
            .sort((a, b) => (b.avgRating || 0) - (a.avgRating || 0))[0] || null;

        const [suggestionsSent] = await db
            .select({ count: count() })
            .from(suggestions)
            .where(eq(suggestions.fromUserId, userId));

        return {
            summary: {
                totalSuggestionsReceived,
                totalSuggestionsWatched,
                overallConversionRate,
                topInfluencerName: topInfluencer ? (topInfluencer.displayName || topInfluencer.username) : null,
                topInfluencerUsername: topInfluencer ? topInfluencer.username : null,
                bestTasteMatchUsername: bestTasteMatch ? bestTasteMatch.username : null,
            },
            recommenders: recommendersList.slice(0, 5),
            outgoingImpact: {
                totalSent: suggestionsSent?.count || 0,
            }
        };
    } catch (err) {
        console.error('Error computing suggestion analytics:', err);
        return {
            summary: {
                totalSuggestionsReceived: 0,
                totalSuggestionsWatched: 0,
                overallConversionRate: 0,
                topInfluencerName: null,
                topInfluencerUsername: null,
                bestTasteMatchUsername: null,
            },
            recommenders: [],
            outgoingImpact: { totalSent: 0 }
        };
    }
}

/**
 * Compute behavioral traits across entire watch history
 */
function computeBehavioralTrails(allEntries: any[]) {
    const total = allEntries.length;
    if (total === 0) return [];

    const rewatchCount = allEntries.filter(e => e.isRewatch).length;
    const rewatchRatio = Math.round((rewatchCount / total) * 100);

    let ratedSum = 0;
    let ratedCount = 0;
    let reviewCount = 0;

    allEntries.forEach(e => {
        if (e.rating) {
            ratedSum += parseFloat(e.rating);
            ratedCount++;
        }
        if (e.review && e.review.trim().length > 20) {
            reviewCount++;
        }
    });

    const avgRating = ratedCount > 0 ? (ratedSum / ratedCount).toFixed(1) : '7.0';
    const reviewRatio = Math.round((reviewCount / total) * 100);

    return [
        {
            title: 'Rewatch Reliance',
            value: `${rewatchRatio}%`,
            subtitle: rewatchRatio > 25 ? 'High Comfort Seeker' : 'Fresh Explorer',
            description: rewatchRatio > 25
                ? 'You frequently revisit trusted favorites for emotional grounding and comfort.'
                : 'You actively prioritize new stories and novel experiences over rewatching.',
            icon: 'loop',
            color: '#3b82f6',
        },
        {
            title: 'Critical Rigor',
            value: `${avgRating} ★`,
            subtitle: parseFloat(avgRating) < 6.5 ? 'Strict Judge' : (parseFloat(avgRating) > 8.0 ? 'Generous Enthusiast' : 'Balanced Critic'),
            description: parseFloat(avgRating) < 6.5
                ? 'You hold cinema to high standards and reserve top marks for true masterpieces.'
                : 'You find joy and appreciation in most movies you log.',
            icon: 'star',
            color: '#eab308',
        },
        {
            title: 'Review Depth',
            value: `${reviewRatio}%`,
            subtitle: reviewRatio > 30 ? 'Active Analyst' : 'Casual Observer',
            description: reviewRatio > 30
                ? 'You regularly reflect on what you watch by writing reviews and notes.'
                : 'You prefer quick logging without heavy written analysis.',
            icon: 'edit_note',
            color: '#10b981',
        },
        {
            title: 'Catalog Scale',
            value: `${total} Titles`,
            subtitle: total > 50 ? 'Seasoned Cinephile' : 'Growing Vault',
            description: `You have logged ${total} entries in your WatchHive history.`,
            icon: 'video_library',
            color: '#ec4899',
        },
    ];
}

/**
 * Dynamic Achievement Badges Evaluator
 */
function evaluateUserBadges(allEntries: any[]) {
    const total = allEntries.length;
    const nightOwlCount = allEntries.filter(e => {
        const h = new Date(e.watchedAt).getHours();
        return h >= 22 || h < 4;
    }).length;

    const rewatchCount = allEntries.filter(e => e.isRewatch).length;
    const reviewCount = allEntries.filter(e => e.review && e.review.trim().length > 30).length;

    const dateCounts: Record<string, number> = {};
    allEntries.forEach(e => {
        const d = new Date(e.watchedAt).toISOString().split('T')[0];
        dateCounts[d] = (dateCounts[d] || 0) + 1;
    });

    const maxInSingleDay = Math.max(...Object.values(dateCounts), 0);

    const uniqueGenres = new Set<string>();
    allEntries.forEach(e => {
        if (e.tags && Array.isArray(e.tags)) {
            e.tags.forEach((t: string) => uniqueGenres.add(t.toLowerCase().trim()));
        }
    });

    let ratingSum = 0;
    let ratedCount = 0;
    allEntries.forEach(e => {
        if (e.rating) {
            ratingSum += parseFloat(e.rating);
            ratedCount++;
        }
    });
    const avgRating = ratedCount > 0 ? ratingSum / ratedCount : 7.0;

    return [
        {
            id: 'hive_legend',
            title: 'Hive Titan',
            description: 'Log 50+ total movies or TV shows',
            icon: 'emoji_events',
            color: 'from-amber-400 to-yellow-600',
            isUnlocked: total >= 50,
            progress: total,
            target: 50,
        },
        {
            id: 'night_owl',
            title: 'Night Owl',
            description: 'Log 5+ entries late at night (10 PM - 4 AM)',
            icon: 'bedtime',
            color: 'from-purple-500 to-indigo-700',
            isUnlocked: nightOwlCount >= 5,
            progress: nightOwlCount,
            target: 5,
        },
        {
            id: 'binge_marathoner',
            title: 'Binge Marathoner',
            description: 'Watch 3+ titles in a single day',
            icon: 'bolt',
            color: 'from-[#ffb700] to-orange-500',
            isUnlocked: maxInSingleDay >= 3,
            progress: maxInSingleDay,
            target: 3,
        },
        {
            id: 'cinephile_critic',
            title: 'Cinephile Critic',
            description: 'Write 5+ detailed reviews',
            icon: 'rate_review',
            color: 'from-emerald-400 to-teal-600',
            isUnlocked: reviewCount >= 5,
            progress: reviewCount,
            target: 5,
        },
        {
            id: 'genre_polymath',
            title: 'Genre Polymath',
            description: 'Explore 6+ distinct genres',
            icon: 'category',
            color: 'from-pink-500 to-rose-600',
            isUnlocked: uniqueGenres.size >= 6,
            progress: uniqueGenres.size,
            target: 6,
        },
        {
            id: 'comfort_rewatcher',
            title: 'Comfort Rewatcher',
            description: 'Log 3+ rewatched titles',
            icon: 'autorenew',
            color: 'from-blue-400 to-indigo-600',
            isUnlocked: rewatchCount >= 3,
            progress: rewatchCount,
            target: 3,
        },
        {
            id: 'discerning_critic',
            title: 'Discerning Critic',
            description: 'Average rating below 6.5 (High Standards)',
            icon: 'gavel',
            color: 'from-[#2D2926] to-[#ffb700]',
            isUnlocked: ratedCount >= 5 && avgRating < 6.5,
            progress: ratedCount >= 5 ? 1 : 0,
            target: 1,
        },
        {
            id: 'pure_optimist',
            title: 'Pure Optimist',
            description: 'Average rating above 8.0 across 5+ logs',
            icon: 'sentiment_very_satisfied',
            color: 'from-amber-300 to-yellow-500',
            isUnlocked: ratedCount >= 5 && avgRating >= 8.0,
            progress: ratedCount >= 5 ? 1 : 0,
            target: 1,
        },
    ];
}

/**
 * Generate daily time-series watch frequency for the last 30 days
 */
function computeDailyTimeSeries(allEntries: any[]) {
    const days: { date: string; count: number; items: any[] }[] = [];
    const now = new Date();

    for (let i = 29; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];

        const dayEntries = allEntries.filter(e => {
            const entryDate = new Date(e.watchedAt).toISOString().split('T')[0];
            return entryDate === dateStr;
        });

        days.push({
            date: dateStr,
            count: dayEntries.length,
            items: dayEntries.map(e => ({
                id: e.id,
                title: e.title,
                type: e.type,
                rating: e.rating,
                watchedAt: e.watchedAt,
            })),
        });
    }

    return days;
}

/**
 * GET /api/v1/mindlens/insights
 */
router.get('/insights', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.user!.userId;

        // Fetch user watch history (up to 1,000 entries)
        const userEntries = await db
            .select({
                id: entries.id,
                title: entries.title,
                type: entries.type,
                watchedAt: entries.watchedAt,
                tags: entries.tags,
                rating: entries.rating,
                review: entries.review,
                isRewatch: entries.isRewatch,
                tmdbId: entries.tmdbId,
            })
            .from(entries)
            .where(eq(entries.userId, userId))
            .orderBy(desc(entries.watchedAt))
            .limit(1000);

        // Milestone Stage Determination
        const totalEntries = userEntries.length;
        if (totalEntries < 3) {
            res.json({
                hasEnoughData: false,
                milestoneStage: 'CALIBRATING',
                calibrationProgress: { current: totalEntries, target: 5 },
                message: "Need at least 3 watch entries to compute your MindLens profile."
            });
            return;
        }

        const milestoneStage = totalEntries < 5 ? 'CALIBRATING' : (totalEntries < 15 ? 'FOUNDATIONAL' : 'FULL');

        // 1. Taste Entropy & Genre Dispersion
        const tasteBreadth = computeTasteEntropy(userEntries);

        // 2. Critical Rigor & Standard Deviation
        const criticalRigor = computeCriticalRigor(userEntries);

        // 3. Affective State (Russell's Circumplex Model) over last 7 watches
        const affectiveState = computeAffectiveState(userEntries);

        // 4. Recommender Network & Social Suggestion Concordance
        const suggestionAnalytics = await computeSuggestionAnalytics(userId, criticalRigor.averageRating);

        // 5. Cognitive Archetype Selection
        const selectedArchetype = determineCognitiveArchetype(userEntries, tasteBreadth, criticalRigor, suggestionAnalytics);

        // 6. Time of Day Distribution
        const timeOfDay = { morning: 0, afternoon: 0, evening: 0, night: 0 };
        userEntries.forEach(entry => {
            const hour = new Date(entry.watchedAt).getHours();
            if (hour >= 5 && hour < 12) timeOfDay.morning++;
            else if (hour >= 12 && hour < 17) timeOfDay.afternoon++;
            else if (hour >= 17 && hour < 22) timeOfDay.evening++;
            else timeOfDay.night++;
        });

        // 7. Behavioral Trails, Badges, and Time Series
        const behavioralTrails = computeBehavioralTrails(userEntries);
        const badges = evaluateUserBadges(userEntries);
        const dailyTimeSeries = computeDailyTimeSeries(userEntries);

        // 8. Generate Observational Insights (Epistemic Humility)
        const insights: string[] = [];

        // Breadth insight
        insights.push(`Your catalog reflects **${tasteBreadth.label}** (${Math.round(tasteBreadth.normalizedBreadth * 100)}% Taste Breadth) with ${tasteBreadth.description.toLowerCase()}`);

        // Affective insight
        insights.push(`Recent watches indicate an **${affectiveState.mood}** cycle (${affectiveState.status}) across titles like *${affectiveState.recentTitles.slice(0, 2).join('*, *')}*.`);

        // Recommender insight
        if (suggestionAnalytics.summary.topInfluencerUsername) {
            const topTastemaker = suggestionAnalytics.recommenders[0];
            const badgeStr = topTastemaker?.badge ? ` (${topTastemaker.badge})` : '';
            insights.push(`**@${suggestionAnalytics.summary.topInfluencerUsername}**${badgeStr} is your leading taste influence with a **${topTastemaker?.conversionRate || 0}%** conversion velocity.`);
        }

        // Circadian insight
        if (timeOfDay.night > (totalEntries * 0.35)) {
            insights.push("You consistently gravitate toward late-night viewing (10 PM - 4 AM) for focused personal decompression.");
        } else if (timeOfDay.evening > (totalEntries * 0.45)) {
            insights.push("Evening prime-time is your primary cinematic window to unwind and transition from the day.");
        }

        // Backwards compatibility persona structure
        const persona = {
            name: selectedArchetype.name,
            tagline: selectedArchetype.tagline,
            description: selectedArchetype.description,
            icon: selectedArchetype.icon,
            color: selectedArchetype.color,
            scientificBasis: selectedArchetype.scientificBasis,
            traits: selectedArchetype.coreTraits,
            imageUrl: '',
        };

        res.json({
            hasEnoughData: true,
            milestoneStage,
            calibrationProgress: { current: totalEntries, target: 15 },
            userProfile: {
                totalEntries,
                primaryMood: affectiveState.mood,
                tasteBreadth,
                criticalRigor,
            },
            persona,
            archetype: selectedArchetype,
            tasteBreadth,
            affectiveState,
            moodPrediction: affectiveState, // Maintain backwards compatibility
            criticalRigor,
            behavioralTrails,
            badges,
            dailyTimeSeries,
            suggestionAnalytics,
            themes: tasteBreadth.genreDistribution.map(g => ({ name: g.genre, score: g.weight })),
            timeDistribution: timeOfDay,
            insights,
            generatedAt: new Date(),
        });

    } catch (error) {
        console.error('MindLens Analysis Error:', error);
        res.status(500).json({ error: 'Failed to generate MindLens insights' });
    }
});

export default router;
