import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder';
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

    // Sort by uploadedAt descending
    blobs.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());

    return NextResponse.json({ success: true, files: blobs });
  } catch (error) {
    console.error('Error loading blobs:', error);
    return NextResponse.json({ error: 'Failed to list presentations' }, { status: 500 });
  }
}
