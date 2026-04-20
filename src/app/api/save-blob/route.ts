import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

// Increase body size limit to 50MB
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};

const BUCKET_NAME = 'zirkelp-storage';

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials:', { supabaseUrl: !!supabaseUrl, supabaseKey: !!supabaseKey });
    return NextResponse.json({ error: 'Supabase credentials not configured on server' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const payload = await request.json();
    let data = payload.data || payload;

    const filename = payload.filename
      ? `presentations/${payload.filename}.json`
      : `presentations/presentacion-${Date.now()}.json`;

    // Upload large base64 images to Supabase Storage separately
    // and replace their data URLs with public URLs in the JSON
    if (data.boxes) {
      data = JSON.parse(JSON.stringify(data)); // deep clone
      for (const box of data.boxes) {
        // Upload wall slides
        for (const slide of box.slides || []) {
          if (slide.imageUrl && slide.imageUrl.startsWith('data:')) {
            const uploadedUrl = await uploadBase64ToStorage(supabase, BUCKET_NAME, slide.imageUrl, slide.id);
            if (uploadedUrl) slide.imageUrl = uploadedUrl;
          }
        }
        // Upload floor
        if (box.floorImageUrl && box.floorImageUrl.startsWith('data:')) {
          const uploadedUrl = await uploadBase64ToStorage(supabase, BUCKET_NAME, box.floorImageUrl, `floor-${box.id}`);
          if (uploadedUrl) box.floorImageUrl = uploadedUrl;
        }
        // Upload ceiling
        if (box.ceilingImageUrl && box.ceilingImageUrl.startsWith('data:')) {
          const uploadedUrl = await uploadBase64ToStorage(supabase, BUCKET_NAME, box.ceilingImageUrl, `ceiling-${box.id}`);
          if (uploadedUrl) box.ceilingImageUrl = uploadedUrl;
        }
      }
    }

    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filename, JSON.stringify(data), {
        contentType: 'application/json',
        upsert: true
      });

    if (error) throw error;

    const { data: publicUrlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(filename);

    return NextResponse.json({ success: true, url: publicUrlData.publicUrl });
  } catch (error: any) {
    console.error('Error saving blob:', error);
    return NextResponse.json({ error: error?.message || 'Failed to save presentation' }, { status: 500 });
  }
}

async function uploadBase64ToStorage(supabase: any, bucket: string, dataUrl: string, id: string): Promise<string | null> {
  try {
    // Parse the data URL: "data:<mime>;base64,<data>"
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;

    const mimeType = match[1];
    const base64Data = match[2];
    const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'bin';
    const filePath = `media/${id}.${ext}`;

    // Convert base64 to Buffer
    const buffer = Buffer.from(base64Data, 'base64');

    const { error } = await supabase.storage
      .from(bucket)
      .upload(filePath, buffer, {
        contentType: mimeType,
        upsert: true
      });

    if (error) {
      console.error('Error uploading media file:', error);
      return null;
    }

    const { data: publicUrlData } = supabase.storage.from(bucket).getPublicUrl(filePath);
    return publicUrlData.publicUrl;
  } catch (err) {
    console.error('Failed to upload base64 media:', err);
    return null;
  }
}
