require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const mysql   = require('mysql2/promise');
const path    = require('path');

// ── Twilio SMS ────────────────────────────────────────────────
const TWILIO_ACCOUNT_SID = process.env.TWILIO_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER  = '+16812215930';
const BARBER_PHONE        = '+918413036768';

const twilio = require('twilio')(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

const app  = express();
const PORT = process.env.PORT || 3000;
const frontendPath = path.join(__dirname, '..');

// ── Middleware ────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(frontendPath));

// ── Database connection pool ──────────────────────────────────
const pool = mysql.createPool({
    host:     process.env.HOST,
    user:     process.env.USER,
    password: process.env.PASSWORD,
    database: process.env.DB_NAME,
    port:     process.env.DB_PORT,
    ssl:      { rejectUnauthorized: false },
    waitForConnections: true,
    connectionLimit:    10,
});

// ── SSE clients ───────────────────────────────────────────────
let sseClients = [];

// ── Routes ────────────────────────────────────────────────────

// GET /api/admin/notifications - SSE stream for new bookings
app.get('/api/admin/notifications', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
    });

    const clientId = Date.now() + Math.random();
    sseClients.push({ id: clientId, res });

    console.log(`📡 Admin SSE client connected (${sseClients.length})`);

    res.write(`: connected\n\n`);

    const heartbeat = setInterval(() => {
        try { res.write(`: heartbeat\n\n`); }
        catch (e) { clearInterval(heartbeat); }
    }, 25000);

    req.on('close', () => {
        clearInterval(heartbeat);
        sseClients = sseClients.filter(client => client.id !== clientId);
        console.log(`📡 SSE client disconnected (${sseClients.length} remaining)`);
    });
});

// Send SMS alert to the barber
const sendBarberSMS = async (booking, bookingDate) => {
    try {
        await twilio.messages.create({
            to:   BARBER_PHONE,
            from: TWILIO_FROM_NUMBER,
            body: `✂️ New booking!\n${booking.customerName} booked a ${booking.haircutStyle} on ${bookingDate} at ${booking.time}.\nYou've got a hair to cut! 💈`,
        });
        console.log(`📱 SMS sent to barber for booking: ${booking.customerName} at ${booking.time}`);
    } catch (err) {
        console.error('❌ SMS send failed:', err.message);
    }
};

// Emit to all clients
const emitNewBooking = (booking) => {
    const data = `data: ${JSON.stringify(booking)}\n\n`;
    sseClients.forEach(client => {
        client.res.write(data);
    });
    console.log('🔔 Emitted new booking:', booking.customerName);
};

// GET /api/slots?date=2026-04-15
app.get('/api/slots', async (req, res) => {
    const { date } = req.query;

    if (!date) {
        return res.status(400).json({ message: 'date query parameter is required.' });
    }

    try {
        const [rows] = await pool.query(
            `SELECT
                s.id,
                s.time,
                CASE WHEN b.id IS NULL THEN TRUE ELSE FALSE END AS available,
                b.customer_name  AS customerName,
                b.haircut_style  AS haircutStyle
             FROM slots s
             LEFT JOIN bookings b
                ON b.slot_id = s.id AND b.booking_date = ?
             ORDER BY s.id`,
            [date]
        );

        const slots = rows.map(row => ({
            ...row,
            available: row.available === 1 || row.available === true,
        }));

        res.json(slots);
    } catch (err) {
        console.error('GET /api/slots error:', err);
        res.status(500).json({ message: 'Database error. Please try again.' });
    }
});

// POST /api/book
app.post('/api/book', async (req, res) => {
    const { id, customerName, haircutStyle, bookingDate } = req.body;

    if (!id) {
        return res.status(400).json({ message: 'Slot ID is required.' });
    }
    if (!customerName || !String(customerName).trim()) {
        return res.status(400).json({ message: 'Customer name is required.' });
    }
    if (!bookingDate || !String(bookingDate).trim()) {
        return res.status(400).json({ message: 'Booking date is required.' });
    }
    if (!haircutStyle || !String(haircutStyle).trim()) {
        return res.status(400).json({ message: 'Hair style is required.' });
    }

    try {
        const [[slot]] = await pool.query('SELECT * FROM slots WHERE id = ?', [id]);
        if (!slot) {
            return res.status(404).json({ message: 'Slot not found.' });
        }

        const [[existing]] = await pool.query(
            'SELECT id FROM bookings WHERE slot_id = ? AND booking_date = ?',
            [id, bookingDate]
        );
        if (existing) {
            return res.status(400).json({ message: 'This slot is already booked for that date.' });
        }

        const [insertResult] = await pool.query(
            `INSERT INTO bookings (slot_id, booking_date, customer_name, haircut_style)
             VALUES (?, ?, ?, ?)`,
            [id, bookingDate, String(customerName).trim(), String(haircutStyle).trim()]
        );

        const [[newBooking]] = await pool.query(
            `SELECT b.id, s.time, b.customer_name as customerName, b.haircut_style as haircutStyle, b.created_at as createdAt
             FROM bookings b JOIN slots s ON b.slot_id = s.id
             WHERE b.id = LAST_INSERT_ID()`
        );

        emitNewBooking(newBooking);
        sendBarberSMS(newBooking, bookingDate);

        res.status(200).json({
            message: `Booking confirmed for ${bookingDate} at ${slot.time} - ${haircutStyle}.`,
        });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ message: 'This slot was just booked by someone else.' });
        }
        console.error('POST /api/book error:', err);
        res.status(500).json({ message: 'Database error. Please try again.' });
    }
});

// GET /api/admin/bookings?date=2026-04-15
app.get('/api/admin/bookings', async (req, res) => {
    const { date } = req.query;

    if (!date) {
        return res.status(400).json({ message: 'date query parameter is required.' });
    }

    try {
        const [rows] = await pool.query(
            `SELECT
                b.id,
                s.time,
                b.booking_date   AS bookingDate,
                b.customer_name  AS customerName,
                b.haircut_style  AS haircutStyle,
                b.created_at     AS createdAt
             FROM bookings b
             JOIN slots s ON s.id = b.slot_id
             WHERE b.booking_date = ?
             ORDER BY s.id`,
            [date]
        );

        res.json(rows);
    } catch (err) {
        console.error('GET /api/admin/bookings error:', err);
        res.status(500).json({ message: 'Database error.' });
    }
});

// DELETE /api/admin/bookings/:id
app.delete('/api/admin/bookings/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const [result] = await pool.query('DELETE FROM bookings WHERE id = ?', [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Booking not found.' });
        }

        res.json({ message: 'Booking cancelled successfully.' });
    } catch (err) {
        console.error('DELETE /api/admin/bookings error:', err);
        res.status(500).json({ message: 'Database error.' });
    }
});

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(frontendPath, 'Admin', 'admin.html'));
});

// ── Start server ──────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`✅  Server running  →  http://localhost:${PORT}`);
});
