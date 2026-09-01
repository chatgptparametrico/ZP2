import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const BUCKET_NAME = 'zirkelp-storage';

export async function POST(request: Request) {
  // Las credenciales salen SOLO del entorno. Hubo acá una service_role escrita
  // a mano como respaldo «para que el deploy anduviera»: esa clave saltea Row
  // Level Security por completo, y el repo es público. Si falta la variable, la
  // ruta tiene que fallar y decirlo, no seguir con una llave incrustada.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    return NextResponse.json({ error: 'Supabase credentials not configured on server' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { pathname } = await request.json();

    if (!pathname) {
      return NextResponse.json({ error: 'Pathname is required' }, { status: 400 });
    }

    const { error } = await supabase.storage.from(BUCKET_NAME).remove([pathname]);

    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true, message: 'Deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting blob:', error);
    return NextResponse.json({ error: error?.message || 'Failed to delete' }, { status: 500 });
  }
}
