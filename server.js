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

// Connect to Neon PostgreSQL database using environment variable
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || '',
    ssl: { rejectUnauthorized: false }
});

// Serve frontend home page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ------------------- API ROUTES -------------------

// 1. Fetch Master Metadata (Accounts & Categories for Dropdowns)
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

// 2. Get Balances for Dashboard KPI Cards
app.get('/api/balances', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM v_account_balances ORDER BY account_id;');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching balances:', err);
        res.status(500).json({ error: 'Database error fetching balances' });
    }
});

// 3. Get Recent Transactions Log
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
                c.category_name
            FROM transactions t
            LEFT JOIN accounts a ON t.account_id = a.account_id
            LEFT JOIN categories c ON t.category_id = c.category_id
            ORDER BY t.created_at DESC 
            LIMIT 10;
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching recent transactions:', err);
        res.status(500).json({ error: 'Database error fetching transactions' });
    }
});

// 4. Add New Transaction (Income, Expense, Transfer)
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

    try {
        const query = `
            INSERT INTO transactions 
                (transaction_date, amount, transaction_type, account_id, destination_account_id, category_id, remarks)
            VALUES 
                (COALESCE($1::date, CURRENT_DATE), $2, $3, $4, $5, $6, $7) 
            RETURNING *;
        `;
        
        const values = [
            transaction_date || null,
            amount,
            transaction_type,
            account_id,
            destination_account_id || null,
            category_id || null,
            remarks || ''
        ];

        const result = await pool.query(query, values);
        res.json({ success: true, transaction: result.rows[0] });
    } catch (err) {
        console.error('Error saving transaction:', err);
        res.status(500).json({ error: 'Database insert failed' });
    }
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
