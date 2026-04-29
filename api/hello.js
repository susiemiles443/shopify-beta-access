export default function handler(req, res) {
  res.status(200).json({ ok: true, message: 'hello from vercel api' });
}