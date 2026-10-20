/**
 * OrderLead sends through the EXISTING MLB Cloudflare Worker using a private
 * named Service Binding RPC. Gmail credentials remain exclusively on MLB.
 *
 * INTENTIONALLY NOT ROUTED: only a fully validated server-side Email signup
 * or reset workflow may call this after D1 rate limits/token storage succeed.
 * Never derive an outgoing email from arbitrary client-supplied instructions.
 */
import {normalizeEmailAddress} from './email-password-primitives'
import {decode32ByteToken} from './auth-primitives'

export interface MlbMailServiceBinding {
  sendAuthMail(payload:{
    id:string
    kind:'verify'|'reset'
    to:string
    link:string
  }):Promise<{accepted:boolean}>
}

export interface OrderLeadMailEnv {
  MLB_MAIL?:MlbMailServiceBinding
}

/**
 * The URL token appears only in the fragment, and must be removed from the
 * browser's URL on receipt BEFORE contacting the OrderLead auth endpoint.
 */
export async function requestAuthEmail(
  env:OrderLeadMailEnv,
  kind:'verify'|'reset',
  recipient:unknown,
  rawToken:unknown
):Promise<void>{
  if(kind!=='verify'&&kind!=='reset')throw Error('MAIL_INVALID')
  if(!decode32ByteToken(rawToken))throw Error('MAIL_INVALID')
  const email=normalizeEmailAddress(recipient)
  if(!env?.MLB_MAIL?.sendAuthMail)throw Error('MAIL_UNAVAILABLE')
  const route=kind==='verify'?'email-verify':'reset-password'
  const link='https://b110212000.github.io/stock-order-tracker/#/auth/'+route+'/'+rawToken
  // Send only the purpose, address and previously persisted single-use token.
  // The SMTP caller MUST NOT grant auth or mark D1 token consumed on this RPC.
  const result=await env.MLB_MAIL.sendAuthMail({
    id:crypto.randomUUID(),kind,to:email,link
  })
  if(result?.accepted!==true)throw Error('MAIL_FAILED')
}
