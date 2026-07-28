import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import http from 'http';
import https from 'https';

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE_URL = 'https://api.tmdb.org/3';
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p';

export interface TMDbMovie {
  id: number;
  title: string;
  original_title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string;
  vote_average: number;
  vote_count: number;
  popularity: number;
  genre_ids: number[];
  adult: boolean;
  original_language: string;
  video: boolean;
}

export interface TMDbTVShow {
  id: number;
  name: string;
  original_name: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  first_air_date: string;
  vote_average: number;
  vote_count: number;
  popularity: number;
  genre_ids: number[];
  origin_country: string[];
  original_language: string;
}

export interface TMDbSearchResult {
  page: number;
  results: (TMDbMovie | TMDbTVShow)[];
  total_pages: number;
  total_results: number;
}

export interface TMDbWatchProvider {
  logo_path: string;
  provider_id: number;
  provider_name: string;
  display_priority: number;
}

export interface TMDbWatchProvidersResponse {
  results: Record<string, {
    link?: string;
    flatrate?: TMDbWatchProvider[];
    rent?: TMDbWatchProvider[];
    buy?: TMDbWatchProvider[];
    free?: TMDbWatchProvider[];
  }>;
}

export interface TMDbMovieDetails extends TMDbMovie {
  runtime: number | null;
  genres: { id: number; name: string }[];
  production_companies: { id: number; name: string; logo_path: string | null }[];
  tagline: string;
  status: string;
  budget: number;
  revenue: number;
  imdb_id: string | null;
  "watch/providers"?: TMDbWatchProvidersResponse;
}

export interface TMDbTVShowDetails extends TMDbTVShow {
  episode_run_time: number[];
  genres: { id: number; name: string }[];
  production_companies: { id: number; name: string; logo_path: string | null }[];
  tagline: string;
  status: string;
  number_of_seasons: number;
  number_of_episodes: number;
  "watch/providers"?: TMDbWatchProvidersResponse;
}

class TMDbService {
  private apiKey: string;
  private client: AxiosInstance;

  constructor() {
    if (!TMDB_API_KEY) {
      throw new Error('TMDB_API_KEY is not defined in environment variables');
    }
    this.apiKey = TMDB_API_KEY;

    // Create a dedicated axios instance with proper timeouts
    // and fresh connection handling to prevent ETIMEDOUT / ECONNRESET
    this.client = axios.create({
      baseURL: TMDB_BASE_URL,
      timeout: 3000, // 3 second timeout (fail fast instead of hanging)
      httpAgent: new http.Agent({ keepAlive: false }),
      httpsAgent: new https.Agent({ keepAlive: false }),
    });
  }

  /**
   * Internal helper: make a request with automatic retries on transient failures
   */
  private async requestWithRetry<T>(config: AxiosRequestConfig, retries = 1): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await this.client.request<T>({
          ...config,
          params: {
            api_key: this.apiKey,
            ...config.params,
          },
        });
        return response.data;
      } catch (error: any) {
        lastError = error;
        const code = error?.code || error?.cause?.code || '';
        const isRetryable = ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'ERR_SOCKET_CONNECTION_TIMEOUT'].includes(code)
          || (error?.response?.status === 429)  // rate limited
          || (error?.response?.status >= 500);  // server error

        // Don't retry on 404 Not Found
        if (error?.response?.status === 404) {
          throw error;
        }

        if (isRetryable && attempt < retries) {
          const delay = 1000;
          console.warn(`TMDb request failed (attempt ${attempt}/${retries}, code: ${code}). Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          break;
        }
      }
    }
    throw lastError;
  }

  /**
   * Search for movies by title
   */
  async searchMovies(query: string, page: number = 1): Promise<TMDbSearchResult> {
    try {
      return await this.requestWithRetry<TMDbSearchResult>({
        url: '/search/movie',
        params: { query, page, include_adult: false },
      });
    } catch (error) {
      console.error('Error searching movies:', error);
      throw new Error('Failed to search movies from TMDb');
    }
  }

  /**
   * Search for TV shows by title
   */
  async searchTVShows(query: string, page: number = 1): Promise<TMDbSearchResult> {
    try {
      return await this.requestWithRetry<TMDbSearchResult>({
        url: '/search/tv',
        params: { query, page, include_adult: false },
      });
    } catch (error) {
      console.error('Error searching TV shows:', error);
      throw new Error('Failed to search TV shows from TMDb');
    }
  }

  /**
   * Search for both movies and TV shows
   */
  async searchMulti(query: string, page: number = 1): Promise<TMDbSearchResult> {
    try {
      return await this.requestWithRetry<TMDbSearchResult>({
        url: '/search/multi',
        params: { query, page, include_adult: false },
      });
    } catch (error) {
      console.error('Error searching multi:', error);
      throw new Error('Failed to search from TMDb');
    }
  }

  /**
   * Get movie details by TMDb ID
   */
  async getMovieDetails(movieId: number): Promise<TMDbMovieDetails> {
    try {
      return await this.requestWithRetry<TMDbMovieDetails>({
        url: `/movie/${movieId}`,
        params: { append_to_response: 'watch/providers' },
      });
    } catch (error: any) {
      if (error?.response?.status === 404) {
        return null as any;
      }
      console.error('Error getting movie details:', error);
      throw new Error('Failed to get movie details from TMDb');
    }
  }

  /**
   * Get TV show details by TMDb ID
   */
  async getTVShowDetails(tvId: number): Promise<TMDbTVShowDetails> {
    try {
      return await this.requestWithRetry<TMDbTVShowDetails>({
        url: `/tv/${tvId}`,
        params: { append_to_response: 'watch/providers' },
      });
    } catch (error: any) {
      if (error?.response?.status === 404) {
        return null as any;
      }
      console.error('Error getting TV show details:', error);
      throw new Error('Failed to get TV show details from TMDb');
    }
  }

  /**
   * Get popular movies
   */
  async getPopularMovies(page: number = 1): Promise<TMDbSearchResult> {
    try {
      return await this.requestWithRetry<TMDbSearchResult>({
        url: '/movie/popular',
        params: { page },
      });
    } catch (error) {
      console.error('Error getting popular movies:', error);
      throw new Error('Failed to get popular movies from TMDb');
    }
  }

  /**
   * Get popular TV shows
   */
  async getPopularTVShows(page: number = 1): Promise<TMDbSearchResult> {
    try {
      return await this.requestWithRetry<TMDbSearchResult>({
        url: '/tv/popular',
        params: { page },
      });
    } catch (error) {
      console.error('Error getting popular TV shows:', error);
      throw new Error('Failed to get popular TV shows from TMDb');
    }
  }

  /**
   * Get trending movies/TV shows
   */
  async getTrending(mediaType: 'movie' | 'tv' | 'all' = 'all', timeWindow: 'day' | 'week' = 'week'): Promise<TMDbSearchResult> {
    try {
      return await this.requestWithRetry<TMDbSearchResult>({
        url: `/trending/${mediaType}/${timeWindow}`,
      });
    } catch (error) {
      console.error('Error getting trending:', error);
      throw new Error('Failed to get trending from TMDb');
    }
  }

  /**
   * Get movie recommendations based on a specific movie
   */
  async getMovieRecommendations(movieId: number, page: number = 1): Promise<TMDbSearchResult> {
    try {
      return await this.requestWithRetry<TMDbSearchResult>({
        url: `/movie/${movieId}/recommendations`,
        params: { page },
      });
    } catch (error) {
      console.error('Error getting movie recommendations:', error);
      throw new Error('Failed to get movie recommendations from TMDb');
    }
  }

  /**
   * Get TV show recommendations based on a specific TV show
   */
  async getTVShowRecommendations(tvId: number, page: number = 1): Promise<TMDbSearchResult> {
    try {
      return await this.requestWithRetry<TMDbSearchResult>({
        url: `/tv/${tvId}/recommendations`,
        params: { page },
      });
    } catch (error) {
      console.error('Error getting TV show recommendations:', error);
      throw new Error('Failed to get TV show recommendations from TMDb');
    }
  }

  /**
   * Discover movies by genre
   */
  async discoverMoviesByGenre(genreIds: number[], page: number = 1): Promise<TMDbSearchResult> {
    try {
      return await this.requestWithRetry<TMDbSearchResult>({
        url: '/discover/movie',
        params: { with_genres: genreIds.join(','), page, sort_by: 'popularity.desc' },
      });
    } catch (error) {
      console.error('Error discovering movies by genre:', error);
      throw new Error('Failed to discover movies from TMDb');
    }
  }

  /**
   * Deep Discover for Movies or TV Shows with rich filters
   */
  async discoverMedia(options: {
    mediaType?: 'movie' | 'tv' | 'all';
    year?: number;
    genreId?: number;
    sortBy?: string;
    page?: number;
    query?: string;
  }): Promise<TMDbSearchResult> {
    const { mediaType = 'movie', year, genreId, sortBy = 'popularity.desc', page = 1, query } = options;
    try {
      if (query && query.trim()) {
        if (mediaType === 'tv') {
          return await this.requestWithRetry<TMDbSearchResult>({
            url: '/search/tv',
            params: { query, page, first_air_date_year: year, include_adult: false },
          });
        } else if (mediaType === 'movie') {
          return await this.requestWithRetry<TMDbSearchResult>({
            url: '/search/movie',
            params: { query, page, primary_release_year: year, include_adult: false },
          });
        } else {
          return await this.searchMulti(query, page);
        }
      }

      const endpoint = mediaType === 'tv' ? '/discover/tv' : '/discover/movie';
      const params: Record<string, any> = {
        page,
        sort_by: sortBy,
        include_adult: false,
        'vote_count.gte': 5,
      };

      if (year) {
        if (mediaType === 'tv') {
          params.first_air_date_year = year;
        } else {
          params.primary_release_year = year;
        }
      }

      if (genreId) {
        params.with_genres = genreId;
      }

      return await this.requestWithRetry<TMDbSearchResult>({
        url: endpoint,
        params,
      });
    } catch (error) {
      console.error('Error in discoverMedia:', error);
      throw new Error('Failed to discover media from TMDb');
    }
  }

  /**
   * Get full image URL from path
   */
  getImageUrl(path: string | null, size: 'w92' | 'w154' | 'w185' | 'w342' | 'w500' | 'w780' | 'original' = 'w500'): string | null {
    if (!path) return null;
    return `${TMDB_IMAGE_BASE_URL}/${size}${path}`;
  }

  /**
   * Get poster URL
   */
  getPosterUrl(path: string | null, size: 'w92' | 'w154' | 'w185' | 'w342' | 'w500' | 'w780' | 'original' = 'w500'): string | null {
    return this.getImageUrl(path, size);
  }

  /**
   * Get backdrop URL
   */
  getBackdropUrl(path: string | null, size: 'w300' | 'w780' | 'w1280' | 'original' = 'w1280'): string | null {
    if (!path) return null;
    return `${TMDB_IMAGE_BASE_URL}/${size}${path}`;
  }
}

export default new TMDbService();
