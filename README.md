# Vikara Voice: Multimodal Scheduling Agent

[![Deployment Status](https://img.shields.io/badge/Deployment-Live-success?style=flat-square&color=00c853)](https://your-vercel-url.app)
[![Tech Stack](https://img.shields.io/badge/Stack-Gemini%20Multimodal%20%7C%20React%2019%20%7C%20Node%20TS-blue?style=flat-square)](https://github.com/your-repo)

> **Submission for Senior AI Engineer Role**
> A production demonstration of **Voice-to-Action** orchestration, solving the latency vs. reliability trade-off in voice agents.

## 🔗 Quick Links
- **Live Agent**: [Insert Vercel URL Here]
- **Demo Walkthrough**: [Insert Loom Video Link Here]

---

## 🏗 System Architecture

To achieve a "conversational" feel (<500ms latency) without sacrificing data integrity, I implemented a **Split-State Architecture**:

```mermaid
graph LR
    User[User] <-->|WebRTC / Audio| Client[React Client]
    Client <-->|WebSocket Stream| Model[Gemini 2.0 Flash]
    Client <-->|REST API| Backend[Node.js Server]
    Backend <-->|OAuth2| Google[Google Calendar]

    subgraph "Latency Optimized"
    Client
    Model
    end

    subgraph "Security & Logic"
    Backend
    Google
    end
