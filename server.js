const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Connect to PostgreSQL (Optimized for Neon)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || '',
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
    // Prevents dropped/stale connections in Neon serverless environments
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
});

// Serve frontend page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ------------------- API ROUTES -------------------

// 1. Fetch Master Metadata
app.get('/api/meta', async (req, res) => {
    try {
        const accounts = await pool.query('SELECT account_id, account_name, account_type FROM accounts ORDER BY account_id;');
        const categories = await pool.query('SELECT category_id, category_name, category_type FROM categories ORDER BY category_name;');
        
        res.json({
            accounts: accounts.rows,
            categories: categories.rows
        });
    } catch (err) {
        console.error('Error fetching metadata:', err);
        res.status(500).json({ error: 'Failed to fetch meta data' });
    }
});

// 2. Get Balances
app.get('/api/balances', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM v_account_balances ORDER BY account_id;');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching balances:', err);
        res.status(500).json({ error: 'Database error fetching balances' });
    }
});

// 3. Get Recent Transactions Log (Fixed Transfer Account Name Join)
app.get('/api/transactions/recent', async (req, res) => {
    try {
        const query = `
            SELECT 
                t.transaction_id, 
                t.transaction_date, 
                t.amount, 
                t.transaction_type, 
                t.remarks, 
                a.account_name, 
                a.account_type,
                dest_a.account_name AS destination_account_name,
                c.category_name
            FROM transactions t
            LEFT JOIN accounts a ON t.account_id = a.account_id
            LEFT JOIN accounts dest_a ON t.destination_account_id = dest_a.account_id
            LEFT JOIN categories c ON t.category_id = c.category_id
            ORDER BY t.transaction_date DESC, t.created_at DESC 
            LIMIT 10;
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching recent transactions:', err);
        res.status(500).json({ error: 'Database error fetching transactions' });
    }
});

// 4. Add New Transaction (Fixed Empty Date Sanitization & Validations)
app.post('/api/transactions', async (req, res) => {
    const { 
        transaction_date, 
        amount, 
        transaction_type, 
        account_id, 
        destination_account_id, 
        category_id, 
        remarks 
    } = req.body;

    // Basic Validation
    if (!amount || !transaction_type || !account_id) {
        return res.status(400).json({ error: 'Missing required transaction fields' });
    }

    try {
        const query = `
            INSERT INTO transactions 
                (transaction_date, amount, transaction_type, account_id, destination_account_id, category_id, remarks)
            VALUES 
                (COALESCE($1::date, CURRENT_DATE), $2, $3, $4, $5, $6, $7) 
            RETURNING *;
        `;
        
        const values = [
            transaction_date && transaction_date.trim() !== '' ? transaction_date : null,
            amount,
            transaction_type,
            account_id,
            transaction_type === 'TRANSFER' ? destination_account_id : null,
            transaction_type !== 'TRANSFER' ? category_id : null,
            remarks || ''
        ];

        const result = await pool.query(query, values);
        res.json({ success: true, transaction: result.rows[0] });
    } catch (err) {
        console.error('Error saving transaction:', err);
        res.status(500).json({ error: 'Database insert failed' });
    }
});

// ------------------- FINANCIAL REPORTS & CHARTS -------------------

// Category Expense Breakdown (for Pie Chart)
app.get('/api/reports/categories', async (req, res) => {
    try {
        const query = `
            SELECT 
                COALESCE(c.category_name, 'Uncategorized') AS category_name,
                SUM(t.amount) AS total_amount
            FROM transactions t
            LEFT JOIN categories c ON t.category_id = c.category_id
            WHERE t.transaction_type = 'EXPENSE'
            GROUP BY COALESCE(c.category_name, 'Uncategorized')
            ORDER BY total_amount DESC;
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching category breakdown:', err);
        res.status(500).json({ error: 'Database error fetching category report' });
    }
});

// Monthly Report
app.get('/api/reports/monthly', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM v_monthly_summary;');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching monthly report:', err);
        res.status(500).json({ error: 'Database error fetching monthly summary' });
    }
});

// Quarterly FY Report
app.get('/api/reports/quarterly', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM v_quarterly_summary;');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching quarterly report:', err);
        res.status(500).json({ error: 'Database error fetching quarterly summary' });
    }
});

// Annual FY Report
app.get('/api/reports/annual', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM v_annual_summary;');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching annual report:', err);
        res.status(500).json({ error: 'Database error fetching annual summary' });
    }
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
