import { NextResponse } from 'next/server';
import { list } from '@vercel/blob';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { blobs } = await list({ prefix: 'presentations/' });
    return NextResponse.json({ success: true, blobs });
  } catch (error) {
    console.error('Error listing blobs:', error);
    return NextResponse.json({ error: 'Failed to list presentations' }, { status: 500 });
  }
}
