/**
 * অবতার — দুজনের দুই সুতোর রঙ: নিজে নীল, অপর জন লাল।
 */
export function Avatar({
  name,
  tone,
  online,
  size = 40,
}: {
  name: string;
  tone: 'me' | 'them';
  online?: boolean;
  size?: number;
}) {
  const letter = Array.from(name.trim())[0] ?? '?';
  return (
    <span className={`avatar avatar-${tone}`} style={{ width: size, height: size }}>
      <span style={{ fontSize: size * 0.46 }}>{letter}</span>
      {online && <span className="avatar-dot" aria-label="অনলাইন" />}
    </span>
  );
}
