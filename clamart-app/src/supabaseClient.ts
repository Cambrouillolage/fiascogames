import { createClient } from '@supabase/supabase-js';

// Mêmes valeurs que partout ailleurs sur le site (gav/clamart/,
// gav/admin/*) : clé anon publique par conception, la vraie sécurité est
// assurée par Row Level Security côté Supabase (voir
// supabase/migrations/0005_clamart_categories.sql et
// 0006_clamart_merchants.sql), pas par le secret de cette clé.
const SUPABASE_URL = 'https://wrguanxvvpqzoaesxcfk.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndyZ3Vhbnh2dnBxem9hZXN4Y2ZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4MjEwMjIsImV4cCI6MjEwMzM5NzAyMn0.NsODcMAh2J-nUD6dGheZOeF4ykXl-e3aKCONCNyvLUg';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
