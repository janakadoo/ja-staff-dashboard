import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://pxfmoxcuftugcmcwvqym.supabase.co';
const supabaseKey = 'sb_publishable_lySJRdhCa5Kl7JE77hmCYA_N8V-XuoK';

export const supabase = createClient(supabaseUrl, supabaseKey);
