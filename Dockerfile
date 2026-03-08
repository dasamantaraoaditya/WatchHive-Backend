# Use Node.js 20 LTS
FROM node:20-slim

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (need devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Remove devDependencies for smaller image
RUN npm prune --production

# Expose port (Railway provides PORT env var)
EXPOSE 8080

# Create uploads directory
RUN mkdir -p /app/uploads/avatars

# Environment variables
ENV NODE_ENV=production

# Start the server
CMD ["npm", "run", "start"]
