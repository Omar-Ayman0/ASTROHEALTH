require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const apiRoutes = require('./routes/api');
const { startEngineSyncWorker } = require('./engine_sync_worker');
const { startDataGeneration } = require('./data_generator');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*", // Allow all origins for this demo
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());

// Routes
app.use('/api', apiRoutes);

app.get('/api/openapi.json', (req, res) => {
    res.sendFile(require('path').join(__dirname, 'openapi.json'));
});

// OpenAPI specification
app.get('/api/openapi.json', (req, res) => {
    res.sendFile(require('path').join(__dirname, 'openapi.json'));
});

// Socket.io Connection
io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });

    // Handle incoming messages from clients if needed via socket directly
    socket.on('send_message', (data) => {
        // Broadcast to others
        io.emit('new_message', data);
    });
});

// Start Synthetic Data Stream
startDataGeneration(io);

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
    console.log(`Backend server running on port ${PORT}`);
    startEngineSyncWorker();
});

