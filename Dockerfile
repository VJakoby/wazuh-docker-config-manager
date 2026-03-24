FROM node:20-alpine

WORKDIR /app

# Install dependencies first (cached layer)
COPY package.json ./
COPY package-lock.json ./
RUN npm install --omit=dev

# Copy source
COPY server.js ./
COPY src/ ./src/
COPY public/ ./public/
RUN mkdir -p /app/data

EXPOSE 8080

CMD ["node", "server.js"]
