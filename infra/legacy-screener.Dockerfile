FROM node:22.23.4-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d
WORKDIR /app
RUN printf '%s\n' 'console.log("legacy screener started paper without a stop gate");' > /app/legacy.mjs
CMD ["node", "legacy.mjs"]
