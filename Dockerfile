# Production Multi-Stage Dockerfile for DevOps Pulse
FROM node:20-alpine AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

# Express web server default port is 3850 (as defined in lib/web/server.js)
EXPOSE 3850
USER node
CMD ["npm", "run", "web"]
