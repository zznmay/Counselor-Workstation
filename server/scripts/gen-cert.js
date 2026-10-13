/** 生成自签 HTTPS 证书（node-forge，无需 openssl） */
const fs = require('fs');
const path = require('path');
const forge = require('node-forge');

const { CERT_DIR, lanIps } = require('../lib/config');

function generate() {
  if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });
  const keyPath = path.join(CERT_DIR, 'key.pem');
  const certPath = path.join(CERT_DIR, 'cert.pem');
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    console.log('[cert] 证书已存在，跳过生成');
    return;
  }

  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  // 序列号需为偶数长度 hex（奇数长度会导致 forge ASN.1 编码错误）
  let serial = Date.now().toString(16);
  if (serial.length % 2 !== 0) serial = '0' + serial;
  cert.serialNumber = serial.slice(0, 20);
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000);

  // CN 使用 ASCII（forge 对多字节 CN 的编码存在兼容问题）
  const attrs = [{ name: 'commonName', value: 'Counselor Workbench Intranet Self-Signed' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);

  const san = [
    { type: 2, value: 'localhost' },
    ...lanIps().map((ip) => ({ type: 7, ip })),
    { type: 7, ip: '127.0.0.1' },
  ];
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames: san },
  ]);

  cert.sign(keys.privateKey, forge.md.sha256.create());
  fs.writeFileSync(keyPath, forge.pki.privateKeyToPem(keys.privateKey));
  fs.writeFileSync(certPath, forge.pki.certificateToPem(cert));
  console.log(`[cert] 自签证书已生成：${certPath}`);
}

if (require.main === module) generate();
module.exports = { generate };
