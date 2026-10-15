import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

type Props={children:ReactNode}
type State={error:string|null}

/** Keep the app recoverable when an older PWA cache or malformed local data
 * causes a runtime exception while rendering the transaction table. */
export default class ErrorBoundary extends Component<Props,State>{
  state:State={error:null}

  static getDerivedStateFromError(error:Error):State{
    return {error:error instanceof Error?error.message:'畫面載入時發生未知錯誤'}
  }
  componentDidCatch(error:Error,info:ErrorInfo){
    console.error('OrderLead transaction view error',error,info.componentStack)
  }
  render(){
    if(this.state.error!==null){
      return <main className="review-error" role="alert">
        <h1>交易頁暫時無法顯示</h1>
        <p>可能是舊版快取與新版不一致，或本機交易資料格式有問題。你的交易資料沒有被清除。</p>
        <p className="review-error-detail">錯誤資訊：{this.state.error}</p>
        <button className="primary" onClick={()=>window.location.reload()}>重新載入畫面</button>
        <p>若重新載入仍失敗，可先用 Safari 開啟原本的網址確認更新。請勿直接移除已安裝 App 或清除網站資料。</p>
      </main>
    }
    return this.props.children
  }
}
