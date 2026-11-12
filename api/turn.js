const crypto = require('crypto');
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  const host = '167.233.223.123';
  const stun = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: `stun:${host}:3478` }];
  const secret = process.env.TURN_SECRET;
  if (!secret) { res.statusCode = 200; res.end(JSON.stringify({ iceServers: stun, ttl: 0 })); return; }
  const ttl = 6 * 3600;
  const username = `${Math.floor(Date.now() / 1000) + ttl}:phonepair`;
  const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
  res.statusCode = 200;
  const turnUrls = [
    `turn:${host}:3478?transport=udp`,
    `turn:${host}:3478?transport=tcp`,
    'turns:turn.167.233.223.123.sslip.io:443?transport=tcp',
  ];
  res.end(JSON.stringify({ ttl, iceServers: [...stun, { urls: turnUrls, username, credential }] }));
};
