import { verifyPhoneProof, signHostProof } from './proof.ts'
import { authConnStillPending } from './authStale.ts'
import { REMEMBER_PROOF_TIMEOUT_MS, type RememberGatePhase } from './gate.ts'
import { bytesFromB64, bytesToB64, randomBytes } from './ids.ts'
import {
  mainConnBlocksRememberAccept,
  rememberAcceptAllowed,
  type RememberAcceptReject,
} from './hostAuthAccept.ts'

export type RememberConn = {
  open: boolean
  peer: string
  send: (m: unknown) => void
  close: () => void
}

export type RememberPhoneRecord = { key: Uint8Array; name: string }

export type AuthPending = {
  conn: RememberConn
  phase: RememberGatePhase
  nonce: Uint8Array | null
  phoneNonce: Uint8Array | null
  phone: RememberPhoneRecord | null
  phoneId: string | null
}

export type HostAuthFailReason = 'denied' | 'fail'

export type HostAuthCallbacks = {
  onPromote: (conn: RememberConn, remoteName: string, phoneId: string) => void
  onFail: (conn: RememberConn, reason: HostAuthFailReason) => void
  onDispatch: (conn: RememberConn, m: unknown) => void
  onTimeout: (conn: RememberConn) => void
}

export type HostAuthDeps = {
  verifyPhoneProof: typeof verifyPhoneProof
  signHostProof: typeof signHostProof
}

export type RememberAcceptOpts = {
  now?: number
  knownPhoneId?: string
  mainConnPhoneId?: string | null
  onReject?: (reason: RememberAcceptReject) => void
}

const defaultDeps: HostAuthDeps = { verifyPhoneProof, signHostProof }

/** Host listen-peer remember auth; kept out of Link.conn until proof passes. */
export class RememberHostAuth {
  authPending: AuthPending | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private promoted = false
  listenAuthBackoffUntil = 0
  authPendingStartedAt: number | null = null

  private deps: HostAuthDeps

  constructor(deps: HostAuthDeps = defaultDeps) {
    this.deps = deps
  }

  canAcceptConnection(
    conn: RememberConn | null,
    mainConn: RememberConn | null,
    opts?: RememberAcceptOpts,
  ): boolean {
    const now = opts?.now ?? Date.now()
    const verdict = rememberAcceptAllowed({
      now,
      backoffUntil: this.listenAuthBackoffUntil,
      hasPending: !!this.authPending,
      pendingStartedAt: this.authPendingStartedAt,
      mainConnOpen: !!mainConn?.open,
      knownPhoneId: opts?.knownPhoneId,
      mainConnPhoneId: opts?.mainConnPhoneId,
    })
    if (!verdict.accept) {
      if (verdict.reject) opts?.onReject?.(verdict.reject)
      return false
    }
    if (verdict.supersedePending) this.supersedePendingAuth()
    return true
  }

  private supersedePendingAuth() {
    const old = this.authPending?.conn
    if (old) {
      try { old.close() } catch {}
    }
    this.clear()
  }

  beginAuth(conn: RememberConn, mainConn: RememberConn | null, cb: HostAuthCallbacks, opts?: RememberAcceptOpts) {
    if (!this.canAcceptConnection(conn, mainConn, opts)) {
      try { conn.close() } catch {}
      return
    }
    this.promoted = false
    this.authPendingStartedAt = opts?.now ?? Date.now()
    this.authPending = { conn, phase: 'await-hello', nonce: null, phoneNonce: null, phone: null, phoneId: null }
    this.armTimeout(conn, cb)
  }

  private armTimeout(conn: RememberConn, cb: HostAuthCallbacks) {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      if (this.authPending?.conn === conn && !this.promoted) {
        this.clear()
        cb.onTimeout(conn)
      }
    }, REMEMBER_PROOF_TIMEOUT_MS)
  }

  clear() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.authPending = null
    this.authPendingStartedAt = null
    this.promoted = false
  }

  private sendDenied(conn: RememberConn) {
    try { conn.send({ t: 'remember:denied' }) } catch {}
  }

  private failDenied(conn: RememberConn, cb: HostAuthCallbacks) {
    this.listenAuthBackoffUntil = Date.now() + 1000
    this.sendDenied(conn)
    this.clear()
    cb.onFail(conn, 'denied')
  }

  private failAuth(conn: RememberConn, cb: HostAuthCallbacks) {
    this.listenAuthBackoffUntil = Date.now() + 1000
    this.clear()
    cb.onFail(conn, 'fail')
  }

  async handleData(
    conn: RememberConn,
    m: unknown,
    phones: Map<string, RememberPhoneRecord> | null,
    mainConn: RememberConn | null,
    cb: HostAuthCallbacks,
    opts?: RememberAcceptOpts,
  ) {
    if (conn === mainConn) {
      cb.onDispatch(conn, m)
      return
    }
    if (conn !== this.authPending?.conn) return
    if (!m || typeof m !== 'object') return
    const msg = m as { t?: string; phoneId?: string; phoneNonce?: string; proof?: string }
    if (msg.t === 'remember:hello') {
      const phoneId = String(msg.phoneId ?? '')
      const rec = phones?.get(phoneId)
      if (!rec || typeof msg.phoneNonce !== 'string' || !msg.phoneNonce) {
        this.failDenied(conn, cb)
        return
      }
      if (
        mainConnBlocksRememberAccept(!!mainConn?.open, phoneId, opts?.mainConnPhoneId)
      ) {
        opts?.onReject?.('mainConnOtherPhone')
        this.failDenied(conn, cb)
        return
      }
      let phoneNonce: Uint8Array
      try { phoneNonce = bytesFromB64(msg.phoneNonce) } catch { this.failDenied(conn, cb); return }
      if (phoneNonce.length !== 32) { this.failDenied(conn, cb); return }
      const nonce = randomBytes(32)
      this.authPending = { conn, phase: 'await-proof', nonce, phoneNonce, phone: rec, phoneId }
      try { conn.send({ t: 'remember:challenge', nonce: bytesToB64(nonce) }) } catch {}
      this.armTimeout(conn, cb)
      return
    }
    if (msg.t === 'remember:proof' && this.authPending.phase === 'await-proof') {
      const pending = this.authPending
      const nonce = pending.nonce
      const phone = pending.phone
      const phoneNonce = pending.phoneNonce
      if (!nonce || !phone || !phoneNonce) return
      let proof: Uint8Array
      try { proof = bytesFromB64(String(msg.proof ?? '')) } catch { this.failDenied(conn, cb); return }
      const ok = await this.deps.verifyPhoneProof(phone.key, phoneNonce, nonce, proof)
      if (!authConnStillPending(this.authPending, conn, this.promoted)) return
      if (!ok) {
        this.failDenied(conn, cb)
        return
      }
      const name = phone.name
      const hostProof = await this.deps.signHostProof(phone.key, nonce, phoneNonce)
      if (!authConnStillPending(this.authPending, conn, this.promoted)) return
      if (this.promoted) return
      if (!pending.phoneId) {
        this.clear()
        return
      }
      this.promoted = true
      if (this.timer) clearTimeout(this.timer)
      this.timer = null
      try {
        try { conn.send({ t: 'remember:ok', hostProof: bytesToB64(hostProof) }) } catch {}
        cb.onPromote(conn, name, pending.phoneId)
      } finally {
        this.clear()
      }
    }
  }
}
