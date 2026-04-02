import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const users = [
      { username: 'admin', password: 'FLL$', isAdmin: true }
    ];
    
    // Create users.json in blob
    const { url } = await put('users.json', JSON.stringify(users), { 
      access: 'public', 
      addRandomSuffix: false 
    });
    
    return NextResponse.json({ success: true, message: 'Database initialized', url });
  } catch (error) {
    console.error('Error initializing db:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
