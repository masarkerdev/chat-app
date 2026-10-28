const PALETTE = ['#1f8a70', '#c4572f', '#3d6fb6', '#8a4fb0', '#b2862a', '#2f8aa0'];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function Avatar({
  name,
  id,
  online,
  size = 40,
}: {
  name: string;
  id: string;
  online?: boolean;
  size?: number;
}) {
  const letter = Array.from(name.trim())[0]?.toUpperCase() ?? '?';
  return (
    <span className="avatar" style={{ width: size, height: size, background: PALETTE[hash(id) % PALETTE.length] }}>
      <span style={{ fontSize: size * 0.44 }}>{letter}</span>
      {online && <span className="avatar-dot" aria-label="অনলাইন" />}
    </span>
  );
}
