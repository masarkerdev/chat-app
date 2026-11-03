/**
 * আপলোডের আগে ছবি নতুন করে আঁকা হয় (সর্বোচ্চ ১৬০০px, JPEG ৮২%)।
 *
 * এতে দুটো কাজ হয়:
 * - মোবাইল ডেটা বাঁচে, ৫ MB সীমার মধ্যে থাকে
 * - ছবির ভেতরের লুকানো তথ্য (EXIF) মুছে যায়: GPS লোকেশন, ফোনের মডেল, তোলার সময় ইত্যাদি।
 *   ক্যানভাসে আঁকা ছবিতে শুধু পিক্সেল থাকে, কোনো মেটাডেটা থাকে না।
 *
 * আসল ফাইল কখনো আপলোড হয় না — তাই লোকেশন ফাঁস হওয়ার সুযোগ নেই।
 * GIF হলে অ্যানিমেশন ঠিক রাখতে যেমন আছে তেমন পাঠায় (GIF-এ GPS তথ্য থাকে না)।
 */
export async function compressImage(file: File, maxSide = 1600, quality = 0.82): Promise<Blob> {
  if (file.type === 'image/gif') return file;

  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  // ফোনে ঘোরানো ছবি (EXIF orientation) ঠিক দিকে রেখেই আঁকা হয়, তারপর সেই তথ্যও মুছে যায়
  ctx.drawImage(bitmap, 0, 0, w, h);
  if ('close' in bitmap) (bitmap as ImageBitmap).close();

  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality));
  // ব্যর্থ হলে আসল ফাইল পাঠাই না (তাতে লোকেশন থাকতে পারে) — ভুল দেখাই
  if (!blob) throw new Error('could not encode image');
  return blob;
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* নিচের পদ্ধতিতে চেষ্টা */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function extFor(blob: Blob) {
  switch (blob.type) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    default:
      return 'jpg';
  }
}
