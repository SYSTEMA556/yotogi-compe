export const SITE_NAME = "東方夜伽話コンペ";
export const MAX_POINTS = 10;

export type Phase = "upcoming" | "submission" | "voting" | "closed";

export interface Contest {
  id: string;
  title: string;
  theme: string;
  description: string;
  submitStart: string;
  submitEnd: string;
  voteEnd: string;
  phase: Phase;
  entryCount: number;
  serverTime: string;
}

export interface Score {
  total: number;
  count: number;
  avg: number;
  rank: number;
}

export interface Entry {
  id: string;
  contestId: string;
  no: number;
  title: string;
  summary: string;
  body?: string;
  afterword?: string;
  penName: string;
  anonymous: boolean;
  tags: string[];
  allowComments: boolean;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
  score?: Score;
}

export interface Comment {
  id: string;
  name: string;
  body: string;
  createdAt: string;
}

export interface PublicVote {
  name: string;
  points: number;
  comment: string;
  createdAt: string;
}

export interface ReviewVote extends PublicVote {
  id: string;
  entryId: string;
  entryNo: number;
  entryTitle: string;
  ip: string;
  voter: string;
  flags: string[];
}

export interface ReviewEntry {
  id: string;
  no: number;
  title: string;
  penName: string;
  total: number;
  count: number;
  flagged: number;
}

export const MIN_VOTE_COMMENT = 5;

export interface EntryInput {
  title: string;
  summary: string;
  body: string;
  afterword: string;
  penName: string;
  password: string;
  newPassword?: string;
  tags: string[];
  allowComments: boolean;
}

// ---- ブラウザ保存（使えない環境でも落ちないように） ----
export function store(key: string, value?: string): string {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key) ?? "";
  } catch {
    return value ?? "";
  }
}

let memVoterKey = "";
function voterKey(): string {
  let k = store("voterKey");
  if (!k) {
    k = memVoterKey || crypto.randomUUID();
    memVoterKey = k;
    store("voterKey", k);
  }
  return k;
}

export function adminToken(v?: string): string {
  try {
    if (v !== undefined) sessionStorage.setItem("adminToken", v);
    return sessionStorage.getItem("adminToken") ?? "";
  } catch {
    return v ?? "";
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "X-Voter-Key": voterKey() };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const t = adminToken();
  if (t) headers["Authorization"] = "Bearer " + t;
  const res = await fetch("/api" + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `エラー (${res.status})`);
  return data as T;
}

export const api = {
  contests: () => req<Contest[]>("GET", "/contests"),
  contest: (id: string) => req<{ contest: Contest; entries: Entry[] }>("GET", `/contests/${id}`),
  createEntry: (cid: string, e: EntryInput) => req<{ id: string; no: number }>("POST", `/contests/${cid}/entries`, e),
  entry: (id: string) =>
    req<{ entry: Entry; contest: Contest; comments: Comment[]; myVote: PublicVote | null; votes: PublicVote[] }>(
      "GET",
      `/entries/${id}`,
    ),
  authEntry: (id: string, password: string) =>
    req<Omit<EntryInput, "password">>("POST", `/entries/${id}/auth`, { password }),
  updateEntry: (id: string, e: EntryInput) => req("PUT", `/entries/${id}`, e),
  deleteEntry: (id: string, password: string) => req("DELETE", `/entries/${id}`, { password }),
  vote: (id: string, v: { points: number; comment?: string; name?: string }) =>
    req<{ myVote: PublicVote | null }>("POST", `/entries/${id}/vote`, v),
  comment: (id: string, c: { name: string; body: string; password: string }) =>
    req("POST", `/entries/${id}/comments`, c),
  deleteComment: (id: string, password: string) => req("DELETE", `/comments/${id}`, { password }),
  tags: (q: string) => req<string[]>("GET", `/tags?q=${encodeURIComponent(q)}`),
  adminCheck: () => req("POST", "/admin/check", {}),
  createContest: (c: Partial<Contest>) => req<Contest>("POST", "/admin/contests", c),
  updateContest: (id: string, c: Partial<Contest>) => req<Contest>("PUT", `/admin/contests/${id}`, c),
  deleteContest: (id: string) => req("DELETE", `/admin/contests/${id}`),
  reviewVotes: (id: string) =>
    req<{
      contest: Contest;
      entries: ReviewEntry[];
      votes: ReviewVote[];
      rule: { burstMinutes: number; burstCount: number };
    }>("GET", `/admin/contests/${id}/votes`),
  deleteVote: (id: string) => req("DELETE", `/admin/votes/${id}`),
};

// ---- 表示用 ----
export function fmtDate(s: string): string {
  const d = new Date(s);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const PHASE_LABEL: Record<Phase, string> = {
  upcoming: "開催前",
  submission: "投稿受付中",
  voting: "投票期間",
  closed: "結果発表",
};
