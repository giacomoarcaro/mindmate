# Build stage
FROM node:18-alpine as build

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build the app
RUN npm run build

# Production stage
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm install --production

# Copy built assets from build stage
COPY --from=build /app/build ./build
COPY --from=build /app/server.js ./

# Expose ports
EXPOSE 3000
EXPOSE 5000

# Start both frontend and backend
CMD ["node", "server.js"] 