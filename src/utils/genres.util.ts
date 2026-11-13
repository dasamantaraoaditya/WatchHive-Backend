export const TOP_GENRES = [
    'Action',
    'Adventure',
    'Animation',
    'Comedy',
    'Crime',
    'Documentary',
    'Drama',
    'Family',
    'Fantasy',
    'History',
    'Horror',
    'Music',
    'Mystery',
    'Romance',
    'Sci-Fi',
    'Thriller',
    'War',
    'Western',
] as const;

export type TopGenre = (typeof TOP_GENRES)[number];

export const GENRE_ALIAS_TO_TOP_GENRE: Record<string, TopGenre[]> = {
    'action': ['Action'],
    'action & adventure': ['Action', 'Adventure'],
    'adventure': ['Adventure'],
    'animation': ['Animation'],
    'anime': ['Animation'],
    'comedy': ['Comedy'],
    'crime': ['Crime'],
    'documentary': ['Documentary'],
    'drama': ['Drama'],
    'k-drama': ['Drama'],
    'kdrama': ['Drama'],
    'family': ['Family'],
    'kids': ['Family'],
    'fantasy': ['Fantasy'],
    'history': ['History'],
    'horror': ['Horror'],
    'music': ['Music'],
    'mystery': ['Mystery'],
    'romance': ['Romance'],
    'romantic': ['Romance'],
    'science fiction': ['Sci-Fi'],
    'sci-fi': ['Sci-Fi'],
    'sci-fi & fantasy': ['Sci-Fi', 'Fantasy'],
    'thriller': ['Thriller'],
    'tv movie': ['Drama'],
    'war': ['War'],
    'war & politics': ['War'],
    'western': ['Western'],
};

/**
 * Maps any list of raw genres/tags from TMDb or user tags to canonical TOP_GENRES
 */
export function mapToTopGenres(rawGenresOrTags?: string[] | null): TopGenre[] {
    if (!rawGenresOrTags || !Array.isArray(rawGenresOrTags)) return [];
    const matched = new Set<TopGenre>();
    for (const item of rawGenresOrTags) {
        if (!item || typeof item !== 'string') continue;
        const lower = item.trim().toLowerCase();
        const mapped = GENRE_ALIAS_TO_TOP_GENRE[lower];
        if (mapped) {
            mapped.forEach(g => matched.add(g));
        }
    }
    return Array.from(matched);
}
