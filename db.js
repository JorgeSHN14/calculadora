const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// ============ Inicialización ============

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'mirror.db'));
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

// Crear tablas
db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        url         TEXT    NOT NULL,
        title       TEXT    DEFAULT '',
        html        TEXT    NOT NULL,
        viewport_w  INTEGER DEFAULT 1920,
        viewport_h  INTEGER DEFAULT 1080,
        size_kb     INTEGER DEFAULT 0,
        created_at  TEXT    DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_created
        ON snapshots(created_at DESC);
`);

const MAX_SNAPSHOTS = 150;

// ============ Prepared statements ============

const stmts = {
    insert: db.prepare(`
        INSERT INTO snapshots (url, title, html, viewport_w, viewport_h, size_kb)
        VALUES (@url, @title, @html, @viewportW, @viewportH, @sizeKb)
    `),

    latest: db.prepare(`
        SELECT * FROM snapshots ORDER BY id DESC LIMIT 1
    `),

    latestMeta: db.prepare(`
        SELECT id, url, title, viewport_w, viewport_h, size_kb, created_at
        FROM snapshots ORDER BY id DESC LIMIT 1
    `),

    listAll: db.prepare(`
        SELECT id, url, title, viewport_w, viewport_h, size_kb, created_at
        FROM snapshots ORDER BY id DESC LIMIT 200
    `),

    getById: db.prepare(`
        SELECT * FROM snapshots WHERE id = ?
    `),

    count: db.prepare(`
        SELECT COUNT(*) AS cnt FROM snapshots
    `),

    pruneOld: db.prepare(`
        DELETE FROM snapshots WHERE id NOT IN (
            SELECT id FROM snapshots ORDER BY id DESC LIMIT ?
        )
    `),

    deleteAll: db.prepare(`
        DELETE FROM snapshots
    `),
};

// ============ API pública ============

module.exports = {
    /**
     * Guarda un snapshot y retorna su id.
     */
    saveSnapshot({ url, title, html, viewportW, viewportH }) {
        const sizeKb = Math.round(Buffer.byteLength(html, 'utf8') / 1024);
        const info = stmts.insert.run({ url, title: title || '', html, viewportW: viewportW || 1920, viewportH: viewportH || 1080, sizeKb });

        // Auto-limpieza
        const { cnt } = stmts.count.get();
        if (cnt > MAX_SNAPSHOTS) stmts.pruneOld.run(MAX_SNAPSHOTS);

        return { id: Number(info.lastInsertRowid), sizeKb };
    },

    /** Último snapshot completo (con HTML). */
    getLatest() {
        return stmts.latest.get() || null;
    },

    /** Metadatos del último snapshot (sin HTML). */
    getLatestMeta() {
        return stmts.latestMeta.get() || null;
    },

    /** Lista de snapshots (metadatos). */
    listAll() {
        return stmts.listAll.all();
    },

    /** Snapshot completo por id. */
    getById(id) {
        return stmts.getById.get(id) || null;
    },

    /** Borra todos los snapshots. */
    deleteAll() {
        stmts.deleteAll.run();
        db.exec('VACUUM');
    },

    /** Cierra la conexión. */
    close() {
        db.close();
    },
};
