import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder';
const supabase = createClient(supabaseUrl, supabaseKey);
const BUCKET_NAME = 'zirkelp-storage';

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const data = payload.data || payload; 
    
    // Create a unique filename for the presentation
    let filename = payload.filename ? `presentations/${payload.filename}.json` : `presentations/presentacion-${Date.now()}.json`;

    // Upload to Supabase Storage
    const { data: uploadData, error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filename, JSON.stringify(data), {
        contentType: 'application/json',
        upsert: true
      });

    if (error) throw error;

    // Get public URL
    const { data: publicUrlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(filename);

    return NextResponse.json({ success: true, url: publicUrlData.publicUrl });
  } catch (error) {
    console.error('Error saving blob:', error);
    return NextResponse.json({ error: 'Failed to save presentation' }, { status: 500 });
  }
}
