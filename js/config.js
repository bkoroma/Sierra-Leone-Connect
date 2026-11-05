// ─────────────────────────────────────────────────────────────────────────────
// Sierra Leone Connect configuration
//
// DEMO mode (default): leave SUPABASE_URL empty. Everything runs in the browser with
// sample members so you can try the full app, Admin and SuperAdmin consoles instantly.
//
// LIVE mode: create a Supabase project, run supabase/schema.sql in the SQL editor,
// then paste your project URL and *publishable/anon* key below (never the service key).
// ─────────────────────────────────────────────────────────────────────────────
export const CONFIG = {
  SUPABASE_URL: 'https://ftxakwsdbrohtniofqov.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ0eGFrd3NkYnJvaHRuaW9mcW92Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM0NzM2NDYsImV4cCI6MjEwOTA0OTY0Nn0.RpB_bTzInO7xXz48mMAxr3Dg0FNmAf7c0Ze1lgh_egs', // public anon key — safe in the browser; data is protected by RLS + RPC checks
  APP_URL: 'https://sierra-leone-connect-5sxz.onrender.com',         // ← your live website (email links + policy URLs)
  SUPPORT_EMAIL: 'support@slconnect.app',   // ← set to a real inbox you monitor (shown in policies + Play listing)
  SAFETY_EMAIL: 'safety@slconnect.app',     // ← child-safety point of contact required by Google Play
  OPERATOR: 'Sierra Leone Connect',          // ← legal name of who runs the app (you or your company)
  VERSION: '1.3.0'
};
