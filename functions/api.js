const express = require('express');
const serverless = require('serverless-http');
const fetch = require('node-fetch');

const app = express();
app.use(express.json({ limit: '10mb' }));

const CONFIG = {
    email: '1403257960@qq.com',
    password: 'z1403257960',
    docId: 'd530963c2b4e70a7b4e6',
    baseUrl: 'https://www.npoint.io',
};

let csrfToken = '';

async function login() {
    const resp = await fetch(`${CONFIG.baseUrl}/users/sign_in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ user: { email: CONFIG.email, password: CONFIG.password } }),
    });
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`登录失败 (${resp.status}): ${text}`);
    }
    const token = resp.headers.get('x-csrf-token');
    if (!token) throw new Error('登录响应中缺少 x-csrf-token');
    csrfToken = token;
    return token;
}

app.get('/api/init', async (req, res) => {
    try {
        await login();
        const docResp = await fetch(`${CONFIG.baseUrl}/documents/${CONFIG.docId}`, {
            headers: { 'x-csrf-token': csrfToken, 'Accept': 'application/json' },
        });
        if (!docResp.ok) {
            const text = await docResp.text();
            throw new Error(`获取文档失败 (${docResp.status}): ${text}`);
        }
        const data = await docResp.json();
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/append', async (req, res) => {
    const { name, phone } = req.body;
    if (!name || !phone) {
        return res.status(400).json({ success: false, message: '姓名和手机号不能为空' });
    }
    try {
        if (!csrfToken) await login();

        const getResp = await fetch(`${CONFIG.baseUrl}/documents/${CONFIG.docId}`, {
            headers: { 'x-csrf-token': csrfToken, 'Accept': 'application/json' },
        });
        if (!getResp.ok) {
            const text = await getResp.text();
            throw new Error(`获取文档失败 (${getResp.status}): ${text}`);
        }
        const doc = await getResp.json();
        const contents = doc.contents || { whitelist: [] };
        const originalContents = doc.original_contents || '';

        if (!Array.isArray(contents.whitelist)) contents.whitelist = [];
        contents.whitelist.push({
            name,
            phone,
            timestamp: new Date().toISOString(),
        });

        const newContentsStr = JSON.stringify(contents);
        const payload = {
            contents: newContentsStr,
            original_contents: originalContents,
            schema: null,
            original_schema: '',
        };

        const patchResp = await fetch(`${CONFIG.baseUrl}/documents/${CONFIG.docId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'x-csrf-token': csrfToken,
            },
            body: JSON.stringify(payload),
        });
        if (!patchResp.ok) {
            const text = await patchResp.text();
            throw new Error(`更新失败 (${patchResp.status}): ${text}`);
        }
        const result = await patchResp.json();
        res.json({ success: true, data: result });
    } catch (err) {
        if (err.message.includes('CSRF') || err.message.includes('401')) {
            try {
                await login();
                return res.status(401).json({ success: false, message: '认证已刷新，请重试' });
            } catch (e) {
                return res.status(500).json({ success: false, message: `重试失败: ${e.message}` });
            }
        }
        res.status(500).json({ success: false, message: err.message });
    }
});

exports.handler = serverless(app);
