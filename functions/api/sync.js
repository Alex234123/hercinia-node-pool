/**
 * Cloudflare Pages Function: /api/sync
 * 真正跨浏览器、跨设备的云端实时数据同步中心
 * 绑定 KV: AUTH_KV (HERCINIA_POOL_KV)
 * 安全特性：GET 保持公开支持前台用户读取公告与源状态；POST 强制执行 HMAC-SHA256 鉴权
 */

function withSecurityHeaders(headers = {}) {
  return {
    ...headers,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

  // 显式校验过期时间
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

  const kv = env.AUTH_KV;
  if (!kv) {
    return new Response(JSON.stringify({ error: 'AUTH_KV binding not found' }), {
      status: 500,
      headers: withSecurityHeaders()
    });
  }

  // GET: 获取全网最新的授权码、激活用户、聚合订阅源与全站公告（前台依赖，保持兼容）
  if (request.method === 'GET') {
    let codes = await kv.get('hercinia_auth_codes', { type: 'json' });
    let users = await kv.get('hercinia_account_auth', { type: 'json' });
    let deleted = await kv.get('hercinia_deleted_codes', { type: 'json' });
    let sources = await kv.get('hercinia_sources', { type: 'json' });
    let notice = await kv.get('hercinia_notice');

    if (!codes) codes = [];
    if (!users) users = [];
    if (!sources) {
      sources = [
        {
          url: 'https://node.hercinia-fast.kdns.fr/sub?token=2eff9965b7ac4338d22c115ce9c55894&clash',
          type: '专属极速源 (Hercinia-Fast)',
          status: '在线 (200 OK)'
        },
        {
          url: 'https://47.242.178.159/proxy?url=https://subscription.5188333.xyz/ovoovo?token=f3b7de2a34aeb4455c24fc62897769fe',
          type: '专属 H2 专项源 (OvO Nice)',
          status: '在线 (200 OK)'
        },
        {
          url: 'https://fghjhgew.xn--fiqs8s9rjgsr.com/search?token=0da09d928db26ae921e8e7ca953a8704',
          type: '专属 Reality 专项源 (Fghjhgew)',
          status: '在线 (200 OK)'
        },
        {
          url: 'https://fastly.jsdelivr.net/gh/ermaozi/get_subscribe@main/subscribe/clash.yml',
          type: '公共清洗池 (Ermaozi CDN)',
          status: '在线 (200 OK)'
        },
        {
          url: 'https://testingcf.jsdelivr.net/gh/anaer/Sub@main/clash.yaml',
          type: '公共清洗池 (Anaer Sub)',
          status: '在线 (200 OK)'
        },
        {
          url: 'https://fastly.jsdelivr.net/gh/ripaojiedian/freenode@main/clash',
          type: '公共清洗池 (Ripaojiedian)',
          status: '在线 (200 OK)'
        }
      ];
      await kv.put('hercinia_sources', JSON.stringify(sources));
    }

    if (!notice) {
      notice = '⚡ 高速节点已全量同步，欢迎使用！2小时自动化刷新一次！';
      await kv.put('hercinia_notice', notice);
    }

    const sourceUrls = Array.isArray(sources) 
      ? sources.map(s => (typeof s === 'string' ? s : s.url)).filter(Boolean)
      : [];

    return new Response(JSON.stringify({
      success: true,
      sources: sourceUrls,
      data: {
        codes: codes || [],
        users: users || [],
        deleted: deleted || [],
        sources: sources || [],
        notice: notice || ''
      }
    }), { headers: withSecurityHeaders() });
  }

  // POST: 站长新建/编辑/删除授权码、订阅聚合源、全站公告（严格执行 Bearer HMAC-Token 鉴权）
  if (request.method === 'POST') {
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const adminSecret = (env.ADMIN_SECRET || 'hercinia_super_secure_hmac_secret_2026_default').trim();

    const isValid = await verifyHmacToken(adminSecret, token);
    if (!isValid) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized: 拒绝访问，缺少合法管理员签名凭证' }), {
        status: 401,
        headers: withSecurityHeaders()
      });
    }

    try {
      const payload = await request.json();
      const { type, data } = payload;

      if (type === 'save_codes' && Array.isArray(data)) {
        await kv.put('hercinia_auth_codes', JSON.stringify(data));
      } else if (type === 'save_users' && Array.isArray(data)) {
        await kv.put('hercinia_account_auth', JSON.stringify(data));
      } else if (type === 'save_sources' && Array.isArray(data)) {
        await kv.put('hercinia_sources', JSON.stringify(data));
      } else if (type === 'save_notice' && typeof data === 'string') {
        await kv.put('hercinia_notice', data);
      } else if (type === 'save_all' && data) {
        if (data.codes) await kv.put('hercinia_auth_codes', JSON.stringify(data.codes));
        if (data.users) await kv.put('hercinia_account_auth', JSON.stringify(data.users));
        if (data.deleted) await kv.put('hercinia_deleted_codes', JSON.stringify(data.deleted));
        if (data.sources) await kv.put('hercinia_sources', JSON.stringify(data.sources));
        if (data.notice !== undefined) await kv.put('hercinia_notice', String(data.notice));
      }

      return new Response(JSON.stringify({ success: true, message: 'Cloud sync updated' }), {
        headers: withSecurityHeaders()
      });
    } catch (err) {
      return new Response(JSON.stringify({ success: false, error: err.message }), {
        status: 400,
        headers: withSecurityHeaders()
      });
    }
  }

  return new Response('Method Not Allowed', { status: 405, headers: withSecurityHeaders() });
}
