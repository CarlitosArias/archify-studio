# Etapa 1: build del frontend (Vite -> frontend/dist)
FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Etapa 2: runtime — backend Fastify sirve la API + el dist del frontend
FROM node:22-alpine
WORKDIR /app

COPY backend/package*.json ./backend/
RUN apk add --no-cache python3 make g++ && cd backend && npm ci --omit=dev && apk del python3 make g++

COPY backend/ ./backend/
COPY engine/ ./engine/
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

ENV HOST=0.0.0.0
ENV PORT=4319
ENV DATABASE_FILE=/data/archify.db
EXPOSE 4319
VOLUME ["/data"]

# node:sqlite requiere Node 22+, ya cubierto por la imagen base.
CMD ["node", "backend/server.mjs"]
