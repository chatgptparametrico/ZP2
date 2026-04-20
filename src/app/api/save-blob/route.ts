import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const BUCKET_NAME = 'zirkelp-storage';

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials:', { supabaseUrl: !!supabaseUrl, supabaseKey: !!supabaseKey });
    return NextResponse.json({ error: 'Supabase credentials not configured on server' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const payload = await request.json();
    const data = payload.data || payload;

    const filename = payload.filename
      ? `presentations/${payload.filename}.json`
      : `presentations/presentacion-${Date.now()}.json`;

    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filename, JSON.stringify(data), {
        contentType: 'application/json',
        upsert: true
      });

    if (error) throw error;

    const { data: publicUrlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(filename);

    return NextResponse.json({ success: true, url: publicUrlData.publicUrl });
  } catch (error: any) {
    console.error('Error saving blob:', error);
    return NextResponse.json({ error: error?.message || 'Failed to save presentation' }, { status: 500 });
  }
}
