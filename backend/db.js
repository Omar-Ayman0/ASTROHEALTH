const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');

// DB_PATH lets containers keep the database on a mounted volume (default: next to this file)
const dbPath = process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.resolve(__dirname, 'health_monitor.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        return;
    }

    console.log('Connected to the SQLite database.');
    initDb();
});

function initDb() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender_role TEXT,
            receiver_role TEXT,
            content TEXT,
            timestamp TEXT,
            status TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            role TEXT,
            age INTEGER,
            blood_type TEXT,
            medical_history TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS vitals_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            heart_rate INTEGER,
            spo2 INTEGER,
            bp_sys INTEGER,
            bp_dia INTEGER,
            temperature REAL,
            stress_level INTEGER,
            sleep_hours REAL,
            risk_label TEXT,
            astronaut_id TEXT NOT NULL DEFAULT 'ASTRO_01'
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            text TEXT,
            completed INTEGER DEFAULT 0,
            timestamp TEXT,
            type TEXT DEFAULT 'personal'
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS health_alert_outbox (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id TEXT NOT NULL UNIQUE,
            payload_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            delivered_at TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS incidents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            incident_id TEXT NOT NULL UNIQUE,
            event_id TEXT NOT NULL UNIQUE,
            astronaut_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'PENDING_MEDICAL_REVIEW',
            severity TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            assigned_role TEXT NOT NULL DEFAULT 'MEDICAL_OFFICER',
            source TEXT,
            payload_json TEXT,
            engine_status TEXT NOT NULL DEFAULT 'ACTIVE'
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS incident_actions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            incident_id TEXT NOT NULL,
            action_type TEXT NOT NULL,
            previous_status TEXT,
            new_status TEXT NOT NULL,
            actor TEXT,
            notes TEXT,
            request_id TEXT UNIQUE,
            created_at TEXT NOT NULL
        )`);

        db.run(`CREATE INDEX IF NOT EXISTS idx_incident_actions_incident
            ON incident_actions(incident_id, created_at)`);

        db.run(`CREATE INDEX IF NOT EXISTS idx_incidents_astronaut
            ON incidents(astronaut_id, created_at)`);

        db.run(`CREATE TABLE IF NOT EXISTS engine_sync_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            engine_instance_id TEXT NOT NULL,
            next_since_seq INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS engine_event_receipts (
            emission_id TEXT NOT NULL,
            engine_instance_id TEXT NOT NULL,
            sequence INTEGER NOT NULL,
            event_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            processed_at TEXT NOT NULL,
            PRIMARY KEY (engine_instance_id, emission_id)
        )`);

        // Authentication users
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_salt TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('admin', 'astronaut', 'doctor')),
            astronaut_id TEXT UNIQUE,
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL
        )`);

        // Persistent sessions
        db.run(`CREATE TABLE IF NOT EXISTS user_sessions (
            sid TEXT PRIMARY KEY,
            sess TEXT NOT NULL,
            expires INTEGER NOT NULL
        )`);

        db.run(`CREATE INDEX IF NOT EXISTS idx_user_sessions_expires
            ON user_sessions(expires)`);

        // Existing database migrations
        db.run(
            `ALTER TABLE incidents ADD COLUMN engine_status TEXT NOT NULL DEFAULT 'ACTIVE'`,
            (err) => {
                if (err && !err.message.includes('duplicate column name')) {
                    console.error('Incidents migration:', err.message);
                }
            }
        );

        db.run(
            `ALTER TABLE tasks ADD COLUMN type TEXT DEFAULT 'personal'`,
            (err) => {
                if (err && !err.message.includes('duplicate column name')) {
                    console.error('Tasks migration:', err.message);
                }
            }
        );

        db.run(
            `ALTER TABLE vitals_log ADD COLUMN astronaut_id TEXT NOT NULL DEFAULT 'ASTRO_01'`,
            (err) => {
                if (err && !err.message.includes('duplicate column name')) {
                    console.error('Vitals migration:', err.message);
                }
            }
        );

        // WF05: Smart Escalation + AI Triage Brief migrations
        const incidentTriageColumns = [
            ["triage_brief_json", "TEXT"],
            ["triage_status", "TEXT NOT NULL DEFAULT 'PENDING'"],
            ["triage_generated_at", "TEXT"]
        ];

        incidentTriageColumns.forEach(([column, definition]) => {
            db.run(
                `ALTER TABLE incidents ADD COLUMN ${column} ${definition}`,
                (err) => {
                    if (err && !err.message.includes('duplicate column name')) {
                        console.error(`WF05 incidents migration (${column}):`, err.message);
                    }
                }
            );
        });

        db.run(`CREATE TABLE IF NOT EXISTS incident_triage_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            incident_id TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL DEFAULT 'PENDING'
                CHECK(status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
            attempt_count INTEGER NOT NULL DEFAULT 0,
            locked_at TEXT,
            completed_at TEXT,
            last_error TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (incident_id) REFERENCES incidents(incident_id)
        )`);

        db.run(`CREATE INDEX IF NOT EXISTS idx_triage_jobs_status_created
            ON incident_triage_jobs(status, created_at)`);

        db.run(`CREATE TABLE IF NOT EXISTS incident_escalations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            incident_id TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL DEFAULT 'ACTIVE'
                CHECK(status IN ('ACTIVE', 'CANCELLED', 'COMPLETED')),
            stage TEXT NOT NULL DEFAULT 'REMINDER_1'
                CHECK(stage IN ('REMINDER_1', 'ESCALATED')),
            due_at TEXT NOT NULL,
            reminder_count INTEGER NOT NULL DEFAULT 0,
            last_request_id TEXT UNIQUE,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            cancelled_at TEXT,
            FOREIGN KEY (incident_id) REFERENCES incidents(incident_id)
        )`);

        db.run(`CREATE INDEX IF NOT EXISTS idx_escalations_due
            ON incident_escalations(status, due_at)`);

        // End WF05 migrations

        seedDefaultUsers();
    });
}

function seedDefaultUsers() {
    // Demo accounts are created once (INSERT OR IGNORE). Set SEED_PASSWORD before the FIRST start
    // of a deployment that is reachable from the internet; existing users are never modified.
    const SEED_PASSWORD = process.env.SEED_PASSWORD || '123456';
    if (SEED_PASSWORD === '123456' && process.env.NODE_ENV === 'production') {
        console.warn('[security] Demo accounts use the default password. Set SEED_PASSWORD before first start, or change the passwords.');
    }
    const accounts = [
        { username: 'admin', password: SEED_PASSWORD, role: 'admin', astronautId: null },
        { username: 'astro01', password: SEED_PASSWORD, role: 'astronaut', astronautId: 'ASTRO_01' },
        { username: 'astro02', password: SEED_PASSWORD, role: 'astronaut', astronautId: 'ASTRO_02' },
        { username: 'astro03', password: SEED_PASSWORD, role: 'astronaut', astronautId: 'ASTRO_03' },
        { username: 'astro04', password: SEED_PASSWORD, role: 'astronaut', astronautId: 'ASTRO_04' },
        { username: 'doctor', password: SEED_PASSWORD, role: 'doctor', astronautId: null }
    ];

    const insert = db.prepare(`
        INSERT OR IGNORE INTO users
        (username, password_salt, password_hash, role, astronaut_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const account of accounts) {
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = crypto.scryptSync(account.password, salt, 64).toString('hex');

        insert.run(
            account.username,
            salt,
            hash,
            account.role,
            account.astronautId,
            new Date().toISOString()
        );
    }

    insert.finalize((err) => {
        if (err) {
            console.error('User seeding failed:', err.message);
            return;
        }

        console.log('Authentication database initialized.');
    });
}

module.exports = db;
