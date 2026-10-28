'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    getSupabase()
      .auth.getSession()
      .then(({ data }) => router.replace(data.session ? '/chat' : '/login'));
  }, [router]);

  return (
    <main className="splash">
      <span className="spinner spinner-dark" aria-label="লোড হচ্ছে" />
    </main>
  );
}
