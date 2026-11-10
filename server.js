const express = require('express');
const cors = require('cors');
const path = require('path');
const zlib = require('zlib');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3700;

// ============ Middleware ============

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: false, limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ============ API Routes ============

/**
 * POST /api/snapshot
 * Recibe un snapshot del inyector.
 */
app.post('/api/snapshot', (req, res) => {
    try {
        let body = req.body;
        if (body && typeof body.__gzip_b64 === 'string') {
            body = JSON.parse(zlib.gunzipSync(Buffer.from(body.__gzip_b64, 'base64')).toString('utf8'));
        }
        const { url, title, html, viewportWidth, viewportHeight } = body;
        if (!html) {
            return res.status(400).json({ error: 'Campo "html" requerido' });
        }

        const result = db.saveSnapshot({
            url: url || '',
            title: title || '',
            html,
            viewportW: viewportWidth || 1920,
            viewportH: viewportHeight || 1080,
        });

        const ts = new Date().toLocaleTimeString('es-EC');
        console.log(`[${ts}] 📸 Snapshot #${result.id}  ${result.sizeKb} KB  ${title || ''}`);
        console.log(`       ${url}`);

        res.json({ id: result.id, sizeKb: result.sizeKb });
    } catch (err) {
        console.error('Error guardando snapshot:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/snapshot/latest
 * Retorna el snapshot más reciente (completo).
 */
app.get('/api/snapshot/latest', (req, res) => {
    const snap = db.getLatest();
    if (!snap) return res.status(404).json({ error: 'No hay snapshots aún' });
    res.json(snap);
});

/**
 * GET /api/snapshot/latest/meta
 * Retorna solo metadatos del último snapshot (para polling liviano).
 */
app.get('/api/snapshot/latest/meta', (req, res) => {
    const meta = db.getLatestMeta();
    if (!meta) return res.status(404).json({ error: 'No hay snapshots aún' });
    res.json(meta);
});

/**
 * GET /api/snapshot/:id
 * Retorna un snapshot específico por id.
 */
app.get('/api/snapshot/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

    const snap = db.getById(id);
    if (!snap) return res.status(404).json({ error: 'Snapshot no encontrado' });
    res.json(snap);
});

/**
 * GET /api/snapshots
 * Lista todos los snapshots (solo metadatos).
 */
app.get('/api/snapshots', (_req, res) => {
    res.json(db.listAll());
});

/**
 * DELETE /api/snapshots
 * Borra todos los snapshots.
 */
app.delete('/api/snapshots', (_req, res) => {
    db.deleteAll();
    console.log('🗑️  Todos los snapshots eliminados');
    res.json({ message: 'Todos los snapshots eliminados' });
});

// ============ Fallback SPA ============

app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============ Start ============

app.listen(PORT, () => {
    console.log('');
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║   🪞  Mirror Server — Aula Virtual ESPOL    ║');
    console.log('╠══════════════════════════════════════════════╣');
    console.log(`║   📺  Mirror:   http://localhost:${PORT}          ║`);
    console.log(`║   📡  API:      http://localhost:${PORT}/api      ║`);
    console.log('╚══════════════════════════════════════════════╝');
    console.log('');
    console.log('Esperando snapshots del inyector...');
    console.log('');
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nCerrando servidor...');
    db.close();
    process.exit(0);
});

process.on('SIGTERM', () => {
    db.close();
    process.exit(0);
});
