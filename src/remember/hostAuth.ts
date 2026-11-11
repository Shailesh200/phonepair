import { verifyPhoneProof, signHostProof } from './proof.ts'
import { REMEMBER_PROOF_TIMEOUT_MS, type RememberGatePhase } from './gate.ts'
import { bytesFromB64, bytesToB64, randomBytes } from './ids.ts'

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
}

export type HostAuthCallbacks = {
  onPromote: (conn: RememberConn, remoteName: string) => void
  onFail: (conn: RememberConn) => void
  onDispatch: (conn: RememberConn, m: unknown) => void
  onTimeout: (conn: RememberConn) => void
}

/** Host listen-peer remember auth; kept out of Link.conn until proof passes. */
export class RememberHostAuth {
  authPending: AuthPending | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  canAcceptConnection(conn: RememberConn | null, mainConn: RememberConn | null): boolean {
    if (mainConn?.open) return false
    if (this.authPending) return false
    return true
  }

  beginAuth(conn: RememberConn, mainConn: RememberConn | null, cb: HostAuthCallbacks) {
    if (!this.canAcceptConnection(conn, mainConn)) {
      try { conn.close() } catch {}
      return
    }
    this.authPending = { conn, phase: 'await-hello', nonce: null, phoneNonce: null, phone: null }
    this.armTimeout(conn, cb)
  }

  private armTimeout(conn: RememberConn, cb: HostAuthCallbacks) {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      if (this.authPending?.conn === conn) cb.onFail(conn)
    }, REMEMBER_PROOF_TIMEOUT_MS)
  }

  clear() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.authPending = null
  }

  async handleData(
    conn: RememberConn,
    m: unknown,
    phones: Map<string, RememberPhoneRecord> | null,
    mainConn: RememberConn | null,
    cb: HostAuthCallbacks,
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
        cb.onFail(conn)
        return
      }
      let phoneNonce: Uint8Array
      try { phoneNonce = bytesFromB64(msg.phoneNonce) } catch { cb.onFail(conn); return }
      if (phoneNonce.length !== 32) { cb.onFail(conn); return }
      const nonce = randomBytes(32)
      this.authPending = { conn, phase: 'await-proof', nonce, phoneNonce, phone: rec }
      try { conn.send({ t: 'remember:challenge', nonce: bytesToB64(nonce) }) } catch {}
      this.armTimeout(conn, cb)
      return
    }
    if (msg.t === 'remember:proof' && this.authPending.phase === 'await-proof' && this.authPending.nonce && this.authPending.phone && this.authPending.phoneNonce) {
      const { nonce, phone, phoneNonce } = this.authPending
      const proof = bytesFromB64(String(msg.proof ?? ''))
      const ok = await verifyPhoneProof(phone.key, nonce, proof)
      if (!ok) {
        cb.onFail(conn)
        return
      }
      const name = phone.name
      const hostProof = await signHostProof(phone.key, phoneNonce)
      this.clear()
      try { conn.send({ t: 'remember:ok', hostProof: bytesToB64(hostProof) }) } catch {}
      cb.onPromote(conn, name)
    }
  }
}
