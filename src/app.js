const cors = require('cors');
const express = require('express');
const authRoutes = require('./routes/authRoutes');
const billRoutes = require('./routes/billRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const residentRoutes = require('./routes/residentRoutes');
const categoryBillRoutes = require('./routes/categoryBillRoutes');
const financialRoutes = require('./routes/financialRoutes');
const memberRoutes = require('./routes/memberRoutes');
const reportRoutes = require('./routes/reportRoutes');
const discountRoutes = require('./routes/discountRoutes');
const billController = require('./controllers/billController');
const paymentController = require('./controllers/paymentController');
const { requireAuth, requireAdmin } = require('./middleware/authMiddleware');
const { errorMiddleware, notFoundMiddleware } = require('./middleware/errorMiddleware');

const app = express();
const origins = new Set((process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((item) => item.trim().replace(/\/$/, '')));

app.use(cors({ origin: (origin, callback) => (!origin || origins.has(origin.replace(/\/$/, '')) ? callback(null, true) : callback(new Error('Origin is not allowed by CORS.'))) }));
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

app.get(['/health', '/api/health'], (_request, response) => {
  response.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});
app.use('/api/auth', authRoutes);
app.use('/api/residents', residentRoutes);
app.use('/api/bills', billRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/category-bills', categoryBillRoutes);
app.use('/api/financial', financialRoutes);
app.use('/api/member', memberRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/discounts', discountRoutes);

app.get('/api/dashboard', requireAuth, billController.dashboard);
app.patch('/api/allocations/:id/payment', requireAuth, requireAdmin, paymentController.update);

app.use(notFoundMiddleware);
app.use(errorMiddleware);

module.exports = app;
