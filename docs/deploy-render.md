# Deploying to Render

## Backend (this folder)

1. **Put the backend in its own GitHub repo** (it isn't in git yet):
   ```bash
   git init && git add . && git commit -m "Gbanjo API"
   git branch -M main
   git remote add origin https://github.com/<you>/gbanjo-api.git
   git push -u origin main
   ```
   `.env`, `node_modules`, `dist` and `src/generated` are in `.gitignore`, so no secrets are pushed. Check with `git status` before the first commit.
2. In Render: **New → Blueprint**, pick the repo. `render.yaml` creates:
   - `gbanjo-api` — the API (Node 22, Frankfurt)
   - `gbanjo-db` — Postgres (`DATABASE_URL` is filled in for you)
   - `gbanjo-redis` — Key Value / Redis (`REDIS_URL` is filled in for you)
   - `JWT_ACCESS_SECRET` is generated for you.
3. Render asks for the values marked `sync: false` — copy them from your local `.env`
   (Google, SMTP, Termii/Emisri, Cloudinary). Set `CORS_ORIGINS` to your website's URL once you know it.
   **Don't** set `OTP_DEV_CODE` in production (the API refuses to start with it).
4. Deploy. Every start runs `prisma migrate deploy` first, so the database is always up to date.
5. One time, in the service's **Shell** tab:
   ```bash
   npx prisma db seed                       # categories, starter products, home banner
   npm run make-admin -- you@example.com    # after you've signed up on the live site
   npm run sms:test -- 080xxxxxxxx          # check SMS works from the server
   ```
6. Check:
   - `https://gbanjo-api.onrender.com/api/health` → `{"status":"ok","database":"up","redis":"up"}`
   - `https://gbanjo-api.onrender.com/api/docs` → Swagger

### Good to know

- **Free plan:** the API sleeps after 15 minutes without traffic (first request then takes ~1 minute), and the free database is deleted after 30 days. Use paid plans for real users.
- **Google sign-in:** in Google Cloud Console add your website URL to the OAuth client's *Authorized JavaScript origins*.
- **Termii DND route:** ask Termii to enable it so codes reach DND numbers (otherwise Emisri sends them).
- Live chat uses Server-Sent Events, which work on Render with no extra setup.
- Prefer a different Redis (e.g. Upstash)? Set `REDIS_URL` to its `rediss://…` URL.

## Website (frontend)

See `frontend/render.yaml`. After the API is up, set the website's `BACKEND_API_URL` to
`https://gbanjo-api.onrender.com/api/v1`, then add the website's URL to the API's `CORS_ORIGINS`.
