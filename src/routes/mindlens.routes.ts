import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { db } from '../db/index.js';
import { entries } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';

const router = Router();

// Genre to Psychological Theme Mapping
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

const MOOD_MAP: Record<string, string> = {
    'Comedy': 'Lighthearted',
    'Animation': 'Lighthearted',
    'Family': 'Lighthearted',
    'Horror': 'Tense',
    'Thriller': 'Tense',
    'Mystery': 'Tense',
    'Crime': 'Tense',
    'Drama': 'Reflective',
    'History': 'Reflective',
    'Documentary': 'Reflective',
    'War': 'Reflective',
    'Action': 'Excited',
    'Adventure': 'Excited',
    'Sci-Fi': 'Excited',
    'Science Fiction': 'Excited',
    'Fantasy': 'Excited',
    'Romance': 'Sentimental',
    'Music': 'Sentimental',
};

const SOUL_PERSONAS = [
    {
        name: 'The Contract Killer',
        description: 'Cold, calculated, and high-stakes. You prefer narratives where every choice is a life-or-death decision.',
        icon: '🎯',
        imageUrl: 'https://i.giphy.com/media/l3q2wJsC23ikJg9xe/giphy.gif',
        color: '#ef4444',
        criteria: { themes: ['Justice & Order Seeking', 'Suspense & Stimulation'], moods: ['Tense'] }
    },
    {
        name: 'The Sharp Lawyer',
        description: 'Analytical and sharp-witted. You love dissecting arguments and finding the elusive truth in complex dramas.',
        icon: '⚖️',
        imageUrl: 'https://i.giphy.com/media/l0EwYGlvQ7STj3mNy/giphy.gif',
        color: '#3b82f6',
        criteria: { themes: ['Justice & Order Seeking', 'Context & Perspective'], moods: ['Reflective'] }
    },
    {
        name: 'The Master Judge',
        description: 'Moral clarity and heavy decisions. You gravitate towards stories that explore right, wrong, and the gray areas in between.',
        icon: '👨‍⚖️',
        imageUrl: 'https://i.giphy.com/media/1lAOemoi0KhPMzxczT/giphy.gif',
        color: '#6b7280',
        criteria: { themes: ['Justice & Order Seeking', 'History'], moods: ['Reflective'] }
    },
    {
        name: 'The Wise Teacher',
        description: 'Always seeking knowledge. You view cinema as a lens to learn about the complexities of history and human nature.',
        icon: '🎓',
        imageUrl: 'https://i.giphy.com/media/PudZiAbQDUEik/giphy.gif',
        color: '#10b981',
        criteria: { themes: ['Intellectual Curiosity', 'Context & Perspective'], moods: ['Reflective'] }
    },
    {
        name: 'The Creator God',
        description: 'Limitless imagination. You love sprawling worlds that defy reality and the visionary minds that build them.',
        icon: '⚛️',
        imageUrl: 'https://i.giphy.com/media/BqiGk3yGk7f12/giphy.gif',
        color: '#d946ef',
        criteria: { themes: ['Escapism & Creativity', 'Imagination & Playfulness'], moods: ['Lighthearted', 'Excited'] }
    },
    {
        name: 'The Vengeful Batman',
        description: 'You are a guardian of the shadows. Justice, grit, and the complex morality of the night guide your viewing.',
        icon: '🦇',
        imageUrl: 'https://i.giphy.com/media/l396BoOTIFem9xqUM/giphy.gif',
        color: '#1e293b',
        criteria: { themes: ['Justice & Order Seeking', 'Adrenaline Seeking'], moods: ['Tense'] }
    },
    {
        name: 'The Agent of Chaos',
        description: 'You enjoy the unpredictability of it all. High adrenaline and suspense keep you coming back for more.',
        icon: '🤡',
        imageUrl: 'https://i.giphy.com/media/F9yAvk7Xpr0c/giphy.gif',
        color: '#8b5cf6',
        criteria: { themes: ['Thrill Seeking', 'Adrenaline Seeking'], moods: ['Excited'] }
    },
    {
        name: 'The Ancient Vampire',
        description: 'Gothic, immortal, and elegantly dark. You prefer stories that transcend time and explore the seductive side of danger.',
        icon: '🧛',
        imageUrl: 'https://i.giphy.com/media/cjKfH7n0R8XaDPwlV0/giphy.gif',
        color: '#991b1b',
        criteria: { themes: ['Thrill Seeking', 'Escapism & Creativity'], moods: ['Tense', 'Sentimental'] }
    },
    {
        name: 'The Sandman',
        description: 'Lord of Dreams. Surreal, philosophical, and atmospheric narratives are where your mind truly feels at home.',
        icon: '⏳',
        imageUrl: 'https://i.giphy.com/media/mguPrVJAnEHIY/giphy.gif',
        color: '#0ea5e9',
        criteria: { themes: ['Imagination & Playfulness', 'Future-Oriented Thinking'], moods: ['Reflective'] }
    },
    {
        name: 'The Mamba Mentality',
        description: 'Relentless focus and competitive fire. You are drawn to stories of triumph, failure, and the obsession with greatness.',
        icon: '🐍',
        imageUrl: 'https://i.giphy.com/media/xT1XGT9ersM295XGgw/giphy.gif',
        color: '#eab308',
        criteria: { themes: ['Intensity & Conflict Awareness', 'Adrenaline Seeking'], moods: ['Excited'] }
    },
    {
        name: 'The Smooth Soul',
        description: 'Aesthetic, rhythmic, and high-vibing. You prioritize visual and auditory beauty in every cinematic experience.',
        icon: '🎶',
        imageUrl: 'https://i.giphy.com/media/xT0BKk9aPtLzKJiRx6/giphy.gif',
        color: '#22c55e',
        criteria: { themes: ['Aesthetic Appreciation', 'Stress Relief & Optimism'], moods: ['Lighthearted'] }
    },
    {
        name: 'The Devilish Rebel',
        description: 'You are drawn to the dark side of ambition and the seductive power of rebellion. Rules are just suggestions to you.',
        icon: '😈',
        imageUrl: 'https://i.giphy.com/media/P7JmDW7IkB7TW/giphy.gif',
        color: '#f43f5e',
        criteria: { themes: ['Thrill Seeking', 'Intensity & Conflict Awareness'], moods: ['Excited', 'Tense'] }
    },
];

/**
 * Predict current mental state/mood based on recent watch history (last 5-7 items)
 */
function computeCurrentMoodPrediction(recentEntries: any[]) {
    if (!recentEntries || recentEntries.length === 0) {
        return {
            mood: 'Neutral Baseline',
            status: 'Calm & Steady',
            description: 'Not enough recent logs to detect an active emotional shift.',
            icon: '🧘',
            confidence: 50,
            recentTitles: [],
        };
    }

    const recentTags: string[] = [];
    let ratingSum = 0;
    let ratedCount = 0;

    recentEntries.forEach(e => {
        if (e.tags && Array.isArray(e.tags)) {
            recentTags.push(...e.tags);
        }
        if (e.rating) {
            ratingSum += parseFloat(e.rating);
            ratedCount++;
        }
    });

    const genreCounts: Record<string, number> = {};
    recentTags.forEach(t => {
        const norm = t.toLowerCase().trim();
        for (const genre of Object.keys(GENRE_THEMES)) {
            if (norm.includes(genre.toLowerCase())) {
                genreCounts[genre] = (genreCounts[genre] || 0) + 1;
            }
        }
    });

    const topGenre = Object.entries(genreCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Drama';
    const avgRecentRating = ratedCount > 0 ? ratingSum / ratedCount : 7.0;
    const recentTitles = recentEntries.slice(0, 4).map(e => e.title);

    // Mood heuristics based on recent genre & rating intensity
    if (['Comedy', 'Animation', 'Family'].includes(topGenre)) {
        return {
            mood: 'Lighthearted & Recharging',
            status: 'Seeking Positive Energy',
            description: 'Your recent watches show a desire for comfort, laughter, and mental decompression.',
            icon: '☀️',
            confidence: 88,
            recentTitles,
        };
    } else if (['Horror', 'Thriller', 'Mystery', 'Crime'].includes(topGenre)) {
        return {
            mood: 'High-Alert Thrill Seeking',
            status: 'Adrenaline & Tension Processing',
            description: 'You are gravitating towards suspenseful and high-stakes narratives to stimulate focus.',
            icon: '⚡️',
            confidence: 92,
            recentTitles,
        };
    } else if (['Action', 'Adventure', 'Sci-Fi', 'Science Fiction'].includes(topGenre)) {
        return {
            mood: 'Excited & Action-Oriented',
            status: 'High Energy & Escapism',
            description: 'Driven by momentum, big ideas, and immersive cinematic worlds.',
            icon: '🚀',
            confidence: 85,
            recentTitles,
        };
    } else if (['Documentary', 'History', 'War'].includes(topGenre)) {
        return {
            mood: 'Intellectual & Reflective',
            status: 'Knowledge & Truth Seeking',
            description: 'You are in an analytical state, seeking deeper context and real-world understanding.',
            icon: '🧠',
            confidence: 90,
            recentTitles,
        };
    } else if (avgRecentRating >= 8.5) {
        return {
            mood: 'Deeply Inspired',
            status: 'High Cinematic Resonance',
            description: 'Your recent watches have struck a powerful emotional chord, leaving you captivated.',
            icon: '✨',
            confidence: 94,
            recentTitles,
        };
    } else {
        return {
            mood: 'Emotional Exploration',
            status: 'Contemplative & Empathetic',
            description: 'Engaging with nuanced, character-driven stories to process subtle emotions.',
            icon: '🌊',
            confidence: 82,
            recentTitles,
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

    const traits = [
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

    return traits;
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

    // Dates map for binge / streak check
    const dateCounts: Record<string, number> = {};
    allEntries.forEach(e => {
        const d = new Date(e.watchedAt).toISOString().split('T')[0];
        dateCounts[d] = (dateCounts[d] || 0) + 1;
    });

    const maxInSingleDay = Math.max(...Object.values(dateCounts), 0);

    // Genre count
    const uniqueGenres = new Set<string>();
    allEntries.forEach(e => {
        if (e.tags && Array.isArray(e.tags)) {
            e.tags.forEach((t: string) => uniqueGenres.add(t.toLowerCase().trim()));
        }
    });

    // Rating average
    let ratingSum = 0;
    let ratedCount = 0;
    allEntries.forEach(e => {
        if (e.rating) {
            ratingSum += parseFloat(e.rating);
            ratedCount++;
        }
    });
    const avgRating = ratedCount > 0 ? ratingSum / ratedCount : 7.0;

    const badges = [
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

    return badges;
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

        // Fetch entire watch history (up to 1,000 entries for deep behavioral analysis)
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

        if (userEntries.length < 3) {
            res.json({
                hasEnoughData: false,
                message: "Need at least 3 watch entries to compute your MindLens profile."
            });
            return;
        }

        // 1. Theme & Mood Counts across entire history
        const themeCounts: Record<string, number> = {};
        const moodCounts: Record<string, number> = {};
        const normalize = (s: string) => s.toLowerCase().trim();

        userEntries.forEach(entry => {
            if (entry.tags && Array.isArray(entry.tags)) {
                entry.tags.forEach(tag => {
                    for (const [genre, theme] of Object.entries(GENRE_THEMES)) {
                        if (normalize(tag).includes(normalize(genre)) || normalize(genre).includes(normalize(tag))) {
                            themeCounts[theme] = (themeCounts[theme] || 0) + 1;
                        }
                    }
                    for (const [genre, mood] of Object.entries(MOOD_MAP)) {
                        if (normalize(tag).includes(normalize(genre)) || normalize(genre).includes(normalize(tag))) {
                            moodCounts[mood] = (moodCounts[mood] || 0) + 1;
                        }
                    }
                });
            }
        });

        // 2. Time of Day Distribution
        const timeOfDay = { morning: 0, afternoon: 0, evening: 0, night: 0 };
        userEntries.forEach(entry => {
            const hour = new Date(entry.watchedAt).getHours();
            if (hour >= 5 && hour < 12) timeOfDay.morning++;
            else if (hour >= 12 && hour < 17) timeOfDay.afternoon++;
            else if (hour >= 17 && hour < 22) timeOfDay.evening++;
            else timeOfDay.night++;
        });

        // 3. Top Themes & Moods
        const topThemes = Object.entries(themeCounts).sort((a, b) => b[1] - a[1]).slice(0, 4);
        const topMoods = Object.entries(moodCounts).sort((a, b) => b[1] - a[1]).slice(0, 2);

        // 4. Soul Persona Assignment
        let selectedPersona = SOUL_PERSONAS[0];
        let maxPersonaScore = -1;
        const currentThemes = topThemes.map(t => t[0]);
        const currentMoods = topMoods.map(m => m[0]);

        SOUL_PERSONAS.forEach(persona => {
            let score = 0;
            persona.criteria.themes.forEach(t => {
                if (currentThemes.includes(t)) score += 2;
            });
            persona.criteria.moods.forEach(m => {
                if (currentMoods.includes(m)) score += 1;
            });

            if (score > maxPersonaScore) {
                maxPersonaScore = score;
                selectedPersona = persona;
            }
        });

        // 5. Predict Current Mental State / Mood from Recent Watches (last 7 entries)
        const recentEntries = userEntries.slice(0, 7);
        const moodPrediction = computeCurrentMoodPrediction(recentEntries);

        // 6. Behavioral Trails & Badges
        const behavioralTrails = computeBehavioralTrails(userEntries);
        const badges = evaluateUserBadges(userEntries);
        const dailyTimeSeries = computeDailyTimeSeries(userEntries);

        // 7. Aesthetic Profile Palette
        const AESTHETIC_GENRES: Record<string, string[]> = {
            'Noir': ['Crime', 'Thriller', 'Mystery'],
            'Amber': ['History', 'Romance', 'Drama'],
            'Concrete': ['Documentary', 'War'],
            'Forest': ['Adventure', 'Fantasy', 'Family'],
            'Grit': ['Action', 'Horror'],
            'Void': ['Science Fiction', 'Sci-Fi'],
            'Neon': ['Animation', 'Music'],
            'Pastel': ['Comedy', 'TV Movie']
        };

        const aestheticCounts: Record<string, number> = {};
        Object.keys(AESTHETIC_GENRES).forEach(k => aestheticCounts[k] = 0);
        userEntries.forEach(entry => {
            if (entry.tags) {
                entry.tags.forEach(tag => {
                    for (const [aesthetic, genres] of Object.entries(AESTHETIC_GENRES)) {
                        if (genres.some(g => normalize(tag).includes(normalize(g)))) {
                            aestheticCounts[aesthetic]++;
                        }
                    }
                });
            }
        });

        let topAesthetics = Object.entries(aestheticCounts)
            .filter(a => a[1] > 0)
            .sort((a, b) => b[1] - a[1])
            .map(a => a[0]);

        const allAesthetics = Object.keys(AESTHETIC_GENRES);
        while (topAesthetics.length < 6) {
            const randomAes = allAesthetics[Math.floor(Math.random() * allAesthetics.length)];
            if (!topAesthetics.includes(randomAes)) topAesthetics.push(randomAes);
        }
        topAesthetics = topAesthetics.slice(0, 6);

        // 8. Generate Verbal Insights
        const insights: string[] = [];
        if (topThemes.length > 0) {
            insights.push(`Your overall viewing pattern leans strongly toward **${topThemes[0][0]}**.`);
        }
        if (timeOfDay.night > (userEntries.length * 0.35)) {
            insights.push("High late-night viewing detected. You tend to reclaim personal reflection time during late hours.");
        } else if (timeOfDay.morning > (userEntries.length * 0.25)) {
            insights.push("You integrate movie/TV watching into your morning routine to kickstart creative energy.");
        }

        res.json({
            hasEnoughData: true,
            userProfile: {
                totalEntries: userEntries.length,
                primaryMood: topMoods[0] ? topMoods[0][0] : 'Balanced',
            },
            persona: {
                name: selectedPersona.name,
                description: selectedPersona.description,
                icon: selectedPersona.icon,
                imageUrl: selectedPersona.imageUrl,
                color: selectedPersona.color
            },
            moodPrediction,
            behavioralTrails,
            badges,
            dailyTimeSeries,
            themes: topThemes.map(([name, score]) => ({ name, score })),
            timeDistribution: timeOfDay,
            insights,
            aesthetics: topAesthetics,
            generatedAt: new Date(),
        });

    } catch (error) {
        console.error('MindLens Analysis Error:', error);
        res.status(500).json({ error: 'Failed to generate MindLens insights' });
    }
});

export default router;
