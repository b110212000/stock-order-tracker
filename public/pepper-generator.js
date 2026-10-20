/* OrderLead #95: The browser creates the private secret locally.
 * There is no fetch, storage, cookie, analytics or server request.
 * No secret is ever encoded into a URL or printed to a console.
 */
(() => {
  'use strict'
  const field = document.getElementById('secret')
  const generate = document.getElementById('generate')
  const copy = document.getElementById('copy')
  const status = document.getElementById('status')

  generate.addEventListener('click', () => {
    try {
      if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== 'function') {
        throw Error('此瀏覽器不支援安全亂數產生，請改用 Safari 或 Chrome')
      }
      const bytes = new Uint8Array(32)
      globalThis.crypto.getRandomValues(bytes)
      const plain = Array.from(bytes, n => String.fromCharCode(n)).join('')
      const value = btoa(plain).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
      // 32 bytes must produce exactly 43 characters of canonical base64url.
      if (value.length !== 43 || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
        throw Error('產生金鑰失敗，請重試')
      }
      field.value = value
      copy.disabled = false
      status.textContent = '已在這支手機產生金鑰。請按「複製」。'
      bytes.fill(0)
    } catch (error) {
      field.value = ''
      copy.disabled = true
      status.textContent = error instanceof Error ? error.message : '請改用 Safari 或 Chrome'
    }
  })

  copy.addEventListener('click', async () => {
    if (field.value.length !== 43) return
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(field.value)
      } else {
        field.focus()
        field.select()
        if (!document.execCommand('copy')) throw Error('複製失敗')
        field.setSelectionRange(field.value.length, field.value.length)
      }
      status.textContent = '已複製，請直接貼到 Cloudflare 的 Secret Value。'
    } catch {
      field.focus()
      field.select()
      status.textContent = '瀏覽器不允許自動複製，請長按上方金鑰選「複製」。'
    }
  })
})()
