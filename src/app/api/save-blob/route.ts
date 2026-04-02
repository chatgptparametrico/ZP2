import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const data = payload.data || payload; // Support both { data, filename } and direct data
    
    // Create a unique filename for the presentation
    let filename = payload.filename ? `presentations/${payload.filename}.json` : `presentations/presentacion-${Date.now()}.json`;

    // Upload to Vercel Blob
    const blob = await put(filename, JSON.stringify(data), {
      access: 'public',
      addRandomSuffix: payload.filename ? false : true,
      // We allow addRandomSuffix to be true (default) to ensure uniqueness
      // or false if we want to overwrite. For presentations, we'll keep unique versions if no filename provided.
    });

    return NextResponse.json({ success: true, url: blob.url });
  } catch (error) {
    console.error('Error saving blob:', error);
    return NextResponse.json({ error: 'Failed to save presentation' }, { status: 500 });
  }
}
