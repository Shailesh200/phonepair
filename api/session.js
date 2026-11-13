let webpush = null
try { webpush = require('web-push') } catch { /* push stays off until the package is installed */ }

const sessions = globalThis.__ppSessions || (globalThis.__ppSessions = new Map())

function codeOf(value) {
  const code = String(value || '').toUpperCase()
  return /^[A-Z2-9]{6}$/.test(code) ? code : ''
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')) } catch { resolve({}) }
    })
  })
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Type', 'application/json')
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return }

  const publicKey = process.env.VAPID_PUBLIC_KEY || ''
  const privateKey = process.env.VAPID_PRIVATE_KEY || ''
  const pushOn = Boolean(webpush && publicKey && privateKey)
  if (pushOn) webpush.setVapidDetails('mailto:hello@phonepair.app', publicKey, privateKey)

  if (req.method === 'GET') {
    res.statusCode = 200
    res.end(JSON.stringify({ push: pushOn, publicKey }))
    return
  }

  const body = await readJson(req)
  const code = codeOf(body.code)
  if (!code) { res.statusCode = 400; res.end(JSON.stringify({ error: 'code' })); return }
  const row = sessions.get(code) || { devices: [], ended: false }

  if (body.op === 'end') {
    row.ended = true
    sessions.set(code, row)
    res.statusCode = 200
    res.end(JSON.stringify({ ok: true }))
    return
  }
  if (row.ended) { res.statusCode = 410; res.end(JSON.stringify({ ended: true })); return }

  if (body.op === 'join') {
    const id = String(body.id || '').slice(0, 40)
    if (!id) { res.statusCode = 400; res.end(JSON.stringify({ error: 'id' })); return }
    const devices = row.devices.filter((device) => device.id !== id)
    devices.push({
      id,
      name: String(body.name || 'Device').slice(0, 40),
      role: body.role === 'host' ? 'host' : 'guest',
      push: body.push && body.push.endpoint ? body.push : null,
    })
    row.devices = devices.slice(-8)
    row.ended = false
    sessions.set(code, row)
    res.statusCode = 200
    res.end(JSON.stringify({
      ok: true,
      devices: row.devices.map(({ id: deviceId, name, role }) => ({ id: deviceId, name, role })),
    }))
    return
  }

  if (body.op === 'notify') {
    const title = String(body.title || 'PhonePair').slice(0, 80)
    const text = String(body.body || '').slice(0, 140)
    const skip = String(body.from || '')
    const payload = JSON.stringify({ title, body: text, url: String(body.url || '/') })
    let sent = 0
    if (pushOn) {
      for (const device of row.devices) {
        if (!device.push || device.id === skip) continue
        try {
          await webpush.sendNotification(device.push, payload)
          sent += 1
        } catch { /* drop a dead subscription */ }
      }
    }
    res.statusCode = 200
    res.end(JSON.stringify({ ok: true, sent }))
    return
  }

  res.statusCode = 400
  res.end(JSON.stringify({ error: 'op' }))
}
