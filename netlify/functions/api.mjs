import { getStore } from '@netlify/blobs';
import { gunzipSync } from 'node:zlib';

const STORE_NAME = 'mirror-snapshots';
const KEY_LATEST = 'meta/latest';
const KEY_INDEX = 'meta/index';
const MAX_SNAPSHOTS = 50;

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Content-Encoding',
};

function jsonResponse(data, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            ...CORS_HEADERS,
            ...extraHeaders,
        },
    });
}

async function parseJsonBody(req) {
    const raw = Buffer.from(await req.arrayBuffer());
    if (raw.length === 0) return {};

    const isGzip = raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b;
    const text = isGzip ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.__gzip_b64 === 'string') {
        const unpacked = gunzipSync(Buffer.from(parsed.__gzip_b64, 'base64')).toString('utf8');
        return JSON.parse(unpacked);
    }
    return parsed;
}

function getApiSubpath(reqUrl) {
    const { pathname } = new URL(reqUrl);
    if (pathname.startsWith('/.netlify/functions/api')) {
        return pathname.slice('/.netlify/functions/api'.length) || '/';
    }
    if (pathname.startsWith('/api')) {
        return pathname.slice('/api'.length) || '/';
    }
    return pathname;
}

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const subpath = getApiSubpath(req.url);
    const store = getStore({ name: STORE_NAME, consistency: 'strong' });

    try {
        // POST /api/snapshot
        if (req.method === 'POST' && subpath === '/snapshot') {
            const body = await parseJsonBody(req);
            const { url, title, html, viewportWidth, viewportHeight } = body || {};

            if (!html) {
                return jsonResponse({ error: 'Campo "html" requerido' }, 400);
            }

            const sizeKb = Math.round(Buffer.byteLength(html, 'utf8') / 1024);
            const createdAt = new Date().toISOString();

            const index = (await store.get(KEY_INDEX, { type: 'json' })) || {
                nextId: 1,
                items: [],
            };

            const id = index.nextId;
            index.nextId = id + 1;

            const meta = {
                id,
                url: url || '',
                title: title || '',
                viewport_w: viewportWidth || 1920,
                viewport_h: viewportHeight || 1080,
                size_kb: sizeKb,
                created_at: createdAt,
            };

            const snapshot = { ...meta, html };

            await store.setJSON(`snap/${id}`, snapshot);
            await store.setJSON(KEY_LATEST, meta);

            index.items.unshift(meta);
            const evicted = index.items.splice(MAX_SNAPSHOTS);
            await store.setJSON(KEY_INDEX, index);

            if (evicted.length > 0) {
                await Promise.allSettled(
                    evicted.map((old) => store.delete(`snap/${old.id}`))
                );
            }

            return jsonResponse({ id, sizeKb }, 200);
        }

        // GET /api/snapshot/latest/meta
        if (req.method === 'GET' && subpath === '/snapshot/latest/meta') {
            const meta = await store.get(KEY_LATEST, { type: 'json' });
            if (!meta) return jsonResponse({ error: 'No hay snapshots aún' }, 404);
            return jsonResponse(meta, 200);
        }

        // GET /api/snapshot/latest
        if (req.method === 'GET' && subpath === '/snapshot/latest') {
            const meta = await store.get(KEY_LATEST, { type: 'json' });
            if (!meta) return jsonResponse({ error: 'No hay snapshots aún' }, 404);

            const snap = await store.get(`snap/${meta.id}`, { type: 'json' });
            if (!snap) return jsonResponse({ error: 'Snapshot no encontrado' }, 404);
            return jsonResponse(snap, 200);
        }

        // GET /api/snapshots
        if (req.method === 'GET' && subpath === '/snapshots') {
            const index = await store.get(KEY_INDEX, { type: 'json' });
            return jsonResponse(index ? index.items : [], 200);
        }

        // DELETE /api/snapshots
        if (req.method === 'DELETE' && subpath === '/snapshots') {
            const index = (await store.get(KEY_INDEX, { type: 'json' })) || {
                nextId: 1,
                items: [],
            };
            await Promise.allSettled([
                store.delete(KEY_LATEST),
                store.delete(KEY_INDEX),
                ...index.items.map((item) => store.delete(`snap/${item.id}`)),
            ]);
            return jsonResponse({ message: 'Todos los snapshots eliminados' }, 200);
        }

        // GET /api/snapshot/:id
        if (req.method === 'GET' && subpath.startsWith('/snapshot/')) {
            const idStr = subpath.slice('/snapshot/'.length);
            const id = Number.parseInt(idStr, 10);
            if (!Number.isFinite(id) || String(id) !== idStr) {
                return jsonResponse({ error: 'ID inválido' }, 400);
            }
            const snap = await store.get(`snap/${id}`, { type: 'json' });
            if (!snap) return jsonResponse({ error: 'Snapshot no encontrado' }, 404);
            return jsonResponse(snap, 200);
        }

        return jsonResponse({ error: 'Ruta no encontrada' }, 404);
    } catch (err) {
        console.error('Error en Netlify Function api:', err);
        return jsonResponse({ error: err.message || 'Error interno' }, 500);
    }
}

export const config = {
    path: '/api/*',
};
