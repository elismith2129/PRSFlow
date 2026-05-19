# PRSFlow — Setup Guide

## Stack
- **Next.js 14** — frontend + routing
- **Supabase** — database + auth
- **Vercel** — hosting (free tier)

## Setup Steps

### 1. Create Supabase Project
1. Go to [supabase.com](https://supabase.com) → New Project
2. Name it `prsflow`, set a strong password, choose US West region
3. Once created, go to **SQL Editor**
4. Paste the contents of `schema.sql` and click Run
5. Go to **Settings → API** and copy:
   - Project URL
   - `anon` public key

### 2. Configure Environment
```bash
cp .env.local.example .env.local
```
Edit `.env.local` and paste your Supabase values:
```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
```

### 3. Install & Run Locally
```bash
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000)

### 4. Migrate Your Data
Export your Google Sheet leads as CSV, then in Supabase:
1. Go to **Table Editor → leads**
2. Click **Insert → Import data from CSV**
3. Map columns to the schema fields

### 5. Deploy to Vercel
```bash
npm install -g vercel
vercel
```
Or connect your GitHub repo to [vercel.com](https://vercel.com) for auto-deploy.

Add your environment variables in Vercel dashboard under Settings → Environment Variables.

## Current Features
- ✅ Dashboard with TODO module (hot/warm/incomplete leads)
- ✅ CRM with Pipeline + Analytics
- ✅ Client Profiles — create, edit, generate from booked leads
- ✅ Session QC widget

## Coming Next
- 📅 Calendar with booking management
- 📋 Work Orders
- 👥 Staff login & roles
- 🎓 Staff training module
