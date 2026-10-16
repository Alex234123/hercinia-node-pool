/**
 * Cloudflare Pages Function: /api/sync
 * 真正跨浏览器、跨设备的云端实时数据同步中心
 * 绑定 KV: AUTH_KV (HERCINIA_POOL_KV)
 */

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // CORS 响应头
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json; charset=utf-8'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const kv = env.AUTH_KV;
  if (!kv) {
    return new Response(JSON.stringify({ error: 'AUTH_KV binding not found' }), {
      status: 500,
      headers: corsHeaders
    });
  }

  // GET: 获取全网最新的授权码列表与已激活用户列表、全站公告
  if (request.method === 'GET') {
    let codes = await kv.get('hercinia_auth_codes', { type: 'json' });
    let users = await kv.get('hercinia_account_auth', { type: 'json' });
    let deleted = await kv.get('hercinia_deleted_codes', { type: 'json' });
    let notice = await kv.get('hercinia_notice');

    if (!codes) {
      // 首次初始化默认值
      codes = [
        {
          id: 1,
          code: 'hercinia888',
          package_days: 365,
          package_type: 'official',
          create_time: '2026-10-16 00:00:00',
          code_expire_time: '2027-10-16 23:59:59',
          status: 1,
          bind_account: '2364645344@qq.com',
          activate_time: '2026-10-17 02:59:33'
        },
        {
          id: 6,
          code: 'HERCINIA-VIP-G7SP8',
          package_days: 1,
          package_type: 'official',
          create_time: '2026-10-17 03:07:01',
          code_expire_time: '2026-11-16 03:07:01',
          status: 1,
          bind_account: 'jiajinfeng8@gmail.com',
          activate_time: '2026-10-17 03:12:04'
        }
      ];
      await kv.put('hercinia_auth_codes', JSON.stringify(codes));
    }

    if (!users) {
      users = [
        {
          id: 1,
          account: '2364645344@qq.com',
          auth_expire_time: '2028-10-15 23:59:59',
          last_auth_code: 'hercinia888',
          used_trial: false
        },
        {
          id: 2,
          account: 'jiajinfeng8@gmail.com',
          auth_expire_time: '2026-10-18 03:12:04',
          last_auth_code: 'HERCINIA-VIP-G7SP8',
          used_trial: false
        }
      ];
      await kv.put('hercinia_account_auth', JSON.stringify(users));
    }

    return new Response(JSON.stringify({
      success: true,
      data: {
        codes: codes || [],
        users: users || [],
        deleted: deleted || [],
        notice: notice || ''
      }
    }), { headers: corsHeaders });
  }

  // POST: 站长新建/编辑/删除授权码，或发布全站公告，或前台用户激活时推送到云端
  if (request.method === 'POST') {
    try {
      const payload = await request.json();
      const { type, data } = payload;

      if (type === 'save_codes' && Array.isArray(data)) {
        await kv.put('hercinia_auth_codes', JSON.stringify(data));
      } else if (type === 'save_users' && Array.isArray(data)) {
        await kv.put('hercinia_account_auth', JSON.stringify(data));
      } else if (type === 'save_notice' && typeof data === 'string') {
        await kv.put('hercinia_notice', data);
      } else if (type === 'save_all') {
        if (data.codes) await kv.put('hercinia_auth_codes', JSON.stringify(data.codes));
        if (data.users) await kv.put('hercinia_account_auth', JSON.stringify(data.users));
        if (data.deleted) await kv.put('hercinia_deleted_codes', JSON.stringify(data.deleted));
        if (data.notice !== undefined) await kv.put('hercinia_notice', String(data.notice));
      }

      return new Response(JSON.stringify({ success: true, message: 'Cloud sync updated' }), {
        headers: corsHeaders
      });
    } catch (err) {
      return new Response(JSON.stringify({ success: false, error: err.message }), {
        status: 400,
        headers: corsHeaders
      });
    }
  }

  return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
}
