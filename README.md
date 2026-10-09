# RuangUsaha — Financial Health Expert System

React + Vite and FastAPI MVP for recording small-business finances, preparing basic reports, and exploring diagnoses from the project's OWL/SWRL knowledge base.

## React and FastAPI migration

The application is organized as:

- `frontend/`: React + Vite UI. Without Supabase environment variables it runs in demo/local-storage mode.
- `backend/`: FastAPI financial-report calculations and OWL/Pellet reasoning endpoint. Java 25+ is required for reasoning.
- `supabase/schema.sql`: optional per-user JSONB workspace table with row-level security.
- `build_v2.py`, `Finance_Health_Expert_System_v2.owl`, and `test_rules.py`: ontology builder, generated knowledge base, and rule regression tests.

### Run locally

In one terminal, start the API from the project root:

```powershell
$env:JAVA25 = "C:\Program Files\BellSoft\LibericaJDK-25\bin\java.exe"
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --reload --port 8000
```

In another terminal:

```powershell
Set-Location frontend
npm install
npm run dev
```

Open <http://127.0.0.1:5173>. Vite proxies `/api` requests to `http://127.0.0.1:8000`. The API health check is available at <http://127.0.0.1:8000/api/health>.

### Optional Supabase and deployment

Copy `frontend/.env.example` to `frontend/.env.local`, then set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from your Supabase project. Run `supabase/schema.sql` in the Supabase SQL editor to create the protected workspace table. Never put a Supabase service-role key in frontend variables.

For Vercel, deploy the project root and configure `VITE_API_URL` as the public Render API origin (for example, `https://your-service.onrender.com`, without `/api`). For Render, use the included Blueprint; set `FRONTEND_ORIGINS` to the exact Vercel origin. Render downloads Java 25 during its build. Actual cloud deployment still requires your own Supabase, Vercel, and Render projects and their URLs.

The React app sends the workspace and selected month to `POST /api/reports`; the backend calculates the income statement, cash flow, balance sheet, previous-month comparison, and six-month dashboard trend. OWL/Pellet reasoning remains at `POST /api/analyze`. The API accepts the full workspace JSON for each calculation; this remains an MVP rather than a normalized accounting database or production-ready financial system.
