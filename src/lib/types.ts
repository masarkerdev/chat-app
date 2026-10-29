export type Profile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  last_seen: string | null;
};

export type Reaction = {
  user_id: string;
  emoji: string;
};

export type Message = {
  id: string;
  sender_id: string;
  content: string | null;
  image_path: string | null;
  created_at: string;
  seen_at: string | null;
  /** লেখা পরে বদলানো হলে কখন */
  edited_at?: string | null;
  /** কোন মেসেজের উত্তরে লেখা */
  reply_to?: string | null;
  /** প্রত্যেকের একটি করে রিঅ্যাকশন */
  reactions?: Reaction[];
  /** শুধু ক্লায়েন্টে: সার্ভারে পৌঁছানোর আগের অবস্থা */
  pending?: boolean;
  failed?: boolean;
  /** শুধু ক্লায়েন্টে: কেন পাঠানো যায়নি (বাংলায়) */
  errorText?: string;
  /** শুধু ক্লায়েন্টে: আপলোডের আগে ছবির লোকাল প্রিভিউ */
  localUrl?: string;
  /** শুধু ক্লায়েন্টে: ব্যর্থ হলে আবার পাঠানোর জন্য মূল ফাইল */
  localFile?: Blob;
};

/** রিঅ্যাকশনের দ্রুত তালিকা */
export const QUICK_REACTIONS = ['❤️', '😂', '😮', '😢', '🙏', '👍'];

/** পিন করা মেসেজ */
export type Pin = {
  message_id: string;
  pinned_by: string;
  pinned_at: string;
  /** পিন লোডের সময়ের মেসেজ (তালিকায় না থাকলেও দেখানোর জন্য) */
  message: Message | null;
};
