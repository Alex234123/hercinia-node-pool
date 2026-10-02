# ⚡ Hercinia 自动化节点池 (Hercinia Node Pool)

全网 17 处核心公共节点源并发采集 + GitHub Actions 云端 24/7 自动无头智能测速与延迟清洗 + GitHub Pages 自动化托管。

---

## 🔗 永久专属订阅地址

- **专属域名订阅链接**：
  ```text
  https://sub.jiajinfengherciniaxa.kdns.fr/clash.yaml
  ```
- **备用域名 / 默认 GitHub Pages 链接**：
  ```text
  https://alex234123.github.io/hercinia-node-pool/clash.yaml
  ```

---

## 🚀 架构与自动化特性

1. **多源并发抓取**：
   - 定时采集全网 17 处权威节点源（覆盖 ermaozi、anaer、ripaojiedian、mahdibland、peasoft 等源）。
2. **云端无头真机测速 (Headless Mihomo Core Benchmark)**：
   - 每次采集后，在 GitHub Actions 云端启动 Mihomo 独立核心服务。
   - 对全部去重后的候选节点进行并发真实延迟测试（URL: `https://cp.cloudflare.com/generate_204`）。
   - 剔除超时与不可用节点，严格按延迟由低到高升序排列。
3. **高可用规则配置**：
   - 自动生成具备 `⚡ 自动优选`、`🚀 故障转移`、`♻️ 负载均衡` 的完整 Clash / Mihomo 配置文件。
4. **全自动发布与自定义域名绑定**：
   - 构建结果自动推送到 `gh-pages` 分支。
   - 绑定已在 KataBump 配置的 CNAME 自定义域名 `sub.jiajinfengherciniaxa.kdns.fr`。
