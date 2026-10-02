#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Hercinia Cloud Node Pool Scraper & Automated Latency Benchmark Pipeline
Runs headless in GitHub Actions 24/7 to collect, benchmark, filter and host fresh proxies.
"""

import os
import sys
import re
import json
import time
import base64
import asyncio
import urllib.parse
from datetime import datetime, timezone, timedelta
import aiohttp
import yaml

SOURCES = [
    # ermaozi/get_subscribe — multiple CDN mirrors
    "https://testingcf.jsdelivr.net/gh/ermaozi/get_subscribe@main/subscribe/clash.yml",
    "https://fastly.jsdelivr.net/gh/ermaozi/get_subscribe@main/subscribe/clash.yml",
    "https://gcore.jsdelivr.net/gh/ermaozi/get_subscribe@main/subscribe/clash.yml",
    "https://raw.githubusercontent.com/ermaozi/get_subscribe/main/subscribe/clash.yml",

    # anaer/Sub — multiple CDN mirrors
    "https://testingcf.jsdelivr.net/gh/anaer/Sub@main/clash.yaml",
    "https://fastly.jsdelivr.net/gh/anaer/Sub@main/clash.yaml",
    "https://gcore.jsdelivr.net/gh/anaer/Sub@main/clash.yaml",
    "https://raw.githubusercontent.com/anaer/Sub/main/clash.yaml",

    # ripaojiedian/freenode
    "https://fastly.jsdelivr.net/gh/ripaojiedian/freenode@main/clash",
    "https://gcore.jsdelivr.net/gh/ripaojiedian/freenode@main/clash",
    "https://raw.githubusercontent.com/ripaojiedian/freenode/main/clash",

    # mahdibland/V2RayAggregator
    "https://testingcf.jsdelivr.net/gh/mahdibland/V2RayAggregator@master/Eternity.yml",
    "https://fastly.jsdelivr.net/gh/mahdibland/V2RayAggregator@master/Eternity.yml",
    "https://raw.githubusercontent.com/mahdibland/V2RayAggregator/master/Eternity.yml",

    # peasoft/NoMoreWalls
    "https://testingcf.jsdelivr.net/gh/peasoft/NoMoreWalls@master/list.yml",
    "https://fastly.jsdelivr.net/gh/peasoft/NoMoreWalls@master/list.yml",

    # Pawdroid/Free-servers
    "https://testingcf.jsdelivr.net/gh/Pawdroid/Free-servers@main/sub",
    "https://fastly.jsdelivr.net/gh/Pawdroid/Free-servers@main/sub",

    # vxiaov/free_proxies
    "https://fastly.jsdelivr.net/gh/vxiaov/free_proxies@main/clash/clash.provider.yaml",
    "https://testingcf.jsdelivr.net/gh/vxiaov/free_proxies@main/clash/clash.provider.yaml"
]

CUSTOM_DOMAIN = "sub.jiajinfengherciniaxa.kdns.fr"
DIST_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist")


def decode_base64_safely(s: str) -> str:
    s = s.strip()
    try:
        clean = re.sub(r"\s+", "", s)
        missing_padding = len(clean) % 4
        if missing_padding:
            clean += "=" * (4 - missing_padding)
        decoded = base64.b64decode(clean, validate=False).decode("utf-8", errors="ignore")
        if "proxies:" in decoded or "server:" in decoded or "://" in decoded:
            return decoded
    except Exception:
        pass
    return s


async def fetch_source(session: aiohttp.ClientSession, url: str) -> str:
    headers = {
        "User-Agent": "ClashMeta/v1.19.2 (HerciniaCloud/2.0; +https://github.com/Alex234123/hercinia-node-pool)"
    }
    try:
        async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=15)) as resp:
            if resp.status == 200:
                text = await resp.text(errors="ignore")
                return text
    except Exception as e:
        print(f"[Fetch Error] {url}: {e}")
    return ""


async def fetch_all_sources() -> list:
    async with aiohttp.ClientSession() as session:
        tasks = [fetch_source(session, url) for url in SOURCES]
        results = await asyncio.gather(*tasks)
    return [r for r in results if r and len(r) > 100]


def extract_proxies_from_content(content: str) -> list:
    text = decode_base64_safely(content)
    text = re.sub(r"(short-id:\s*)([0-9a-fA-F]+)", r"\1'\2'", text)

    proxies = []
    # 1. Try pyyaml safe_load
    try:
        data = yaml.safe_load(text)
        if isinstance(data, dict) and "proxies" in data and isinstance(data["proxies"], list):
            for p in data["proxies"]:
                if isinstance(p, dict) and "name" in p and "server" in p and "port" in p and "type" in p:
                    proxies.append(p)
            if proxies:
                return proxies
    except Exception:
        pass

    # 2. Resilient Line-by-line block extractor fallback
    lines = text.splitlines()
    in_proxies = False
    cur_block = []

    def parse_block(b_lines):
        block_text = "\n".join(b_lines)
        try:
            parsed = yaml.safe_load(block_text)
            if isinstance(parsed, list) and len(parsed) > 0 and isinstance(parsed[0], dict):
                return parsed[0]
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
        item = {}
        for line in b_lines:
            m = re.match(r"^\s*-\s*([^:]+):\s*(.*)$", line)
            if not m:
                m = re.match(r"^\s*([^:]+):\s*(.*)$", line)
            if m:
                k = m.group(1).strip()
                v = m.group(2).strip().strip("'\"")
                if k == "port":
                    try: v = int(v)
                    except: pass
                item[k] = v
        if "server" in item and "port" in item and "type" in item:
            return item
        return None

    for line in lines:
        stripped = line.strip()
        if re.match(r"^proxies:\s*$", stripped):
            in_proxies = True
            continue
        if in_proxies and re.match(r"^(proxy-groups|rules|rule-providers|proxy-providers):\s*$", stripped):
            in_proxies = False
            if cur_block:
                p = parse_block(cur_block)
                if p: proxies.append(p)
                cur_block = []
            break
        if in_proxies:
            if re.match(r"^\s*-\s*", line):
                if cur_block:
                    p = parse_block(cur_block)
                    if p: proxies.append(p)
                    cur_block = []
                cur_block.append(line)
            elif cur_block:
                cur_block.append(line)

    if cur_block:
        p = parse_block(cur_block)
        if p: proxies.append(p)

    return proxies


def sanitize_node(node: dict) -> dict:
    clean = {}
    for k, v in node.items():
        if k == "port":
            try:
                clean["port"] = int(v)
            except Exception:
                return None
        elif isinstance(v, (str, int, float, bool, list, dict)):
            clean[k] = v
    if not clean.get("server") or not clean.get("type") or not clean.get("port"):
        return None
    return clean


def deduplicate_nodes(proxies: list) -> list:
    seen = set()
    unique = []
    for p in proxies:
        if not isinstance(p, dict):
            continue
        clean = sanitize_node(p)
        if not clean:
            continue
        server = str(clean.get("server", "")).strip()
        port = str(clean.get("port", "")).strip()
        ptype = str(clean.get("type", "")).strip().lower()
        if not server or not port or not ptype:
            continue
        if server in ("127.0.0.1", "localhost", "0.0.0.0") or server.startswith("192.168."):
            continue
        secret = str(clean.get("uuid") or clean.get("password") or clean.get("name") or "")
        key = f"{ptype}|{server.lower()}:{port}|{secret}"
        if key not in seen:
            seen.add(key)
            unique.append(clean)
    return unique


async def benchmark_node_tcp(node: dict, sem: asyncio.Semaphore, timeout: float = 2.0):
    async with sem:
        server = str(node.get("server", "")).strip()
        try:
            port = int(node.get("port"))
        except Exception:
            return None

        # Resolve domain and test TCP handshake delay
        t0 = time.perf_counter()
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(server, port),
                timeout=timeout
            )
            t1 = time.perf_counter()
            delay_ms = int((t1 - t0) * 1000)
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass
            if 0 < delay_ms <= 2000:
                return (node, delay_ms)
        except Exception:
            pass
        return None


async def benchmark_all_nodes(nodes: list) -> list:
    print(f"[Benchmark] Testing TCP handshake & alive latency across {len(nodes)} candidate nodes...")
    sem = asyncio.Semaphore(150)  # 150 concurrent sockets
    tasks = [benchmark_node_tcp(n, sem, timeout=2.0) for n in nodes]
    results = await asyncio.gather(*tasks)

    alive = [r for r in results if r is not None]
    alive.sort(key=lambda x: x[1])  # Sort by latency ascending
    print(f"[Benchmark] Completed! {len(alive)} out of {len(nodes)} nodes verified ALIVE & reachable!")
    return alive


def build_final_subscription(alive_nodes_with_delay: list):
    os.makedirs(DIST_DIR, exist_ok=True)

    final_proxies = []
    proxy_names = []
    name_counts = {}

    for original_node, delay in alive_nodes_with_delay:
        raw_name = str(original_node.get("name", "Node")).strip()
        clean_name = re.sub(r"^\[.*?\]\s*", "", raw_name).strip()
        if not clean_name:
            clean_name = f"{original_node.get('type', 'proxy').upper()}-{original_node.get('server')}"

        ptype = original_node.get("type", "").upper()
        formatted_name = f"[{ptype}|{delay}ms] {clean_name}"
        if formatted_name in name_counts:
            name_counts[formatted_name] += 1
            formatted_name = f"{formatted_name} #{name_counts[formatted_name]}"
        else:
            name_counts[formatted_name] = 1

        node_dict = dict(original_node)
        node_dict["name"] = formatted_name
        final_proxies.append(node_dict)
        proxy_names.append(formatted_name)

    cst_time = datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d %H:%M:%S")

    # Complete Clash / Mihomo Configuration
    clash_config = {
        "port": 7890,
        "socks-port": 7891,
        "allow-lan": True,
        "mode": "rule",
        "log-level": "info",
        "external-controller": "127.0.0.1:9097",
        "secret": "",
        "proxies": final_proxies,
        "proxy-groups": [
            {
                "name": "PROXY",
                "type": "select",
                "proxies": ["⚡ 自动优选", "🚀 故障转移", "♻️ 负载均衡"] + proxy_names
            },
            {
                "name": "⚡ 自动优选",
                "type": "url-test",
                "url": "https://cp.cloudflare.com/generate_204",
                "interval": 300,
                "tolerance": 50,
                "proxies": list(proxy_names)
            },
            {
                "name": "🚀 故障转移",
                "type": "fallback",
                "url": "https://cp.cloudflare.com/generate_204",
                "interval": 300,
                "proxies": list(proxy_names)
            },
            {
                "name": "♻️ 负载均衡",
                "type": "load-balance",
                "url": "https://cp.cloudflare.com/generate_204",
                "interval": 300,
                "strategy": "consistent-hashing",
                "proxies": list(proxy_names)
            }
        ],
        "rules": [
            "DOMAIN-SUFFIX,local,DIRECT",
            "IP-CIDR,127.0.0.0/8,DIRECT,no-resolve",
            "IP-CIDR,172.16.0.0/12,DIRECT,no-resolve",
            "IP-CIDR,192.168.0.0/16,DIRECT,no-resolve",
            "IP-CIDR,10.0.0.0/8,DIRECT,no-resolve",
            "GEOIP,LAN,DIRECT,no-resolve",
            "GEOIP,CN,DIRECT",
            "MATCH,PROXY"
        ]
    }

    clash_header = (
        f"# ===================================================================\n"
        f"# Hercinia Cloud Auto-Tested Node Subscription Pool\n"
        f"# Updated: {cst_time} (UTC+8)\n"
        f"# Verified Alive Nodes: {len(final_proxies)}\n"
        f"# Custom Domain: https://{CUSTOM_DOMAIN}/clash.yaml\n"
        f"# ===================================================================\n\n"
    )

    clash_yaml_content = clash_header + yaml.dump(clash_config, allow_unicode=True, sort_keys=False)

    # Write clash.yaml & sub.yaml
    with open(os.path.join(DIST_DIR, "clash.yaml"), "w", encoding="utf-8") as f:
        f.write(clash_yaml_content)
    with open(os.path.join(DIST_DIR, "sub.yaml"), "w", encoding="utf-8") as f:
        f.write(clash_yaml_content)

    # Write CNAME file for GitHub Pages custom domain
    with open(os.path.join(DIST_DIR, "CNAME"), "w", encoding="utf-8") as f:
        f.write(f"{CUSTOM_DOMAIN}\n")

    # Write stats.json
    avg_delay = int(sum(d for _, d in alive_nodes_with_delay) / len(alive_nodes_with_delay)) if alive_nodes_with_delay else 0
    stats = {
        "updated_at": cst_time,
        "total_alive_nodes": len(final_proxies),
        "average_delay_ms": avg_delay,
        "custom_domain": CUSTOM_DOMAIN,
        "subscription_url": f"https://{CUSTOM_DOMAIN}/clash.yaml"
    }
    with open(os.path.join(DIST_DIR, "stats.json"), "w", encoding="utf-8") as f:
        json.dump(stats, f, indent=2, ensure_ascii=False)

    # Generate a modern interactive web dashboard in index.html
    html_template = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hercinia 自动化高优节点池 | 24/7 智能云测速</title>
  <style>
    :root {{
      --primary: #4f46e5;
      --primary-hover: #4338ca;
      --bg: #0f172a;
      --card: #1e293b;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --border: #334155;
      --success: #10b981;
      --warning: #f59e0b;
      --accent: #38bdf8;
      --danger: #ef4444;
    }}
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      flex-direction: column;
      align-items: center;
      min-height: 100vh;
      padding: 40px 20px;
    }}
    .container {{
      max-width: 820px;
      width: 100%;
    }}
    .header {{
      text-align: center;
      margin-bottom: 28px;
    }}
    .header h1 {{
      font-size: 2.2rem;
      background: linear-gradient(135deg, #38bdf8 0%, #818cf8 50%, #c084fc 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 12px;
    }}
    .header p {{
      color: var(--text-muted);
      font-size: 1.05rem;
    }}
    .stats-grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 20px;
    }}
    .stat-card {{
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      text-align: center;
    }}
    .stat-val {{
      font-size: 2rem;
      font-weight: 700;
      color: var(--accent);
      margin-bottom: 6px;
    }}
    .stat-label {{
      color: var(--text-muted);
      font-size: 0.9rem;
    }}
    .main-card {{
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px 28px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
      margin-bottom: 20px;
    }}
    .action-header {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 16px;
    }}
    .status-pill {{
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 0.85rem;
      font-weight: 600;
      background: rgba(16, 185, 129, 0.12);
      color: var(--success);
      border: 1px solid rgba(16, 185, 129, 0.25);
    }}
    .status-pill.running {{
      background: rgba(245, 158, 11, 0.12);
      color: var(--warning);
      border-color: rgba(245, 158, 11, 0.3);
    }}
    .status-dot {{
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: currentColor;
    }}
    .status-pill.running .status-dot {{
      animation: pulse 1.5s infinite;
    }}
    @keyframes pulse {{
      0%, 100% {{ opacity: 1; transform: scale(1); }}
      50% {{ opacity: 0.4; transform: scale(1.2); }}
    }}
    .sub-box {{
      display: flex;
      gap: 10px;
      margin: 16px 0;
      background: #0f172a;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 6px 10px;
      align-items: center;
    }}
    .sub-input {{
      flex: 1;
      background: transparent;
      border: none;
      color: var(--accent);
      font-size: 0.95rem;
      font-family: monospace;
      outline: none;
    }}
    .btn {{
      background: var(--primary);
      color: #fff;
      border: none;
      padding: 10px 18px;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      transition: all 0.2s;
      font-size: 0.95rem;
    }}
    .btn:hover {{
      background: var(--primary-hover);
    }}
    .btn:disabled {{
      opacity: 0.6;
      cursor: not-allowed;
    }}
    .btn-update {{
      background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }}
    .btn-update:hover {{
      background: linear-gradient(135deg, #4338ca 0%, #6d28d9 100%);
    }}
    .btn-group {{
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 14px;
    }}
    .btn-secondary {{
      background: #334155;
      text-decoration: none;
    }}
    .btn-secondary:hover {{
      background: #475569;
    }}
    .btn-outline {{
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text-muted);
    }}
    .btn-outline:hover {{
      background: #1e293b;
      color: var(--text);
    }}
    .alert-box {{
      margin-top: 14px;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 0.9rem;
      display: none;
    }}
    .alert-success {{
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: #34d399;
    }}
    .alert-info {{
      background: rgba(56, 189, 248, 0.15);
      border: 1px solid rgba(56, 189, 248, 0.3);
      color: #7dd3fc;
    }}
    .alert-error {{
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #f87171;
    }}
    /* Modal Styles */
    .modal-backdrop {{
      position: fixed;
      top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(4px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 999;
      padding: 20px;
    }}
    .modal-content {{
      background: #1e293b;
      border: 1px solid var(--border);
      border-radius: 16px;
      max-width: 500px;
      width: 100%;
      padding: 24px;
      box-shadow: 0 20px 30px rgba(0, 0, 0, 0.4);
    }}
    .footer {{
      text-align: center;
      color: var(--text-muted);
      font-size: 0.85rem;
      margin-top: 24px;
    }}
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>⚡ Hercinia 自动化高优节点池</h1>
      <p>全网 17 处核心公共节点源 · GitHub Actions 24/7 云端智能测速筛选 · 专属稳定加速</p>
    </div>

    <!-- 实时状态面板 -->
    <div class="stats-grid">
      <div class="stat-card">
        <div id="statAliveCount" class="stat-val">{len(final_proxies)}</div>
        <div class="stat-label">当前存活低延迟节点</div>
      </div>
      <div class="stat-card">
        <div id="statAvgDelay" class="stat-val">{avg_delay} ms</div>
        <div class="stat-label">平均握手延迟</div>
      </div>
      <div class="stat-card">
        <div id="statUpdatedAt" class="stat-val" style="font-size: 1.15rem; line-height: 2.2rem; color: #a78bfa;">{cst_time}</div>
        <div class="stat-label">最近更新时间 (北京时间)</div>
      </div>
    </div>

    <!-- 手动更新与云端调度控制卡片 -->
    <div class="main-card">
      <div class="action-header">
        <div>
          <h3 style="margin-bottom: 4px;">⚡ 云端自动维护与即时刷新</h3>
          <p style="color: var(--text-muted); font-size: 0.88rem;">
            默认每 6 小时自动爬取并清洗测速。若需获取当前最新节点，可随时点击下方按钮立即触发：
          </p>
        </div>
        <div id="statusPill" class="status-pill">
          <span class="status-dot"></span>
          <span id="statusPillText">云端就绪</span>
        </div>
      </div>

      <div style="display: flex; flex-wrap: wrap; gap: 10px; align-items: center;">
        <button id="btnTrigger" class="btn btn-update" onclick="handleManualUpdate()">
          <span id="btnIcon">🔄</span>
          <span id="btnText">立即手动触发云端更新</span>
        </button>

        <a href="https://github.com/Alex234123/hercinia-node-pool/actions/workflows/update.yml" target="_blank" class="btn btn-secondary" style="font-size: 0.9rem;">
          ↗ GitHub Actions 后台
        </a>

        <button class="btn btn-outline" style="font-size: 0.85rem;" onclick="openTokenModal()">
          🔑 授权码设置
        </button>
      </div>

      <div id="alertMsg" class="alert-box"></div>
    </div>

    <!-- 订阅地址与导入卡片 -->
    <div class="main-card">
      <h3 style="margin-bottom: 8px;">🔗 永久专属订阅地址</h3>
      <p style="color: var(--text-muted); font-size: 0.9rem;">
        已绑定自定义域名 <code>{CUSTOM_DOMAIN}</code>，可直接粘贴进 Herciniamihomo、Clash Verge、Mihomo Party 等客户端：
      </p>

      <div class="sub-box">
        <input type="text" id="subUrl" class="sub-input" readonly value="https://{CUSTOM_DOMAIN}/clash.yaml">
        <button class="btn" onclick="copySub()">复制订阅链接</button>
      </div>

      <div class="btn-group">
        <a href="https://{CUSTOM_DOMAIN}/clash.yaml" class="btn btn-secondary">直接下载 YAML 配置</a>
        <a href="clash://install-config?url=https://{CUSTOM_DOMAIN}/clash.yaml" class="btn" style="text-decoration: none; background: #0284c7;">一键导入 Clash</a>
      </div>
    </div>

    <div class="footer">
      <p>Powered by Hercinia & GitHub Actions · 仅供技术交流与网络测试使用</p>
    </div>
  </div>

  <!-- Token 配置模态框 -->
  <div id="tokenModal" class="modal-backdrop">
    <div class="modal-content">
      <h3 style="margin-bottom: 10px;">🔐 设置 GitHub 授权码 (PAT)</h3>
      <p style="color: var(--text-muted); font-size: 0.85rem; line-height: 1.5; margin-bottom: 14px;">
        为了安全，授权码将<strong>仅保存在您当前浏览器的 LocalStorage 中</strong>，用于直接向 GitHub 发送工作流调度请求。<br>
        如果您已经在 GitHub 网页端登录，也可以直接点击主页面的“GitHub Actions 后台”手动运行工作流。
      </p>
      <div style="margin-bottom: 16px;">
        <label style="display: block; font-size: 0.85rem; color: var(--text-muted); margin-bottom: 6px;">GitHub Personal Access Token (需包含 repo 或 workflow 权限):</label>
        <input type="password" id="tokenInput" class="sub-input" style="width: 100%; border: 1px solid var(--border); border-radius: 8px; padding: 10px;" placeholder="ghp_xxxxxxxxxxxxxxxxxxxx">
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 10px;">
        <button class="btn btn-secondary" onclick="closeTokenModal()">取消</button>
        <button class="btn" onclick="saveTokenAndTrigger()">保存并立即更新</button>
      </div>
    </div>
  </div>

  <script>
    const OWNER = 'Alex234123';
    const REPO = 'hercinia-node-pool';
    const WORKFLOW_ID = 'update.yml';
    let pollInterval = null;

    function copySub() {{
      const inp = document.getElementById('subUrl');
      inp.select();
      navigator.clipboard.writeText(inp.value).then(() => {{
        alert('✓ 订阅地址已复制到剪贴板！可以直接粘贴到客户端中添加订阅。');
      }});
    }}

    function showAlert(msg, type = 'info') {{
      const box = document.getElementById('alertMsg');
      box.className = 'alert-box alert-' + type;
      box.innerHTML = msg;
      box.style.display = 'block';
    }}

    function hideAlert() {{
      document.getElementById('alertMsg').style.display = 'none';
    }}

    function openTokenModal() {{
      const saved = localStorage.getItem('gh_token') || '';
      document.getElementById('tokenInput').value = saved;
      document.getElementById('tokenModal').style.display = 'flex';
    }}

    function closeTokenModal() {{
      document.getElementById('tokenModal').style.display = 'none';
    }}

    function saveTokenAndTrigger() {{
      const token = document.getElementById('tokenInput').value.trim();
      if (!token) {{
        alert('请输入有效的 GitHub 访问令牌 (Token)');
        return;
      }}
      localStorage.setItem('gh_token', token);
      closeTokenModal();
      handleManualUpdate();
    }}

    async function handleManualUpdate() {{
      const token = localStorage.getItem('gh_token');
      if (!token) {{
        openTokenModal();
        return;
      }}

      const btn = document.getElementById('btnTrigger');
      const btnIcon = document.getElementById('btnIcon');
      const btnText = document.getElementById('btnText');
      btn.disabled = true;
      btnIcon.textContent = '⏳';
      btnText.textContent = '正在下发云端指令...';
      showAlert('正在连接 GitHub Actions 触发更新工作流...', 'info');

      try {{
        const res = await fetch(`https://api.github.com/repos/${{OWNER}}/${{REPO}}/actions/workflows/${{WORKFLOW_ID}}/dispatches`, {{
          method: 'POST',
          headers: {{
            'Authorization': `token ${{token}}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
          }},
          body: JSON.stringify({{ ref: 'main' }})
        }});

        if (res.status === 204 || res.status === 200) {{
          showAlert('✓ 成功下发更新任务！GitHub Actions 云端正在全网抓取并高并发测速...', 'info');
          btnText.textContent = '云端正在测速中...';
          startPollingStatus();
        }} else if (res.status === 401 || res.status === 403) {{
          showAlert('✗ 授权失败 (401/403)：当前保存的 GitHub Token 无效或已过期，请重新设置。', 'error');
          btn.disabled = false;
          btnIcon.textContent = '🔄';
          btnText.textContent = '立即手动触发云端更新';
          openTokenModal();
        }} else {{
          const err = await res.json().catch(() => ({{}}));
          showAlert(`✗ 触发失败 (${{res.status}})：${{err.message || '未知错误'}}`, 'error');
          btn.disabled = false;
          btnIcon.textContent = '🔄';
          btnText.textContent = '立即手动触发云端更新';
        }}
      }} catch (e) {{
        showAlert(`✗ 网络连接错误：${{e.message}}`, 'error');
        btn.disabled = false;
        btnIcon.textContent = '🔄';
        btnText.textContent = '立即手动触发云端更新';
      }}
    }}

    async function checkLiveStatus() {{
      try {{
        const res = await fetch(`https://api.github.com/repos/${{OWNER}}/${{REPO}}/actions/runs?per_page=1`, {{
          cache: 'no-store'
        }});
        if (!res.ok) return;
        const data = await res.json();
        const run = data.workflow_runs && data.workflow_runs[0];
        if (!run) return;

        const pill = document.getElementById('statusPill');
        const pillText = document.getElementById('statusPillText');
        const btn = document.getElementById('btnTrigger');
        const btnIcon = document.getElementById('btnIcon');
        const btnText = document.getElementById('btnText');

        if (run.status === 'in_progress' || run.status === 'queued') {{
          pill.className = 'status-pill running';
          pillText.textContent = `云端测速中 (#${{run.run_number}})`;
          btn.disabled = true;
          btnIcon.textContent = '⏳';
          btnText.textContent = `云端测速执行中 (#${{run.run_number}})...`;
        }} else {{
          pill.className = 'status-pill';
          pillText.textContent = '云端就绪';
          btn.disabled = false;
          btnIcon.textContent = '🔄';
          btnText.textContent = '立即手动触发云端更新';

          // 若刚完成，拉取最新统计
          if (pollInterval) {{
            clearInterval(pollInterval);
            pollInterval = null;
            showAlert('🎉 云端测速与发布已全部完成！最新节点已同步就绪。', 'success');
            refreshStats();
          }}
        }}
      }} catch (e) {{}}
    }}

    function startPollingStatus() {{
      if (pollInterval) clearInterval(pollInterval);
      pollInterval = setInterval(checkLiveStatus, 4000);
      checkLiveStatus();
    }}

    async function refreshStats() {{
      try {{
        const res = await fetch(`stats.json?_t=${{Date.now()}}`);
        if (res.ok) {{
          const data = await res.json();
          if (data.total_alive_nodes) {{
            document.getElementById('statAliveCount').textContent = data.total_alive_nodes;
            document.getElementById('statAvgDelay').textContent = data.average_delay_ms + ' ms';
            document.getElementById('statUpdatedAt').textContent = data.updated_at;
          }}
        }}
      }} catch (e) {{}}
    }}

    // 初始化检查状态
    checkLiveStatus();
  </script>
</body>
</html>"""

    with open(os.path.join(DIST_DIR, "index.html"), "w", encoding="utf-8") as f:
        f.write(html_template)

    print(f"[Done] Subscription files successfully written to {DIST_DIR}!")


async def main():
    print("=" * 60)
    print("Hercinia Node Pool Scraper & Benchmark Started")
    print(f"Timestamp: {datetime.now(timezone.utc).isoformat()}")
    print("=" * 60)

    # 1. Fetch from 17 sources
    print("[Step 1] Fetching candidate contents from 17 public sources...")
    contents = await fetch_all_sources()
    print(f"[Step 1] Successfully downloaded {len(contents)} source payloads.")

    # 2. Extract and deduplicate
    all_raw_nodes = []
    for c in contents:
        nodes = extract_proxies_from_content(c)
        all_raw_nodes.extend(nodes)
    print(f"[Step 2] Total raw nodes extracted: {len(all_raw_nodes)}")

    unique_nodes = deduplicate_nodes(all_raw_nodes)
    print(f"[Step 2] Unique candidate nodes after deduplication: {len(unique_nodes)}")

    if not unique_nodes:
        print("[Error] No candidate nodes found! Aborting.")
        sys.exit(1)

    # 3. High-concurrency TCP benchmark
    alive_nodes = await benchmark_all_nodes(unique_nodes)
    if not alive_nodes:
        print("[Warning] No node passed latency test, saving top unique candidate nodes.")
        alive_nodes = [(n, 999) for n in unique_nodes[:200]]

    # 4. Generate Output Files
    build_final_subscription(alive_nodes)
    print("[Success] All tasks completed successfully!")


if __name__ == "__main__":
    asyncio.run(main())
