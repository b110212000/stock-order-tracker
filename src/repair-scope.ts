/** PWA cache matching must not delete other projects on the same GitHub Pages origin. */
export function sameScope(registered:string,expected:string):boolean {
  try {
    const a=new URL(registered),b=new URL(expected)
    return a.origin===b.origin&&a.pathname.replace(/\/+$/,'')===b.pathname.replace(/\/+$/,'')
  }catch{return false}
}

export function isOrderLeadCache(cacheName:string,scopeUrl:string):boolean {
  try{
    const scope=new URL(scopeUrl)
    const path=scope.pathname.replace(/\/+$/,'')+'/'
    // Workbox uses "workbox-precache-v2-<origin><scope>" by default.
    // Match the app-specific URL/path, not all caches on this shared origin.
    return cacheName.includes(scope.origin+path) ||
      (cacheName.startsWith('workbox-')&&cacheName.includes(path))
  }catch{return false}
}
