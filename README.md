# DataPulse Sentinel - Real-Time DBA Monitoring Platform

<div align="center">

**Enterprise-grade Real-Time Database Performance Monitoring, Incident Alert Thresholds, Cross-Database Telemetry, and RBAC Management.**

![DataPulse Sentinel](https://img.shields.io/badge/DataPulse-Sentinel-6366f1?style=for-the-badge&logo=database&logoColor=white)
![React 19](https://img.shields.io/badge/React-19-61dafb?style=for-the-badge&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178c6?style=for-the-badge&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-6.2-646cff?style=for-the-badge&logo=vite&logoColor=white)
![TailwindCSS v4](https://img.shields.io/badge/Tailwind-v4-38bdf8?style=for-the-badge&logo=tailwindcss&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.21-000000?style=for-the-badge&logo=express&logoColor=white)
![Gemini AI](https://img.shields.io/badge/Gemini_AI-3.6_Flash-8e75ff?style=for-the-badge&logo=google&logoColor=white)

</div>

---

## 🌟 Key Features

- ⚡ **Real-Time Telemetry & Monitoring**: Live multi-engine metric streaming (CPU load, query latency, active connection pool capacity, disk IOPS, replication lag, and cache hit ratios).
- 🗄️ **Multi-Database Engine Support**:
  - **PostgreSQL**: Autovacuum status, dead tuple tracking, WAL log generation, idle in transaction sessions, and `pg_stat_activity` transactions.
  - **Microsoft SQL Server**: TempDB latch contention (`PAGELATCH_UP`), Page Life Expectancy (PLE), batch requests/sec, and XML deadlock graph inspector.
  - **MySQL**: InnoDB buffer pool hit ratios, connected thread pool usage, slow query logs, and table lock waits.
- 🚨 **Threshold Alerting & Incident Response**: Configurable metric thresholds (Warning & Critical), live firing incident war room, incident acknowledgment workflows, and one-click remediation execution.
- 📋 **Database Connection & Auth Logs Stream**: Live-tail audit stream of client connection handshakes, authentication successes/failures, query timeouts, and SSL certificate verification with real-time indexing filters.
- 👥 **Role-Based Access Control (RBAC)**: Fine-grained security matrix with Super Admin, Senior DBA, Junior DBA, and Auditor roles.
- 📧 **Automated Email Notifications**: Customizable HTML incident email templates with dynamic variable interpolation and simulated SMTP dispatch relay.
- 🤖 **Gemini AI DBA Diagnostic Engine**: Integrated AI assistant using Google Gen AI SDK for automated root-cause analysis, missing index recommendations, and query refactoring.
- 📄 **Exportable PDF Compliance Reports**: High-resolution, printable PDF health and SLA compliance reports powered by `jsPDF` and `html2canvas`.
- 🔍 **Global Search Palette (`Cmd+K` / `Ctrl+K`)**: Rapid real-time search indexing across database instances, active alerts, logs, and team members.
- 🌙 **Elegant Dark Theme**: Modern dark aesthetic tailored for 24/7 DBA Operations Centers and Network Operations Centers (NOC).

---

## 🚀 Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+ recommended)
- `npm` or `bun`

### Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/sakerkadri/datapulse-dba.git
   cd datapulse-dba
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Copy the example environment configuration:
   ```bash
   cp .env.example .env
   ```
   Add your Gemini API key in `.env` (optional, for live AI diagnostics):
   ```env
   GEMINI_API_KEY="your_api_key_here"
   ```

4. **Run the Development Server:**
   ```bash
   npm run dev
   ```
   The application will be available at `http://localhost:3000`.

5. **Build for Production:**
   ```bash
   npm run build
   npm start
   ```

---

## 🛠️ Technology Stack

- **Frontend**: React 19, TypeScript, TailwindCSS v4, Lucide React, Recharts, Motion
- **Backend / API**: Node.js, Express, TSX, esbuild, `@google/genai`
- **Export & Reporting**: `jspdf`, `html2canvas`
- **Build Tooling**: Vite 6, TailwindCSS Vite plugin

---

## 🔒 Security & Compliance

Designed to adhere to SOC2 Type II, HIPAA audit trails, and least-privilege DBA operations standards.

---

## 📄 License

Apache-2.0