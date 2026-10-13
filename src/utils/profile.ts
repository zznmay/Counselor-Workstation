import dayjs from 'dayjs';

/**
 * 用户称呼信息（真实姓名 + 昵称），持久化在 localStorage。
 * 昵称用于每日问候与顶栏展示；未填写昵称时回退真实姓名。
 */

export interface UserProfile {
  /** 真实姓名 */
  realName: string;
  /** 希望被称呼的昵称（可选） */
  nickname?: string;
}

const PROFILE_KEY = 'counselor_user_profile';
const GREETING_DATE_KEY = 'counselor_greeting_date';

export function loadProfile(): UserProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UserProfile;
    return parsed && parsed.realName ? parsed : null;
  } catch {
    return null;
  }
}

export function saveProfile(profile: UserProfile): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

/** 今天（按本地日期）是否已经问候过 */
export function hasGreetedToday(): boolean {
  return localStorage.getItem(GREETING_DATE_KEY) === dayjs().format('YYYY-MM-DD');
}

export function markGreetedToday(): void {
  localStorage.setItem(GREETING_DATE_KEY, dayjs().format('YYYY-MM-DD'));
}

/** 展示名：昵称优先，未填写时回退真实姓名 */
export function displayName(profile: UserProfile | null | undefined): string {
  return (profile?.nickname ?? '').trim() || (profile?.realName ?? '').trim();
}

/** 元气满满的鼓励语池，每次问候随机轮换 */
export const ENCOURAGEMENTS: string[] = [
  '新的一天也要元气满满哦，好事正在发生！',
  '今天也是充满可能的一天，冲呀！',
  '每一份用心，都会在学生身上开花结果。',
  '别忘了多喝水，照顾好学生也要照顾好自己～',
  '愿今天有学生的成长，治愈你所有的忙碌。',
  '今天也要做学生眼里那束温暖的光！',
  '深呼吸，你比想象中更有力量。',
  '把平凡的事做好，就是不平凡的育人。',
  '工作会过去，你的用心会留下来。',
  '步子小一点也没关系，只要在向前走就好。',
];

const GREETING_EMOJIS = ['☀️', '🌟', '💪', '🌻', '🚀'];

export function pickEncouragement(): string {
  return ENCOURAGEMENTS[Math.floor(Math.random() * ENCOURAGEMENTS.length)];
}

export function pickGreetingEmoji(): string {
  return GREETING_EMOJIS[Math.floor(Math.random() * GREETING_EMOJIS.length)];
}
