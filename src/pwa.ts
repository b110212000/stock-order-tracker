import { registerSW } from 'virtual:pwa-register'
export const updateSW = registerSW({
  onNeedRefresh: () => window.dispatchEvent(new Event('orderlead-update-ready'))
})
