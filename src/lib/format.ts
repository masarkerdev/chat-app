const LOCALE = 'bn-BD';

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit' });
}

/** মেসেজ তালিকার তারিখ বিভাজক: আজ / গতকাল / ২৭ অক্টোবর ২০২৬ */
export function formatDayLabel(iso: string) {
  const d = new Date(iso);
  const diff = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86_400_000);
  if (diff === 0) return 'আজ';
  if (diff === 1) return 'গতকাল';
  if (diff > 1 && diff < 7) return d.toLocaleDateString(LOCALE, { weekday: 'long' });
  return d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' });
}

export function dayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** হেডারে: "সর্বশেষ দেখা আজ ৯:১৩ PM" */
export function formatLastSeen(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const minutes = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (minutes < 1) return 'এইমাত্র সক্রিয় ছিলেন';
  if (minutes < 60) return `${minutes.toLocaleString(LOCALE)} মিনিট আগে সক্রিয় ছিলেন`;
  const day = formatDayLabel(iso);
  return `সর্বশেষ দেখা ${day} ${formatTime(iso)}`;
}

/** টেক্সটের লিংকগুলো আলাদা করে (ক্লিকযোগ্য করার জন্য) */
export function splitLinks(text: string): { text: string; href?: string }[] {
  const re = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g;
  const parts: { text: string; href?: string }[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    parts.push({ text: m[0], href: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** শুধু ইমোজি (১-৩টি) হলে বড় করে দেখানোর জন্য */
export function isEmojiOnly(text: string) {
  const t = text.trim();
  if (!t || t.length > 16) return false;
  return /^(\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s)+$/u.test(t) && !/\d/.test(t);
}
