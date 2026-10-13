# OrderLead · 台股訂單領先投資管理 PWA

**v1.0.0 — 純前端版本**。使用 React + Vite + TypeScript，支援 iPhone 安裝、響應式四分頁、淺色/深色模式，以及 GitHub Actions 自動建置部署。

## 功能現況

- 已完成：總覽、股票追蹤（預載 8 檔並可搜尋）、交易/績效空狀態、設定、主題、PWA、iPhone 安全區與版本規劃。
- 尚未提供：交易儲存、成本/績效計算、即時行情、AI 分析、背景推播；這些會依 GitHub Issues 一版一版開發。
- **所有股票評級均未標示為最新分析；頁面不提供即時買賣訊號。**

## 本機運作

Node.js 22：

```bash
npm install
npm run typecheck
npm run dev
npm run build
```

## 部署

每次推送到 `main`，Actions 執行 CI 和 GitHub Pages 部署。先在 **Settings → Pages → Build and deployment → Source** 選擇 **GitHub Actions**。部署成功後預設網址是 https://b110212000.github.io/stock-order-tracker/ 。

## 管理版本

- [版本 Roadmap](docs/ROADMAP.md)
- [GitHub Issues](https://github.com/b110212000/stock-order-tracker/issues)
- 一次只做一版。版本完成並測試後再關閉 Issue。
- 新功能增加次版號（v1.0.0 → v1.1.0）；純 Bug/畫面修正增加修訂號；主版本需要額外確認。

## 隱私

GitHub Pages 是公開的靜態網站。切勿提交個人交易紀錄、帳戶資料或 API Key。
未來 v1.3.0 使用 IndexedDB 本機保存交易；v1.5.0 增加備份還原。清除網站資料可能造成資料遺失。
