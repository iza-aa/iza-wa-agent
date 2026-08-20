FROM node:20-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
COPY .npmrc ./
RUN npm install --legacy-peer-deps

COPY . .
RUN npm run build

# Hugging Face Spaces listens on port 7860 by default
ENV PORT=7860
EXPOSE 7860

CMD ["npm", "start"]
