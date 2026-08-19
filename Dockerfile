FROM node:22-alpine

WORKDIR /app

# Công cụ build cho native module sqlite3 (alpine/musl) + ffmpeg cho trích frame.
# + ttf-dejavu/fontconfig: font có glyph tiếng Việt cho burn phụ đề (Xưởng)
RUN apk add --no-cache python3 make g++ ffmpeg ttf-dejavu fontconfig

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
