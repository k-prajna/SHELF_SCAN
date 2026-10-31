# SHELF SCAN

SHELF SCAN is a responsive book-discovery application with the supplied brand logo, a 30-second animated splash screen, email-verified accounts, a FastAPI API, and a PostgreSQL/pgvector production configuration. The local development database defaults to SQLite.

## Project layout

- `frontend/` — React, TypeScript, Tailwind CSS, Framer Motion
- `backend/` — FastAPI, SQLAlchemy, bcrypt, JWT, PostgreSQL and pgvector
- `render.yaml` — Render API and hosted PostgreSQL blueprint

## Run locally (Windows)

Start the backend in one terminal:

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

The local database is created as `backend/shelfscan.db`. In development, when SMTP is not configured, registration and password reset responses include a development-only OTP so those flows can be exercised locally. The OTP and password hashes are stored as hashes; development OTPs are never returned in production.

Start the frontend in a second terminal:

```powershell
cd frontend
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open http://localhost:5173. The app shows the splash screen for 30 seconds after opening or refreshing. API docs are available at http://localhost:8000/docs and health at http://localhost:8000/health.

## Production environment

Do not commit `.env` files or secrets. `.gitignore` excludes local environment files and databases.

### Render backend

Create the service from `render.yaml`, then set these secret/host-specific environment variables in Render:

- `FRONTEND_URL` — the deployed Vercel origin (comma-separated origins are supported)
- `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USERNAME`, `EMAIL_PASSWORD`, `EMAIL_FROM` — authenticated SMTP delivery
- `OPENAI_API_KEY` — bookshelf image recognition, the grounded book assistant, and semantic embeddings
- `OPENAI_CHAT_MODEL` — optional chat model override for the book assistant (default `gpt-4o-mini`)
- `GOOGLE_BOOKS_API_KEY` — optional higher-quota Google Books metadata and provider-supplied purchase data
- `ADMIN_EMAILS` — comma-separated trusted account emails to grant the administrator role; set this before deployment or before restarting to promote existing matching accounts
- `ACTIVE_USER_WINDOW_MINUTES` — activity window used for active/inactive statistics (default 30)
- `ACTIVITY_UPDATE_SECONDS` — minimum interval between persisted activity timestamp updates (default 300)

Render supplies `DATABASE_URL`; the blueprint provisions a PostgreSQL database. The API requires `JWT_SECRET_KEY` and `DATABASE_URL` when `ENVIRONMENT=production`. It enables pgvector, creates missing application tables, and applies the repeatable PostgreSQL migration in `backend/migrations/001_activity_and_book_commerce.sql` on startup.

### Vercel frontend

Set the Vercel project root directory to `frontend` and add:

```text
VITE_API_BASE_URL=https://<your-render-service>.onrender.com
```

`frontend/vercel.json` sends app routes to the SPA entry point so page refreshes do not return 404s.

### Email and AI setup

Production sign-up and password recovery require a working SMTP provider. Verification/reset codes expire after ten minutes; resending is rate-limited. Shelf scanning and the grounded book assistant require `OPENAI_API_KEY`; recognized titles are only matched to Google Books metadata when the title agrees, and uncertain detections are marked for review.

## Account activity and administrator access

- Successful password sign-ins and verified sign-ups create `login_history` session records; logout records its time and revokes that JWT.
- Authenticated API activity updates `last_active_at` at most once per `ACTIVITY_UPDATE_SECONDS`, rather than on every request.
- Active users are verified accounts with activity inside `ACTIVE_USER_WINDOW_MINUTES`; all other accounts count as inactive.
- Registration never accepts a client-supplied role. Only `ADMIN_EMAILS` may grant administrator access, and administrator APIs also check the database role.
- `GET /api/admin/dashboard`, `/api/admin/users`, `/api/admin/login-history`, and `/api/admin/analytics` require an administrator JWT and report database-backed counts and activity.

## Book discovery and shopping

- The existing book search page queries the local catalogue and Google Books/Open Library by title, author, ISBN, or genre. Provider results are saved into the existing `books` catalogue so details, recommendations, library, wishlist/favourites, and cart use the same book IDs.
- `GOOGLE_BOOKS_API_KEY` is optional; Open Library search does not require credentials. External provider calls require network access from the backend.
- Google Books purchase URLs and prices are shown only when the API returns a valid HTTPS purchase link and a positive `FOR_SALE` list price. Prices are treated as current for display for 24 hours after retrieval. Open Library is used for catalogue metadata, never as retailer proof.
- The cart is persisted per account. An estimated subtotal is shown only when all cart items have fresh prices in the same currency. A final total remains unavailable because retailer taxes, shipping, and checkout pricing are not known. Favourites are the existing wishlist.
- No Amazon/Flipkart retailer inventory or in-app payment integration is configured. The app does not invent retailer links, prices, or availability, and external purchases are not Shelf Scan orders.
- The AI Book Assistant sends the signed-in reader's question and a bounded catalogue/profile context to the configured OpenAI chat API. It validates returned book IDs against the catalogue and reports unavailable provider configuration/errors instead of fabricating an answer. Shelf personality and shelf comparisons use saved or user-entered genre lists; no other reader's private profile is exposed.

## Authentication and API

- Email addresses are trimmed, lowercased, and strictly validated on both client and server.
- Registration prevents duplicates, hashes passwords with bcrypt, and requires OTP verification before login.
- JWTs expire and logout revokes the active token.
- Protected API routes require a valid Bearer token.
- Forgot-password codes are time-limited and password changes replace the stored bcrypt hash.
- PostgreSQL persists users, preferences, books, scans, recommendations, library/favourites, reading history, embeddings, and revoked tokens.

## Frontend pages

The authenticated app includes the dashboard, bookshelf scanner and results, book details, recommendations, reading preferences, library and favourites, shelf personality, reading twin, shelf comparison, book assistant, profile/settings, external book discovery, persistent cart, and an administrator user/activity dashboard. Shared navigation keeps the existing light-green glass styling across pages.

## Deployment limitation

The repository includes Vercel/Render configuration, but a live deployment still needs your Vercel and Render projects, SMTP credentials, and provider API keys configured in their dashboards. No external accounts or production secrets are available from this workspace, so deployment itself cannot be completed here.
