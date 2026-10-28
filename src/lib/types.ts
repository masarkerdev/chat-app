export type Profile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  last_seen: string | null;
};

export type Message = {
  id: string;
  sender_id: string;
  content: string | null;
  image_path: string | null;
  created_at: string;
  seen_at: string | null;
  /** শুধু ক্লায়েন্টে: সার্ভারে পৌঁছানোর আগের অবস্থা */
  pending?: boolean;
  failed?: boolean;
  /** শুধু ক্লায়েন্টে: আপলোডের আগে ছবির লোকাল প্রিভিউ */
  localUrl?: string;
  /** শুধু ক্লায়েন্টে: ব্যর্থ হলে আবার পাঠানোর জন্য মূল ফাইল */
  localFile?: Blob;
};
