# 🌐 Hercinia EdgeMesh - Distributed Telemetry & Latency Benchmark Engine

[![QoS Telemetry](https://github.com/Alex234123/hercinia-node-pool/actions/workflows/update.yml/badge.svg)](https://github.com/Alex234123/hercinia-node-pool/actions)
[![Maintenance: 24/7](https://img.shields.io/badge/Pipeline-Active%20(2h%20Interval)-brightgreen.svg)](https://github.com/Alex234123/hercinia-node-pool/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

An enterprise-grade, automated network performance telemetry engine that continuously monitors, aggregates, and benchmarks distributed multi-cloud edge gateways and Anycast endpoints across global geographic regions.

---

## 📌 Architecture Overview

```
 [Heterogeneous Upstream Gateways]
                 │
                 ▼
  ┌──────────────────────────────┐
  │   Multi-Cloud Manifest Ingestion  │ ──► Dynamic Schema Normalization
  └──────────────┬───────────────┘
                 │
                 ▼
  ┌──────────────────────────────┐
  │  Stage-1: TCP Socket Handshake│ ──► Instant dead endpoint filtering
  └──────────────┬───────────────┘
                 │
                 ▼
  ┌──────────────────────────────┐
  │ Stage-2: Synthetic HTTP Probe │ ──► Round-Trip-Time (RTT) SLA Validation
  └──────────────┬───────────────┘
                 │
                 ▼
  ┌──────────────────────────────┐
  │    Optimized Mesh Topology   │ ──► Automatic failover & load balancing
  └──────────────────────────────┘
```

---

## 🚀 Key Modules & Engineering Features

1. **Multi-Source Topology Aggregator**:
   - Resilient asynchronous ingestion of distributed edge gateway manifests with deduplication and schema sanitization.
   - Intelligent UDP/Datagram protocol passthrough preserving low-latency tunnel configurations.

2. **Dual-Stage Synthetic Benchmark Engine**:
   - **Stage 1 (Socket Level)**: High-concurrency asynchronous socket probing to detect offline or unreachable edge points.
   - **Stage 2 (Application Level)**: Real HTTP/204 Anycast synthetic probing measuring end-to-end packet latency and routing jitter.

3. **Autonomous Edge CDN Distribution**:
   - Periodically computes and updates global gateway topology metadata.
   - Fully automated CI/CD pipeline running headless on GitHub Actions runners with atomic deployments to edge hosting.

---

## 🛠️ Configuration & Endpoints

- **Edge Gateway Manifest**:
  `https://pool.hercinia.kdns.fr/clash.yaml`
- **Telemetry Health & Metrics**:
  `https://pool.hercinia.kdns.fr/stats.json`

---

## 📄 License
This project is open-sourced under the [MIT License](LICENSE).
