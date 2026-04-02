import { NextResponse } from 'next/server';
import { list } from '@vercel/blob';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password required' }, { status: 400 });
    }

    // Try to get users.json from Blob
    try {
      const { blobs } = await list({ prefix: 'users.json' });
      
      if (blobs.length > 0) {
        const response = await fetch(blobs[0].url);
        if (response.ok) {
          const users = await response.json();
          
          const user = users.find((u: any) => u.username === username && u.password === password);
          
          if (user) {
            // For simplicity, we just return success and the user info without the password
            return NextResponse.json({ 
              success: true, 
              user: { username: user.username, isAdmin: user.isAdmin } 
            });
          }
        }
      }
      
      // If we reach here, either the users.json wasn't found, couldn't be fetched, or user not found
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });

    } catch (blobError) {
      console.error('Blob error:', blobError);
      return NextResponse.json({ error: 'Database connection error' }, { status: 500 });
    }

  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
