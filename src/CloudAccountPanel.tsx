import {LockKeyhole,Mail,ShieldAlert} from 'lucide-react'
import './CloudAccountPanel.css'

/**
 * Issue #73: supersede the legacy local UUID/recovery-key onboarding.
 *
 * There is deliberately NO register/login/password form until the verified
 * Email transport, backend credential sessions, and real D1 security tests
 * are ready. Do not tempt users to enter passwords into an inert form.
 *
 * Previously-created device keys are left in separate IndexedDB untouched
 * and may be migrated only after authenticated owner confirmation.
 */
export default function CloudAccountPanel(){
  return <section className="cloud-account-panel" aria-label="Email 雲端帳號狀態">
    <p className="cloud-account-caution">
      <ShieldAlert size={17} aria-hidden="true"/>
      <span><strong>雲端登入尚未開放</strong>，交易資料仍只存放在這台裝置。</span>
    </p>
    <div className="cloud-account-intro">
      <div className="cloud-account-heading"><Mail size={17} aria-hidden="true"/><strong>即將改為 Email＋密碼登入</strong></div>
      <p>未來使用自己的 Email 與密碼註冊，完成信箱驗證後即可登入，不需要手動記住 UUID 或長串金鑰。</p>
      <div className="cloud-account-secret">
        <strong>預計開放的功能</strong>
        <p>以 Email 建立帳號、設定密碼、跨裝置登入，以及透過 Email 安全重設忘記的密碼。</p>
        <p>為保障財務資料安全，會等到寄信服務與 Cloudflare 身分驗證完成測試後才開放。</p>
      </div>
      <div className="cloud-account-heading"><LockKeyhole size={17} aria-hidden="true"/><strong>原有資料會保留</strong></div>
      <p>如果先前已產生本機設備金鑰，系統不會刪除或覆蓋它；你現在不需要重新產生金鑰，也不用重新輸入恢復金鑰。</p>
    </div>
    <p className="cloud-account-footer">在雲端備份正式啟用之前，請透過「資料備份與轉移」另外儲存完整本機備份。</p>
  </section>
}
