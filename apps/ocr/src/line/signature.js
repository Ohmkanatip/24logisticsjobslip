// ตรวจลายเซ็น LINE webhook — HMAC-SHA256(channel secret, body) แล้วเทียบกับ header x-line-signature (base64)
// ใช้ crypto.subtle เพื่อให้รันได้ทั้ง Cloudflare Worker และ Node 20+ โดยไม่พึ่ง dependency
const enc = new TextEncoder();

// แปลง ArrayBuffer → base64 (btoa มีทั้งใน Worker และ Node 20+)
function bufToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// คำนวณ HMAC-SHA256 เป็น base64 (แยกออกมาให้เทสใช้สร้างลายเซ็นที่ถูกได้)
export async function hmacBase64(secret, text) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(text));
  return bufToBase64(sig);
}

// คืน true เมื่อลายเซ็นถูกต้อง — เทียบแบบเวลาคงที่ (กัน timing attack แบบง่าย)
export async function verifySignature(channelSecret, bodyText, signatureBase64) {
  if (!channelSecret || typeof bodyText !== 'string' || typeof signatureBase64 !== 'string' || !signatureBase64) {
    return false;
  }
  const expected = await hmacBase64(channelSecret, bodyText);
  if (expected.length !== signatureBase64.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signatureBase64.charCodeAt(i);
  }
  return diff === 0;
}
