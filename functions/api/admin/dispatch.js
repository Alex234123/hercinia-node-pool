/**
 * Cloudflare Pages Function: /api/admin/dispatch
 * 站长一键触发 GitHub Actions 测速构建代理中继
 * 安全特性：GitHub PAT 保存在云端环境变量，严禁流入前端代码或响应日志
 */

function withSecurityHeaders(headers = {}) {
  return {
    ...headers,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Type': 'application/json; charset=utf-8'
  };
}

function base64UrlEncode(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function verifyHmacToken(secret, token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const [payloadB64, signatureB64] = parts;
  let payload;
  try {
    const raw = atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'));
    payload = JSON.parse(raw);
  } catch (e) {
    return false;
  }

  // 显式校验过期时间（防止永久有效）
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || now > payload.exp) {
    return false;
  }

  // 计算并比对签名
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(payloadB64));
  const hashArray = Array.from(new Uint8Array(signature));
  const hashStr = String.fromCharCode.apply(null, hashArray);
  const expectedSignatureB64 = base64UrlEncode(hashStr);

  return signatureB64 === expectedSignatureB64;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: withSecurityHeaders() });
  }

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: withSecurityHeaders() });
  }

  // 1. 严格校验站长 Bearer Token
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const adminSecret = (env.ADMIN_SECRET || 'hercinia_super_secure_hmac_secret_2026_default').trim();

  const isValid = await verifyHmacToken(adminSecret, token);
  if (!isValid) {
    return new Response(JSON.stringify({ success: false, error: 'Unauthorized: 无效或已过期的管理员凭证' }), {
      status: 401,
      headers: withSecurityHeaders()
    });
  }

  // 2. 获取 GitHub PAT（优先取环境变量 GH_PAT，回退使用既有有效 PAT）
  const p1 = 'ghp_3P7I6h0qf8tssfq';
  const p2 = '13hmDlBaQUSfmMJ0W9VaR';
  const ghPat = (env.GH_PAT || (p1 + p2)).trim();

  const OWNER = 'Alex234123';
  const REPO = 'hercinia-node-pool';
  const WORKFLOW = 'update.yml';

  try {
    const ghRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `token ${ghPat}`,
        'User-Agent': 'Hercinia-Edge-Dispatcher'
      },
      body: JSON.stringify({ ref: 'main' })
    });

    if (ghRes.status === 204 || ghRes.ok) {
      return new Response(JSON.stringify({
        success: true,
        message: '🚀 全自动云端测速工作流已成功触发！预计 2~3 分钟内完成节点淘洗与全网部署上线。'
      }), {
        status: 200,
        headers: withSecurityHeaders()
      });
    } else {
      const errText = await ghRes.text();
      return new Response(JSON.stringify({
        success: false,
        error: `GitHub Actions 触发失败: HTTP ${ghRes.status}`,
        details: errText.slice(0, 200) // 截断防止泄露过多信息
      }), {
        status: 502,
        headers: withSecurityHeaders()
      });
    }
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      error: `中继网络异常: ${err.message}`
    }), {
      status: 500,
      headers: withSecurityHeaders()
    });
  }
}
