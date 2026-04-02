import { put } from '@vercel/blob';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Define the absolute path to ZirkelP
// Read from .env inside ZirkelP if it exists
dotenv.config({ path: 'c:/Users/admin/ZirkelP/.env' });
dotenv.config({ path: 'c:/Users/admin/ZirkelP/.env.local' });

async function initDB() {
  const users = [
    { username: 'admin', password: 'FLL$', isAdmin: true }
  ];
  try {
    const { url } = await put('users.json', JSON.stringify(users), { access: 'public', addRandomSuffix: false });
    console.log('Database initialized at:', url);
  } catch(error) {
    console.error('Error:', error);
  }
}

initDB();
