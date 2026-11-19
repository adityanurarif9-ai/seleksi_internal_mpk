import worker from '../worker.mjs';
import { postgresDatabase, supabasePool } from '../postgres.mjs';
import { attachDatabasePool } from '@vercel/functions';

let database;

export default {
  async fetch(request) {
    if (!process.env.DATABASE_URL) {
      return Response.json({ error: 'Portal belum siap digunakan. Hubungi panitia MPK.' }, {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    try {
      if (!database) {
        const pool = supabasePool(process.env.DATABASE_URL);
        attachDatabasePool(pool);
        database = postgresDatabase(pool);
      }
      const url = new URL(request.url);
      if (url.pathname === '/api/portal') {
        const path = url.searchParams.get('mpk_path') ?? '';
        if (!/^[a-z]+(?:\/[a-z-]+){0,2}$/.test(path)) {
          return Response.json({ error: 'Halaman tidak ditemukan.' }, { status: 404 });
        }
        url.pathname = '/api/' + path;
        url.search = '';
        request = new Request(url, request);
      }
      return await worker.fetch(request, {
        DB: database,
        ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
        CLIENT_IP: request.headers.get('x-vercel-forwarded-for') ?? 'vercel',
      });
    } catch {
      return Response.json({ error: 'Konfigurasi server bermasalah.' }, { status: 500 });
    }
  },
};
