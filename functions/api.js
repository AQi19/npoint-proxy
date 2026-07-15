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
let cachedContents = null;
let cachedOriginalContents = '';

async function login() {
    console.log('🔐 登录 nPoint...');
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
    console.log('✅ 登录成功');
    return token;
}

async function fetchDocument(useCache = true) {
    if (useCache && cachedContents && cachedOriginalContents) {
        console.log('📦 使用缓存文档');
        return { contents: cachedContents, originalContents: cachedOriginalContents };
    }
    console.log('📥 从 nPoint 获取文档...');
    const resp = await fetch(`${CONFIG.baseUrl}/documents/${CONFIG.docId}`, {
        headers: { 'x-csrf-token': csrfToken, 'Accept': 'application/json' },
    });
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`获取文档失败 (${resp.status}): ${text}`);
    }
    const data = await resp.json();
    const contents = data.contents || { whitelist: [] };
    const originalContents = data.original_contents || '';
    cachedContents = contents;
    cachedOriginalContents = originalContents;
    return { contents, originalContents };
}

app.get('/api/init', async (req, res) => {
    try {
        if (!csrfToken) await login();
        await fetchDocument(false);
        res.json({ success: true, message: '初始化完成' });
    } catch (err) {
        console.error('初始化错误:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/append', async (req, res) => {
    const { name, phone } = req.body;
    if (!name || !phone) {
        return res.status(400).json({ success: false, message: '姓名和手机号不能为空' });
    }

    // 整体超时 28 秒（略低于 Netlify 的 30 秒限制）
    const TIMEOUT_MS = 28000;
    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('处理超时，请立即重试一次')), TIMEOUT_MS)
    );

    try {
        const result = await Promise.race([
            performAppend(name, phone),
            timeoutPromise
        ]);
        res.json({ success: true, data: result });
    } catch (err) {
        console.error('append 错误:', err.message);
        if (err.message.includes('超时')) {
            res.status(504).json({
                success: false,
                message: '⏳ 处理超时（冷启动较慢），请立即点击“提交”重试一次，通常第二次会成功'
            });
        } else {
            res.status(500).json({ success: false, message: err.message });
        }
    }
});

async function performAppend(name, phone) {
    if (!csrfToken) {
        console.log('Token 为空，先登录');
        await login();
    }

    let doc;
    try {
        doc = await fetchDocument(true);
    } catch (err) {
        if (err.message.includes('401') || err.message.includes('CSRF')) {
            console.log('Token 失效，重新登录...');
            await login();
            doc = await fetchDocument(false);
        } else {
            throw err;
        }
    }

    const { contents, originalContents } = doc;
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

    console.log('📤 更新文档...');
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
    cachedContents = contents;
    cachedOriginalContents = originalContents;
    console.log('✅ 更新成功');
    return result;
}

exports.handler = serverless(app);
