import { NextResponse } from 'next/server';
import { list, put } from '@vercel/blob';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { username, password, adminUsername, adminPassword } = body;

    // Very basic admin check
    if (!adminUsername || !adminPassword || !username || !password) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    try {
      const { blobs } = await list({ prefix: 'users.json' });
      let users: any[] = [];
      
      if (blobs.length > 0) {
        const response = await fetch(blobs[0].url);
        if (response.ok) {
          users = await response.json();
        }
      }

      // Check if admin is valid
      const adminUser = users.find((u: any) => u.username === adminUsername && u.password === adminPassword && u.isAdmin);
      if (!adminUser) {
        return NextResponse.json({ error: 'Unauthorized. Admin credentials required.' }, { status: 403 });
      }

      // Check if new user already exists
      if (users.find((u: any) => u.username === username)) {
         return NextResponse.json({ error: 'Username already exists' }, { status: 400 });
      }

      // Add new user
      users.push({
        username,
        password, // In a real app, hash this!
        isAdmin: false
      });

      // Save back to Blob
      // Overwrite the existing users.json by using addRandomSuffix: false
      await put('users.json', JSON.stringify(users), { access: 'public', addRandomSuffix: false });

      return NextResponse.json({ success: true, message: 'User created' });

    } catch (blobError) {
      console.error('Blob error:', blobError);
      return NextResponse.json({ error: 'Database connection error' }, { status: 500 });
    }

  } catch (error) {
    console.error('Register error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
