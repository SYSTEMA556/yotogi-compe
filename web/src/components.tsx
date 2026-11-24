import { A } from "@solidjs/router";
import { createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import { api, fmtDate, PHASE_LABEL, SITE_NAME, type Contest, type Entry, type Phase } from "./api";
import { MARKUP_HELP, renderMarkup } from "./markup";

// ヘッダーとフッターは「Tailwind のクラスを直接書く」書き方の見本。
// ほかの部品は style.css の中で @apply を使ってまとめている。
export function Header() {
  return (
    <header class="sticky top-0 z-20 border-b border-gold/40 bg-gradient-to-r from-night via-night-2 to-crimson-dark shadow-lg shadow-black/30">
      <div class="mx-auto flex max-w-3xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <A href="/" class="group flex items-center gap-2">
          <span class="moon" aria-hidden="true" />
          <span class="font-serif text-xl font-black tracking-wider text-gold drop-shadow-[0_0_8px_rgba(212,175,55,.5)] transition group-hover:text-gold-light">
            {SITE_NAME}
          </span>
        </A>
        <nav class="flex gap-5 text-sm font-bold">
          <A href="/" end class="nav-link">
            コンペ一覧
          </A>
          <A href="/admin" class="nav-link">
            管理
          </A>
        </nav>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer class="mt-16 bg-night py-8 text-center text-sm text-white/60">
      <div class="mb-2 font-serif tracking-[0.3em] text-gold/80">― ✦ ―</div>© {new Date().getFullYear()} {SITE_NAME}
    </footer>
  );
}

export function PhaseBadge(p: { phase: Phase }) {
  return <span class={`badge phase-${p.phase}`}>{PHASE_LABEL[p.phase]}</span>;
}

export function Tags(p: { tags: string[] }) {
  return (
    <div class="tags">
      <For each={p.tags}>{(t) => <span class="tag">{t}</span>}</For>
    </div>
  );
}

export function Markup(p: { text: string; class?: string }) {
  return <div class={p.class ?? "markup"} innerHTML={renderMarkup(p.text)} />;
}

export function ErrorBox(p: { msg: string }) {
  return (
    <Show when={p.msg}>
      <div class="error">{p.msg}</div>
    </Show>
  );
}

// 現在時刻（1秒ごとに更新）。サーバー時刻とのずれを補正する
export function useClock(serverTime?: () => string | undefined) {
  const [now, setNow] = createSignal(Date.now());
  let offset = 0;
  const t = setInterval(() => {
    const st = serverTime?.();
    if (st && offset === 0) offset = new Date(st).getTime() - Date.now();
    setNow(Date.now() + offset);
  }, 1000);
  onCleanup(() => clearInterval(t));
  return now;
}

function remain(ms: number): string {
  if (ms <= 0) return "0秒";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return (d ? `${d}日 ` : "") + `${h}時間 ${m}分 ${sec}秒`;
}

// 期間の流れを1本の帯で見せる：受付前 → 投稿期間 → 投票期間 → 結果発表
export function Timeline(p: { contest: Contest }) {
  const now = useClock(() => p.contest.serverTime);
  const t = () => ({
    s: new Date(p.contest.submitStart).getTime(),
    se: new Date(p.contest.submitEnd).getTime(),
    ve: new Date(p.contest.voteEnd).getTime(),
  });
  const pct = () => {
    const { s, ve } = t();
    return Math.max(0, Math.min(100, ((now() - s) / (ve - s)) * 100));
  };
  const submitPct = () => {
    const { s, se, ve } = t();
    return ((se - s) / (ve - s)) * 100;
  };
  const next = () => {
    const { s, se, ve } = t();
    const n = now();
    if (n < s) return { label: "投稿受付開始まで", ms: s - n };
    if (n < se) return { label: "投稿締切まで", ms: se - n };
    if (n < ve) return { label: "結果発表（作者公開）まで", ms: ve - n };
    return null;
  };
  return (
    <div class="timeline">
      <div class="tl-bar">
        <div class="tl-seg tl-submit" style={{ width: `${submitPct()}%` }}>投稿</div>
        <div class="tl-seg tl-vote" style={{ width: `${100 - submitPct()}%` }}>投票</div>
        <div class="tl-now" style={{ left: `${pct()}%` }} />
      </div>
      <div class="tl-dates">
        <span>{fmtDate(p.contest.submitStart)}</span>
        <span>{fmtDate(p.contest.submitEnd)}</span>
        <span>{fmtDate(p.contest.voteEnd)}</span>
      </div>
      <Show when={next()} fallback={<div class="countdown done">結果発表済み</div>}>
        {(n) => (
          <div class="countdown">
            {n().label}　<b>{remain(n().ms)}</b>
          </div>
        )}
      </Show>
    </div>
  );
}

export function Author(p: { entry: Entry }) {
  return (
    <Show when={!p.entry.anonymous} fallback={<span class="anon">作者：？？？（結果発表まで非公開）</span>}>
      <span class="author">by {p.entry.penName}</span>
    </Show>
  );
}

export function EntryCard(p: { entry: Entry }) {
  const e = () => p.entry;
  return (
    <article class={"card entry-card" + (e().score?.rank === 1 ? " rank1" : "")}>
      <Show when={e().score}>
        {(s) => (
          <div class={`rank rank-${Math.min(s().rank, 4)}`}>
            <span class="rank-no">{s().rank}</span>位
          </div>
        )}
      </Show>
      <div class="entry-head">
        <A href={`/entries/${e().id}`} class="entry-title">
          {e().title}
        </A>
        <span class="no">No.{e().no}</span>
      </div>
      <Author entry={e()} />
      <div class="meta">
        投稿 {fmtDate(e().createdAt)}　コメント {e().commentCount}
      </div>
      <Show when={e().score}>
        {(s) => (
          <div class="score">
            <b>{s().total}</b> pt（{s().count}票・平均 {s().avg.toFixed(2)}）
          </div>
        )}
      </Show>
      <Show when={e().summary}>
        <p class="summary">{e().summary}</p>
      </Show>
      <Tags tags={e().tags} />
    </article>
  );
}

export function MarkupHelper() {
  const [open, setOpen] = createSignal(false);
  return (
    <div class="helper">
      <button type="button" class="helper-head" onClick={() => setOpen(!open())}>
        ⓘ 記法ヘルパー <span>{open() ? "▲" : "▼"}</span>
      </button>
      <Show when={open()}>
        <table class="helper-table">
          <For each={MARKUP_HELP}>
            {(h) => (
              <tr>
                <th>{h.name}</th>
                <td>
                  <code>{h.syntax}</code>
                  <div class="hint">
                    → <span innerHTML={renderMarkup(h.syntax)} />　{h.note}
                  </div>
                </td>
              </tr>
            )}
          </For>
        </table>
      </Show>
    </div>
  );
}

// タグ入力：Enter または候補クリックで追加
export function TagInput(p: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = createSignal("");
  const [cands, setCands] = createSignal<string[]>([]);
  let timer: number | undefined;
  const add = (t: string) => {
    t = t.trim();
    if (t && !p.value.includes(t) && p.value.length < 10) p.onChange([...p.value, t]);
    setText("");
    setCands([]);
  };
  const onInput = (v: string) => {
    setText(v);
    clearTimeout(timer);
    timer = window.setTimeout(async () => {
      if (!v.trim()) return setCands([]);
      try {
        setCands((await api.tags(v)).filter((t) => !p.value.includes(t)));
      } catch {
        setCands([]);
      }
    }, 250);
  };
  return (
    <div class="tag-input">
      <div class="tags">
        <For each={p.value}>
          {(t) => (
            <span class="tag removable" onClick={() => p.onChange(p.value.filter((x) => x !== t))}>
              {t} ×
            </span>
          )}
        </For>
      </div>
      <input
        value={text()}
        placeholder="タグを入力して Enter / 候補から選択…"
        onInput={(e) => onInput(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.isComposing) {
            e.preventDefault();
            add(text());
          }
        }}
      />
      <Show when={cands().length}>
        <div class="cands">
          <For each={cands()}>
            {(c) => (
              <button type="button" onClick={() => add(c)}>
                {c}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

export function Field(p: { label: string; required?: boolean; note?: string; children: JSX.Element }) {
  return (
    <label class="field">
      <span class="label">
        {p.label}
        <Show when={p.required}>
          <span class="req">*</span>
        </Show>
      </span>
      {p.children}
      <Show when={p.note}>
        <span class="note">{p.note}</span>
      </Show>
    </label>
  );
}
