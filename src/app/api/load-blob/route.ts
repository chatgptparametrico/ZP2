import { NextResponse } from 'next/server';
import { list } from '@vercel/blob';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // List all files starting with "presentations/"
    const { blobs } = await list({ prefix: 'presentations/' });

    // Sort by uploadedAt descending
    blobs.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());

    return NextResponse.json({ success: true, files: blobs });
  } catch (error) {
    console.error('Error loading blobs:', error);
    return NextResponse.json({ error: 'Failed to list presentations' }, { status: 500 });
  }
}
