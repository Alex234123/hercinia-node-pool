/**
 * Cloudflare Pages Function: /api/admin/verify
 * 站长身份验证与 HMAC-SHA256 Token 签发中心
 * 绑定 KV: AUTH_KV (HERCINIA_POOL_KV)
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

// 恒定时间字符串比对（防时序攻击）
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// 生成 Base64Url
function base64UrlEncode(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Web Crypto HMAC-SHA256 签名
async function signHmac(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  const hashArray = Array.from(new Uint8Array(signature));
  const hashStr = String.fromCharCode.apply(null, hashArray);
  return base64UrlEncode(hashStr);
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: withSecurityHeaders() });
  }

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: withSecurityHeaders() });
  }

  const kv = env.AUTH_KV;
  const clientIp = request.headers.get('cf-connecting-ip') || 'unknown';
  const lockoutKey = `fail_ip:${clientIp}`;
  const now = Math.floor(Date.now() / 1000);

  // 1. 先查 lockout 熔断锁定状态
  if (kv) {
    try {
      const lockData = await kv.get(lockoutKey, { type: 'json' });
      if (lockData && lockData.lockUntil && now < lockData.lockUntil) {
        const remaining = lockData.lockUntil - now;
        return new Response(JSON.stringify({
          success: false,
          error: `登录尝试次数过多，IP已被安全锁定，请在 ${remaining} 秒后再试`
        }), {
          status: 429,
          headers: withSecurityHeaders()
        });
      }
    } catch (e) {}
  }

  // 2. 解析请求
  let bodyKey = '';
  try {
    const json = await request.json();
    bodyKey = (json.key || json.password || '').trim();
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: '无效请求格式' }), {
      status: 400,
      headers: withSecurityHeaders()
    });
  }

  // 获取服务端有效密钥（支持 ADMIN_KEY 环境变量，以及初始平滑过渡默认密码）
  const validAdminKey = (env.ADMIN_KEY || 'jia123feng').trim();
  const adminSecret = (env.ADMIN_SECRET || 'hercinia_super_secure_hmac_secret_2026_default').trim();

  // 3. 常量时间安全比对
  const isMatch = timingSafeEqual(bodyKey, validAdminKey);

  if (!isMatch) {
    // 失败计数处理（达到 5 次写入 15 分钟 lockUntil）
    if (kv) {
      try {
        const lockData = (await kv.get(lockoutKey, { type: 'json' })) || { count: 0 };
        const newCount = (lockData.count || 0) + 1;
        if (newCount >= 5) {
          // 达阈值仅写一次 15 分钟锁定，节省写配额
          await kv.put(lockoutKey, JSON.stringify({ count: newCount, lockUntil: now + 900 }), { expirationTtl: 900 });
        } else {
          await kv.put(lockoutKey, JSON.stringify({ count: newCount }), { expirationTtl: 900 });
        }
      } catch (e) {}
    }

    return new Response(JSON.stringify({ success: false, error: '管理口令错误，已记录安全事件' }), {
      status: 401,
      headers: withSecurityHeaders()
    });
  }

  // 4. 验证成功，清除失败记录
  if (kv) {
    try {
      await kv.delete(lockoutKey);
    } catch (e) {}
  }

  // 5. 签发 2 小时有效期的 HMAC-SHA256 Token
  const payload = {
    sub: 'admin',
    exp: now + 7200, // 2 小时
    jti: crypto.randomUUID()
  };

  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signatureB64 = await signHmac(adminSecret, payloadB64);
  const token = `${payloadB64}.${signatureB64}`;

  return new Response(JSON.stringify({
    success: true,
    token: token,
    expiresIn: 7200,
    message: 'Authentication successful'
  }), {
    status: 200,
    headers: withSecurityHeaders()
  });
}
