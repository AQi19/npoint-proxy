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

// ---------- 初始化 ----------
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

// ---------- 追加白名单（含重试） ----------
app.post('/api/append', async (req, res) => {
    const { name, phone } = req.body;
    if (!name || !phone) {
        return res.status(400).json({ success: false, message: '姓名和手机号不能为空' });
    }

    // 核心操作函数，可重复调用
    async function performAppend(attempt = 1) {
        // 如果 token 不存在，先登录
        if (!csrfToken) await login();

        // 1. 获取当前文档
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

        // 2. 更新文档
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
        return result;
    }

    try {
        const result = await performAppend();
        res.json({ success: true, data: result });
    } catch (err) {
        // 如果错误是认证相关 (401 或 CSRF)，尝试重新登录并重试一次
        const errMsg = err.message;
        if (errMsg.includes('401') || errMsg.includes('CSRF') || errMsg.includes('获取文档失败')) {
            try {
                console.log('认证失败，重新登录并重试...');
                await login(); // 重新登录
                // 重试一次
                const result = await performAppend();
                res.json({ success: true, data: result });
                return;
            } catch (retryErr) {
                // 重试仍然失败，返回错误
                res.status(500).json({ success: false, message: `重试失败: ${retryErr.message}` });
                return;
            }
        }
        // 其他错误
        res.status(500).json({ success: false, message: err.message });
    }
});

exports.handler = serverless(app);
