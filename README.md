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
   # Generate Drizzle migrations
   npm run db:generate
   
   # Push changes to database
   npm run db:push
   ```

4. **Start development server**:
   ```bash
   npm run dev
   ```

The server will start on `http://localhost:5001`

## 📁 Project Structure

```
src/
├── controllers/      # Request handlers
├── services/         # Business logic
├── routes/           # API routes
├── middleware/       # Express middleware
├── utils/            # Utility functions
├── types/            # TypeScript types
├── db/               # Drizzle schema and client
├── config.ts         # Configuration
├── app.ts            # Express app setup
└── index.ts          # Server entry point
tests/                # Test files
.github/workflows/    # CI/CD pipelines
```

## 🔌 API Endpoints

### Authentication
- `POST /api/v1/auth/register` - Register new user
- `POST /api/v1/auth/login` - Login user
- `POST /api/v1/user/refresh` - Refresh access token
- `POST /api/v1/user/logout` - Logout user

### Health Check
- `GET /health` - Server health status

## 🛠️ Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run db:generate` - Generate Drizzle migrations
- `npm run db:push` - Push schema to database
- `npm run db:studio` - Open Drizzle Studio (database GUI)
- `npm test` - Run tests
- `npm run lint` - Run ESLint

## 🗄️ Database Schema

The database uses PostgreSQL with Drizzle ORM. Main models:

- **User** - User accounts and profiles
- **Entry** - Logged movies/shows
- **Follow** - User following relationships
- **Like** - Entry likes
- **Comment** - Entry comments
- **List** - User-created lists

See `src/db/schema.ts` for full schema details.

## 🔐 Environment Variables

Required environment variables (see `.env.example`):

```env
DATABASE_URL=postgresql://...
JWT_SECRET=your-secret-key
JWT_REFRESH_SECRET=your-refresh-secret
FRONTEND_URL=http://localhost:3000
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch
```

## 📝 API Documentation

Full API documentation is available at `/api-docs` using Swagger.

## 🚀 CI/CD & Deployment

### Continuous Integration
This project uses **GitHub Actions** for CI. Every push and pull request to the `main` branch triggers:
1. Linting with ESLint.
2. Automated testing with Jest.

### Continuous Deployment
We use **Railway** for CD. To enable fully automated "Ship on Push":
1. Connect your GitHub repository to your Railway project.
2. Railway will automatically deploy the latest changes from the `main` branch once the CI checks pass.

Manual deployment:
```bash
railway up
```

## 📚 Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Language**: TypeScript
- **Database**: PostgreSQL
- **ORM**: Drizzle
- **Authentication**: JWT + bcrypt
- **Validation**: express-validator
- **Security**: Helmet
- **Logging**: Morgan

---

Built with ❤️ for WatchHive
