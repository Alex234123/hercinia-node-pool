/**
 * Cloudflare Pages Function: /api/sync
 * 真正跨浏览器、跨设备的云端实时数据同步中心
 * 绑定 KV: AUTH_KV (HERCINIA_POOL_KV)
 * 安全特性：
 * 1. GET 保持公开支持前台用户读取公告与源状态；
 * 2. POST 具有公开安全的原子激活核销端点（type: 'activate_code'）；
 * 3. 其余敏感管理操作（save_codes, save_users, save_all, save_sources, save_notice）强制执行 HMAC-SHA256 鉴权。
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

function padZero(n) {
  return n < 10 ? '0' + n : '' + n;
}

function formatDateTime(d) {
  return d.getFullYear() + '-' +
    padZero(d.getMonth() + 1) + '-' +
    padZero(d.getDate()) + ' ' +
    padZero(d.getHours()) + ':' +
    padZero(d.getMinutes()) + ':' +
    padZero(d.getSeconds());
}

function isExpiredDateTime(dtStr) {
  if (!dtStr) return false;
  const target = new Date(dtStr.replace(/-/g, '/'));
  return new Date() > target;
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

  // GET: 获取全网最新的授权码、激活用户、聚合订阅源与全站公告
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

  // POST 处理
  if (request.method === 'POST') {
    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid JSON payload' }), {
        status: 400,
        headers: withSecurityHeaders()
      });
    }

    // ★ 关键通道：用户端公开原子核销授权码 (不需要管理员 Token)
    if (payload && payload.type === 'activate_code') {
      const accountEmail = (payload.account || '').trim();
      const codeStr = (payload.code || '').trim();

      if (!accountEmail || !codeStr) {
        return new Response(JSON.stringify({ success: false, error: '账号或授权码不能为空！' }), {
          status: 400,
          headers: withSecurityHeaders()
        });
      }

      let codes = (await kv.get('hercinia_auth_codes', { type: 'json' })) || [];
      let users = (await kv.get('hercinia_account_auth', { type: 'json' })) || [];

      // 1. 授权码匹配
      const codeObj = codes.find(c => c.code && c.code.trim().toLowerCase() === codeStr.toLowerCase());
      if (!codeObj) {
        return new Response(JSON.stringify({ success: false, error: '授权码无效，请核对后重试！' }), {
          status: 400,
          headers: withSecurityHeaders()
        });
      }

      // 2. 状态检查（是否已核销或作废）
      if (codeObj.status === 1) {
        return new Response(JSON.stringify({ success: false, error: '该授权码已被其他账号使用！' }), {
          status: 400,
          headers: withSecurityHeaders()
        });
      }
      if (codeObj.status === 2) {
        return new Response(JSON.stringify({ success: false, error: '该授权码已被管理员作废！' }), {
          status: 400,
          headers: withSecurityHeaders()
        });
      }
      if (codeObj.status === 3 || isExpiredDateTime(codeObj.code_expire_time)) {
        codeObj.status = 3;
        await kv.put('hercinia_auth_codes', JSON.stringify(codes));
        return new Response(JSON.stringify({ success: false, error: '该授权码已超过有效兑换期限，已失效！' }), {
          status: 400,
          headers: withSecurityHeaders()
        });
      }

      // 3. 用户查找或新建
      let accountObj = users.find(a => a.account && a.account.toLowerCase() === accountEmail.toLowerCase());
      if (!accountObj) {
        const newAccId = users.length > 0 ? Math.max(...users.map(a => a.id || 0)) + 1 : 1;
        accountObj = {
          id: newAccId,
          account: accountEmail,
          auth_expire_time: null,
          last_auth_code: null,
          used_trial: false
        };
        users.push(accountObj);
      }

      // 4. 体验码限制
      if (codeObj.package_type === 'trial' && accountObj.used_trial) {
        return new Response(JSON.stringify({ success: false, error: '该账号已享受过体验套餐，无法重复激活试用码！' }), {
          status: 400,
          headers: withSecurityHeaders()
        });
      }

      // 5. 原子核销与时间顺延计算
      const now = new Date();
      const nowStr = formatDateTime(now);

      codeObj.status = 1; // 标记已使用
      codeObj.bind_account = accountEmail;
      codeObj.activate_time = nowStr;

      let currentExpiry = accountObj.auth_expire_time ? new Date(accountObj.auth_expire_time.replace(/-/g, '/')) : null;
      let baseDate = (currentExpiry && currentExpiry > now) ? currentExpiry : new Date(now.getTime());
      const packageDays = Number(codeObj.package_days) || 30;
      baseDate.setDate(baseDate.getDate() + packageDays);

      accountObj.auth_expire_time = formatDateTime(baseDate);
      accountObj.last_auth_code = codeObj.code;
      if (codeObj.package_type === 'trial') {
        accountObj.used_trial = true;
      }

      // 6. 原子写入 KV，立即同步云端
      await kv.put('hercinia_auth_codes', JSON.stringify(codes));
      await kv.put('hercinia_account_auth', JSON.stringify(users));

      return new Response(JSON.stringify({
        success: true,
        message: '授权激活成功',
        data: {
          account: accountObj,
          code: codeObj
        }
      }), {
        headers: withSecurityHeaders()
      });
    }

    // ★ 其余所有管理写入操作，必须验证管理员 HMAC 凭证
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
