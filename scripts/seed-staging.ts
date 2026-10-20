import bcrypt from 'bcryptjs';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../src/db/schema.js';

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:YZBpOrFTkcHeVLnGmGxTKiXmfFykzrAd@trolley.proxy.rlwy.net:37884/railway';

const pool = new pg.Pool({
    connectionString,
    ssl: connectionString.includes('railway') || connectionString.includes('supabase')
        ? { rejectUnauthorized: false }
        : false,
});

const db = drizzle(pool, { schema });

async function seed() {
    console.log('🌱 Starting staging database seeding...');

    // 1. Hash password for test accounts
    const passwordHash = await bcrypt.hash('TestPass123!', 10);

    // 2. Insert Users
    console.log('👤 Creating test users...');
    const userData = [
        {
            username: 'aditya_cinephile',
            email: 'aditya.test@watchershive.com',
            passwordHash,
            displayName: 'Aditya Cinephile',
            bio: 'Curating top sci-fi & psychological thrillers.',
            location: 'Bangalore, India',
            privacyLevel: 'PUBLIC' as const,
            xp: 1250,
            level: 5,
        },
        {
            username: 'maya_cinema',
            email: 'maya.test@watchershive.com',
            passwordHash,
            displayName: 'Maya Chen',
            bio: 'Indie films, anime, and arthouse cinema enthusiast.',
            location: 'Vancouver, Canada',
            privacyLevel: 'PUBLIC' as const,
            xp: 980,
            level: 4,
        },
        {
            username: 'alex_reviews',
            email: 'alex.test@watchershive.com',
            passwordHash,
            displayName: 'Alex Rivera',
            bio: 'Watching everything from Nolan to Studio Ghibli.',
            location: 'Austin, TX',
            privacyLevel: 'PUBLIC' as const,
            xp: 2400,
            level: 8,
        },
        {
            username: 'sarah_watches',
            email: 'sarah.test@watchershive.com',
            passwordHash,
            displayName: 'Sarah Jenkins',
            bio: 'Horror junkie & mystery enthusiast.',
            location: 'London, UK',
            privacyLevel: 'PUBLIC' as const,
            xp: 650,
            level: 3,
        },
        {
            username: 'raj_filmnerd',
            email: 'raj.test@watchershive.com',
            passwordHash,
            displayName: 'Rajesh Patel',
            bio: 'Cinematography matters most. Top 10 lists curator.',
            location: 'Mumbai, India',
            privacyLevel: 'PUBLIC' as const,
            xp: 1800,
            level: 6,
        },
    ];

    const createdUsers = await db.insert(schema.users).values(userData).returning();
    console.log(`✅ Created ${createdUsers.length} users.`);

    // 3. Insert Follows between users
    console.log('🤝 Creating social connections (follows)...');
    const u = createdUsers;
    const followPairs = [
        { followerId: u[0].id, followingId: u[1].id },
        { followerId: u[0].id, followingId: u[2].id },
        { followerId: u[1].id, followingId: u[0].id },
        { followerId: u[1].id, followingId: u[2].id },
        { followerId: u[2].id, followingId: u[0].id },
        { followerId: u[3].id, followingId: u[0].id },
        { followerId: u[4].id, followingId: u[0].id },
        { followerId: u[4].id, followingId: u[1].id },
    ];
    await db.insert(schema.follows).values(followPairs);
    console.log(`✅ Created ${followPairs.length} follow relationships.`);

    // 4. Sample Movies for Entries
    const movies = [
        { tmdbId: 157336, title: 'Interstellar', poster: '/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg', backdrop: '/xJHokMbljvjADYdit5fK5VQsXEG.jpg' },
        { tmdbId: 27205, title: 'Inception', poster: '/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg', backdrop: '/s3TBrRGB1iav7gFOCNx3H31MoES.jpg' },
        { tmdbId: 693134, title: 'Dune: Part Two', poster: '/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg', backdrop: '/xOMo8BRK7PfcJv9JCnx7s520Wio.jpg' },
        { tmdbId: 438631, title: 'Dune', poster: '/d5NXSklXo0qyIYkgV94XAgMIckC.jpg', backdrop: '/jYEW5xZkZk2WTrdbMGAPFuBqbDc.jpg' },
        { tmdbId: 872585, title: 'Oppenheimer', poster: '/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg', backdrop: '/fm6KqXpk3M2HVveHwCrBSSBaO0V.jpg' },
        { tmdbId: 77, title: 'Memento', poster: '/yuWy09772B57vWl7xO4K9b6t767.jpg', backdrop: '/bdE3wY4e9hF41L6eM2oZk3M3k4s.jpg' },
        { tmdbId: 155, title: 'The Dark Knight', poster: '/qJ2tW6WMUDux911r6m7haRef0WH.jpg', backdrop: '/nMKdUUepR0i5zn0y1T4CsSB5chy.jpg' },
        { tmdbId: 238, title: 'The Godfather', poster: '/3bhkrj58Vtu7enYsRolD1fZdja1.jpg', backdrop: '/tmU7GeKVybMWFButWEGl2M4GeiP.jpg' },
        { tmdbId: 429, title: 'The Good, the Bad and the Ugly', poster: '/bX2xnavhMYjWDoZp1VM6VnU1xwe.jpg', backdrop: '/eoCSp75lxgt2vsGdGQZ0hUmAsAn.jpg' },
        { tmdbId: 389, title: '12 Angry Men', poster: '/ow3wq89wM8qd5X7hWKxiRfsFf9C.jpg', backdrop: '/qqHQsStV6ta9FlTxQmgkJIRagUF.jpg' },
    ];

    // 5. Create Entries
    console.log('🎬 Creating movie watch entries...');
    const entryData = [];
    for (let i = 0; i < createdUsers.length; i++) {
        const user = createdUsers[i];
        for (let j = 0; j < 5; j++) {
            const movie = movies[(i + j) % movies.length];
            entryData.push({
                userId: user.id,
                tmdbId: movie.tmdbId,
                title: movie.title,
                type: 'MOVIE' as const,
                watchedAt: new Date(Date.now() - (i * 5 + j) * 86400000 * 2),
                rating: (7.5 + ((i + j) % 5) * 0.5).toFixed(1),
                review: `Stunning cinematic storytelling. The pacing and score kept me completely hooked. A must-watch for any serious fan of ${movie.title}.`,
                tags: ['Sci-Fi', 'Must-Watch', 'Masterpiece'],
                isRewatch: j === 0,
                watchLocation: 'Home Cinema',
                posterPath: movie.poster,
                backdropPath: movie.backdrop,
            });
        }
    }
    const createdEntries = await db.insert(schema.entries).values(entryData).returning();
    console.log(`✅ Created ${createdEntries.length} watch entries.`);

    // 6. Create Lists & Ranking Stacks
    console.log('📚 Creating Ranking Stacks & Lists...');
    const stack1 = await db.insert(schema.lists).values({
        userId: u[0].id,
        name: 'All-Time Mind-Bending Sci-Fi',
        description: 'My personal report card of transcendent sci-fi masterpieces.',
        type: 'RANKING_STACK',
        privacyLevel: 'PUBLIC',
    }).returning();

    const stack2 = await db.insert(schema.lists).values({
        userId: u[1].id,
        name: 'Top 5 Modern Masterpieces',
        description: 'Films released in the last decade that define cinema.',
        type: 'RANKING_STACK',
        privacyLevel: 'PUBLIC',
    }).returning();

    // Insert Stack Items
    const stackItems = [
        { listId: stack1[0].id, tmdbId: 157336, mediaType: 'movie', orderIndex: 1 },
        { listId: stack1[0].id, tmdbId: 27205, mediaType: 'movie', orderIndex: 2 },
        { listId: stack1[0].id, tmdbId: 693134, mediaType: 'movie', orderIndex: 3 },
        { listId: stack1[0].id, tmdbId: 872585, mediaType: 'movie', orderIndex: 4 },
        { listId: stack2[0].id, tmdbId: 872585, mediaType: 'movie', orderIndex: 1 },
        { listId: stack2[0].id, tmdbId: 693134, mediaType: 'movie', orderIndex: 2 },
        { listId: stack2[0].id, tmdbId: 238, mediaType: 'movie', orderIndex: 3 },
    ];
    await db.insert(schema.listItems).values(stackItems);
    console.log(`✅ Created 2 stacks with ${stackItems.length} items.`);

    // 7. Create Suggestions
    console.log('💡 Creating movie suggestions between users...');
    const suggestionData = [
        {
            fromUserId: u[1].id,
            toUserId: u[0].id,
            tmdbId: 693134,
            mediaType: 'movie',
            title: 'Dune: Part Two',
            comment: 'You love Interstellar, you will be blown away by the sound design in Dune 2!',
            status: 'ACCEPTED' as const,
            posterPath: '/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg',
        },
        {
            fromUserId: u[2].id,
            toUserId: u[0].id,
            tmdbId: 872585,
            mediaType: 'movie',
            title: 'Oppenheimer',
            comment: 'Absolute masterclass in tension and biography. Check it out ASAP!',
            status: 'PENDING' as const,
            posterPath: '/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg',
        },
        {
            fromUserId: u[0].id,
            toUserId: u[3].id,
            tmdbId: 77,
            mediaType: 'movie',
            title: 'Memento',
            comment: 'Since you love mystery and puzzles, this non-linear story will blow your mind.',
            status: 'WATCHED' as const,
            posterPath: '/yuWy09772B57vWl7xO4K9b6t767.jpg',
        },
    ];
    await db.insert(schema.suggestions).values(suggestionData);
    console.log(`✅ Created ${suggestionData.length} suggestions.`);

    // 8. Create Likes & Comments on Entries
    console.log('❤️ Creating likes and comments...');
    const likeData = [];
    const commentData = [];
    for (let i = 0; i < Math.min(10, createdEntries.length); i++) {
        const entry = createdEntries[i];
        likeData.push({
            userId: u[(i + 1) % u.length].id,
            entryId: entry.id,
        });
        likeData.push({
            userId: u[(i + 2) % u.length].id,
            entryId: entry.id,
        });

        commentData.push({
            userId: u[(i + 1) % u.length].id,
            entryId: entry.id,
            content: 'Totally agree with your rating on this! That ending was unforgettable.',
        });
    }
    await db.insert(schema.likes).values(likeData);
    await db.insert(schema.comments).values(commentData);
    console.log(`✅ Created ${likeData.length} likes and ${commentData.length} comments.`);

    console.log('\n🎉 Staging database successfully seeded with realistic community data!');
    await pool.end();
}

seed().catch(err => {
    console.error('❌ Seeding failed:', err);
    process.exit(1);
});
