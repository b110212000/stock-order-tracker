# Issue #107 — Cloudflare PBKDF2 上限與帳號密碼相容性

**真實根因（2026-10-20）**：正式 Workers runtime `crypto.subtle.deriveBits(PBKDF2, iterations=600000)` 會被限制在單次最多 100,000 次；Node 與部分本機測試不執行此限制。註冊因此在 `PASSWORD_HASH` 回 HTTP 503。之前 `unknown email` 的假的 401 測試吞掉 KDF 錯誤，無法證明運算成功，已修正。

參考：https://github.com/cloudflare/workerd/issues/1346

## 修正方法

- 不變：Cloudflare Secret `PASSWORD_PEPPER`，每個密碼一組 128-bit 隨機 salt，SHA-256 HMAC 預處理，加上 Cloudflare Workers / D1 多層限速；使用者密碼與私密金鑰從未儲存到 D1。
- 新的 `password_iterations=700000` **代表 Composite v2**：在相同一次驗證內序列執行 **七次、每次 100,000 rounds PBKDF2-SHA256**，前一階段輸出的 256-bit key 是下一階段的輸入；每個階段使用與原始 salt 組成的不同 salt（前綴 16 bytes 原始 salt、後接版本 2 及階段序號）。
- **重要密碼學說明：**此算法不是標準 `PBKDF2(password, salt, 700000)`，不可直接與一般 PBKDF2 library 互通，也不能聲稱其安全性已受第三方稽核。它是實際 700k rounds、每個 WebCrypto 呼叫不超過 100k 的串接 KDF。
- 之前使用 `password_iterations=600000` 的舊版 verifier 明確走原本的標準 PBKDF2 600k 驗證，**不得改用 composite 演算法悄悄覆蓋舊密碼**。這些資料若存在且只能在 Workers 做 600k 計算，仍需要未來的遷移路徑；不自動刪除或改動。
- 現有 D1 0005 CHECK `password_iterations >=600000 AND <=2000000`，因此新資料仍相容；不重跑資料庫 migration，也不更改既有交易資料。
- 新登入用錯誤密碼或不存在帳號時，KDF 運算錯誤都會回安全的 503，而**不再把加密失敗偽裝成 HTTP 401**。

## 尚須正式驗收

Cloudflare Workers Free 的 10ms CPU 上限與單次 PBKDF2 的 100k 迭代限制是**兩個不同問題**，不代表七次 100k 必定可以完成。請在 GitHub main Worker 發布後，以只測試不存在 `.invalid` 帳號（**不發 Email、不建帳號**）的 `backend/scripts/probe_live_email_503.py` 驗證真正的完整 KDF；它只將 401 AUTH_FAILED 當通過，503 則不通過。若 700k 分段仍超過 CPU，停止正式註冊，不得默默降低安全參數，必須轉為具版號的較低成本 KDF／獨立 Argon2id 工具或其他已審查的架構。

最後仍需要使用者自己註冊並確認 MLB 私有 Worker 驗證信，然後成功建立 D1 備份與新設備還原。GitHub CI 綠燈本身不能證明真實寄信。
