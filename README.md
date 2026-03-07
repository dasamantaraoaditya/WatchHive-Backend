# WatchHive Backend API

Backend API server for WatchHive - A social platform for movie and TV show enthusiasts.

## 🚀 Quick Start

### Prerequisites
- Node.js (v18 or higher)
- PostgreSQL database
- npm or yarn

### Installation

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Set up environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env with your actual values
   ```

3. **Set up database**:
   ```bash
   # Generate Prisma client
   npm run prisma:generate
   
   # Run migrations
   npm run prisma:migrate
   
   # (Optional) Seed database
   npm run prisma:seed
   ```

4. **Start development server**:
   ```bash
   npm run dev
   ```

The server will start on `http://localhost:5001`

## 📁 Project Structure

```
server/
├── src/
│   ├── controllers/      # Request handlers
│   ├── services/         # Business logic
│   ├── routes/           # API routes
│   ├── middleware/       # Express middleware
│   ├── utils/            # Utility functions
│   ├── types/            # TypeScript types
│   ├── config.ts         # Configuration
│   ├── app.ts            # Express app setup
│   └── index.ts          # Server entry point
├── prisma/
│   ├── schema.prisma     # Database schema
│   ├── migrations/       # Database migrations
│   └── seed.ts           # Seed data
├── tests/                # Test files
├── .env                  # Environment variables
└── package.json
```

## 🔌 API Endpoints

### Authentication
- `POST /api/v1/auth/register` - Register new user
- `POST /api/v1/auth/login` - Login user
- `POST /api/v1/auth/refresh` - Refresh access token
- `POST /api/v1/auth/logout` - Logout user

### Health Check
- `GET /health` - Server health status

## 🛠️ Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run prisma:generate` - Generate Prisma client
- `npm run prisma:migrate` - Run database migrations
- `npm run prisma:studio` - Open Prisma Studio (database GUI)
- `npm run prisma:seed` - Seed database with test data
- `npm test` - Run tests
- `npm run lint` - Run ESLint

## 🗄️ Database Schema

The database uses PostgreSQL with Prisma ORM. Main models:

- **User** - User accounts and profiles
- **Entry** - Logged movies/shows
- **Follow** - User following relationships
- **Like** - Entry likes
- **Comment** - Entry comments
- **List** - User-created lists
- **ListItem** - Items in lists
- **Notification** - User notifications

See `prisma/schema.prisma` for full schema details.

## 🔐 Environment Variables

Required environment variables (see `.env.example`):

```env
DATABASE_URL=postgresql://...
JWT_SECRET=your-secret-key
JWT_REFRESH_SECRET=your-refresh-secret
FRONTEND_URL=http://localhost:3000
```

Optional:
- `TMDB_API_KEY` - For movie data
- `REDIS_URL` - For caching
- `SENDGRID_API_KEY` - For emails
- `CLOUDINARY_*` - For file uploads

## 🧪 Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch
```

## 📝 API Documentation

Full API documentation will be available at `/api/docs` (coming soon with Swagger).

## 🔒 Security Features

- JWT-based authentication
- Password hashing with bcrypt
- Helmet.js for security headers
- CORS configuration
- Request validation
- Rate limiting (coming soon)

## 🚀 Deployment

### Production Build

```bash
npm run build
npm start
```

### Environment Setup

Make sure to set all required environment variables in your production environment.

### Database Migrations

```bash
npx prisma migrate deploy
```

## 📚 Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Language**: TypeScript
- **Database**: PostgreSQL
- **ORM**: Prisma
- **Authentication**: JWT + bcrypt
- **Validation**: express-validator
- **Security**: Helmet
- **Logging**: Morgan

## 🤝 Contributing

1. Create a feature branch
2. Make your changes
3. Write/update tests
4. Submit a pull request

## 📄 License

MIT

---

Built with ❤️ for WatchHive
