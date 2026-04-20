import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);
const BUCKET_NAME = 'zirkelp-storage';

export async function GET() {
  try {
    const { data, error } = await supabase.storage.from(BUCKET_NAME).list('presentations', {
      sortBy: { column: 'updated_at', order: 'desc' }
    });

    if (error) throw error;

    const blobs = (data || []).filter(f => f.name !== '.emptyFolderPlaceholder').map(file => {
      const pathname = `presentations/${file.name}`;
      const { data: publicUrlData } = supabase.storage.from(BUCKET_NAME).getPublicUrl(pathname);
      return {
        pathname,
        url: publicUrlData.publicUrl,
        size: file.metadata?.size || 0,
        uploadedAt: new Date(file.updated_at)
      };
    });

    return NextResponse.json({ success: true, blobs });
  } catch (error) {
    console.error('Error listing blobs:', error);
    return NextResponse.json({ error: 'Failed to list presentations' }, { status: 500 });
  }
}
