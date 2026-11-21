require('dotenv').config();

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const session = require('express-session');

const SQLiteSessionStore = require('./sqlite_session_store');
const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/auth');

const { startEngineSyncWorker } = require('./engine_sync_worker');
const { startDataGeneration } = require('./data_generator');

const app = express();
const server = http.createServer(app);

// Comma-separated list, e.g. "http://localhost:5173,https://your-app.vercel.app"
const FRONTEND_ORIGIN = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);

const IS_PROD = process.env.NODE_ENV === 'production'
    || Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_NAME);

if (!process.env.SESSION_SECRET) {
    console.error('SESSION_SECRET is not set. Copy backend/.env.example to backend/.env and set a long random value.');
    process.exit(1);
}

// Behind a TLS-terminating reverse proxy (nginx, Caddy, a PaaS); needed for secure cookies
app.set('trust proxy', 1);

// Cookie flags follow NODE_ENV by default. Override only when needed (e.g. plain-HTTP staging):
//   COOKIE_SECURE=true|false   COOKIE_SAMESITE=lax|strict|none
const COOKIE_SECURE = process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE === 'true'
    : IS_PROD;
const COOKIE_SAMESITE = process.env.COOKIE_SAMESITE || (IS_PROD ? 'none' : 'lax');

const io = socketIo(server, {
    cors: {
        origin: FRONTEND_ORIGIN,
        methods: ['GET', 'POST'],
        credentials: true
    }
});

app.use(cors({
    origin: FRONTEND_ORIGIN,
    credentials: true
}));

app.use(express.json());

app.use(session({
    name: 'astrohealth.sid',
    secret: process.env.SESSION_SECRET,
    store: new SQLiteSessionStore(),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
        httpOnly: true,
        secure: COOKIE_SECURE,
        sameSite: COOKIE_SAMESITE,
        maxAge: 30 * 24 * 60 * 60 * 1000
    }
}));

app.use('/api/auth', authRoutes);
app.use('/api', apiRoutes);

app.get('/api/openapi.json', (req, res) => {
    res.sendFile(require('path').join(__dirname, 'openapi.json'));
});

io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });

    socket.on('send_message', (data) => {
        io.emit('new_message', data);
    });
});

startDataGeneration(io);

const PORT = process.env.PORT || 4000;

server.listen(PORT, () => {
    console.log(`Backend server running on port ${PORT}`);
    console.log('Authentication routes registered.');
    startEngineSyncWorker();
});
