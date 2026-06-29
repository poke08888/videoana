FROM node:22-alpine

WORKDIR /app

# Công cụ build cho native module sqlite3 (alpine/musl) + ffmpeg cho trích frame.
RUN apk add --no-cache python3 make g++ ffmpeg

# Copy package definition
COPY package*.json ./

# Install dependencies (including devDependencies to compile TS and run tsx)
RUN npm install

# Copy application source code
COPY . .

# Build frontend to dist/
RUN npm run build

# Expose backend port
EXPOSE 8787

# Start Express server via tsx
CMD ["npm", "start"]
