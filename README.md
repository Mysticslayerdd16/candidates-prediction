# Candidates 2026 Prediction League — simple Supabase version

This package is intentionally minimal. You do not need to install anything.

## Files you need
- `index.html`
- `styles.css`
- `app.js`
- `config.js`

## One-time Supabase files
- `supabase_schema.sql`
- `supabase_games_seed.sql`

## Minimal steps

### 1) Create a Supabase project
Create a new project in Supabase.

### 2) Make sign-up instant
Open:
- Authentication
- Providers
- Email

Turn **Confirm Email** OFF and save.

### 3) Create the database
Open **SQL Editor**, paste `supabase_schema.sql`, and run it.

### 4) Load the fixtures
Open **SQL Editor**, paste `supabase_games_seed.sql`, and run it.

### 5) Get your keys
Open **Project Settings > API** and copy:
- Project URL
- Publishable key / anon public key

### 6) Paste the two values
Open `config.js` and replace the two placeholders.

### 7) Create your own account
Open `index.html`, sign up once with your email, password, and display name.

### 8) Make yourself admin
In Supabase SQL Editor, run:

```sql
update public.profiles
set is_admin = true
where display_name = 'YOUR_DISPLAY_NAME';
```

Refresh the site. You will now see the **Admin** tab.

### 9) Put the site online
Simplest route:
- create a GitHub repository
- upload these files
- import that repository into Vercel
- deploy

## Usage
- users sign up once
- users make predictions
- you enter actual results in the Admin tab
- leaderboard updates automatically

## Poll timing rule
- opens: 12:00 AM IST on the game day
- editable until: 5:59 PM IST
- locked from: 6:00 PM IST

## Notes
- users sign up with email + password
- leaderboard shows display name
- missed games are ignored, not counted as wrong
- total fixtures already loaded: 56
- first round date: 2026-03-29
- final round date: 2026-04-15
