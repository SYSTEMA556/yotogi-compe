import { A, useNavigate, useParams } from "@solidjs/router";
import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { adminToken, api, fmtDate, MAX_POINTS, store, type Contest, type Entry } from "./api";
import { EntryForm } from "./EntryForm";
import { Author, EntryCard, ErrorBox, Field, Markup, PhaseBadge, Tags, Timeline } from "./components";
import { VoteBox, VoteList } from "./votes";

function Loading() {
  return <div class="loading">読み込み中…</div>;
}

// ===== コンペ一覧 =====
export function Home() {
  const [list] = createResource(api.contests);
  return (
    <div>
      <h1 class="page-title">コンペ一覧</h1>
      <Show when={!list.error} fallback={<ErrorBox msg={list.error?.message} />}>
        <Show when={list()} fallback={<Loading />}>
          <Show when={list()!.length} fallback={<div class="card">まだコンペはありません。</div>}>
            <For each={list()}>
              {(c) => (
                <A href={`/contests/${c.id}`} class="card contest-card">
                  <div class="row">
                    <PhaseBadge phase={c.phase} />
                    <span class="meta">{c.entryCount} 作品</span>
                  </div>
                  <div class="contest-title">{c.title}</div>
                  <div class="theme-line">
                    お題：<b>{c.theme}</b>
                  </div>
                  <div class="meta">
                    投稿 {fmtDate(c.submitStart)} 〜 {fmtDate(c.submitEnd)} ／ 結果発表 {fmtDate(c.voteEnd)}
                  </div>
                </A>
              )}
            </For>
          </Show>
        </Show>
      </Show>
    </div>
  );
}

// ===== コンペ詳細（作品一覧・結果） =====
export function ContestPage() {
  const params = useParams();
  const [data] = createResource(() => params.id, api.contest);
  const [order, setOrder] = createSignal(store("entryOrder") || "random");
  const seed = Math.random();

  const sorted = createMemo(() => {
    const d = data();
    if (!d) return [];
    const es = [...d.entries];
    if (d.contest.phase === "closed") return es; // サーバーが順位順で返す
    if (order() === "new") es.sort((a, b) => b.no - a.no);
    else if (order() === "old") es.sort((a, b) => a.no - b.no);
    else {
      // 並び順による有利不利を減らすため、閲覧者ごとにシャッフル（再描画では固定）
      const h = (s: string) => [...s].reduce((x, ch) => (x * 31 + ch.charCodeAt(0) + seed * 1e6) % 1e9, 7);
      es.sort((a, b) => h(a.id) - h(b.id));
    }
    return es;
  });

  return (
    <Show when={!data.error} fallback={<ErrorBox msg={data.error?.message} />}>
      <Show when={data()} fallback={<Loading />}>
        {(d) => {
          const c = () => d().contest;
          return (
            <div>
              <section class="card contest-hero">
                <PhaseBadge phase={c().phase} />
                <h1 class="contest-title">{c().title}</h1>
                <div class="theme-box">
                  <span class="theme-label">お題</span>
                  <span class="theme-text">{c().theme}</span>
                </div>
                <Timeline contest={c()} />
                <Show when={c().description}>
                  <p class="desc">{c().description}</p>
                </Show>
                <Show when={c().phase !== "closed"}>
                <ul class="rules">
                  <li>作者名・あとがきは <b>結果発表まで非公開</b> です。</li>
                  <li>各作品に 1〜{MAX_POINTS} ポイント＋一言感想で投票できます（1作品につき1票、変更可）。</li>
                  <li>感想と点数は結果発表時に作品ごとに公開されます。</li>
                  <li>得点と順位は結果発表時に公開されます。</li>
                </ul>
                </Show>
                <Show when={c().phase === "submission"}>
                  <A class="btn block" href={`/contests/${c().id}/submit`}>
                    ✎ このお題で作品を投稿する
                  </A>
                </Show>
              </section>

              <Show when={c().phase !== "upcoming"} fallback={<div class="card">投稿受付は {fmtDate(c().submitStart)} からです。</div>}>
                <div class="list-head">
                  <h2>{c().phase === "closed" ? "結果発表" : "参加作品"}（{d().entries.length}）</h2>
                  <Show when={c().phase !== "closed"}>
                    <select
                      value={order()}
                      onChange={(e) => {
                        setOrder(e.currentTarget.value);
                        store("entryOrder", e.currentTarget.value);
                      }}
                    >
                      <option value="random">ランダム順</option>
                      <option value="old">投稿順</option>
                      <option value="new">新着順</option>
                    </select>
                  </Show>
                </div>
                <Show when={sorted().length} fallback={<div class="card">まだ作品はありません。</div>}>
                  <For each={sorted()}>{(e) => <EntryCard entry={e} />}</For>
                </Show>
              </Show>
            </div>
          );
        }}
      </Show>
    </Show>
  );
}

// ===== 作品投稿 =====
export function SubmitPage() {
  const params = useParams();
  const nav = useNavigate();
  const [data] = createResource(() => params.id, api.contest);
  return (
    <Show when={data()} fallback={<Loading />}>
      {(d) => (
        <div>
          <A href={`/contests/${d().contest.id}`} class="back">
            ← {d().contest.title}
          </A>
          <div class="card theme-box">
            <span class="theme-label">お題</span>
            <span class="theme-text">{d().contest.theme}</span>
          </div>
          <Show when={d().contest.phase === "submission"} fallback={<div class="error">現在は投稿期間外です。</div>}>
            <EntryForm
              mode="create"
              onSubmit={async (v) => {
                const r = await api.createEntry(d().contest.id, v);
                nav(`/entries/${r.id}`);
              }}
            />
          </Show>
        </div>
      )}
    </Show>
  );
}

// ===== 作品閲覧 =====
export function EntryPage() {
  const params = useParams();
  const [data, { refetch }] = createResource(() => params.id, api.entry);
  const [comment, setComment] = createStore({ name: store("commentName"), body: "", password: store("commentPass") });
  const [cErr, setCErr] = createSignal("");

  const postComment = async (ev: Event) => {
    ev.preventDefault();
    setCErr("");
    try {
      await api.comment(params.id!, comment);
      store("commentName", comment.name);
      store("commentPass", comment.password);
      setComment("body", "");
      await refetch();
    } catch (e) {
      setCErr((e as Error).message);
    }
  };

  const delComment = async (id: string) => {
    const pw = adminToken() ? "" : prompt("削除パスワード（またはこの作品の編集パスワード）");
    if (pw === null) return;
    try {
      await api.deleteComment(id, pw);
      await refetch();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  return (
    <Show when={!data.error} fallback={<ErrorBox msg={data.error?.message} />}>
      <Show when={data()} fallback={<Loading />}>
        {(d) => {
          const e = () => d().entry as Entry;
          const c = () => d().contest as Contest;
          const canVote = () => c().phase === "submission" || c().phase === "voting";
          return (
            <div>
              <A href={`/contests/${c().id}`} class="back">
                ← {c().title}（お題：{c().theme}）
              </A>
              <section class="card entry-meta">
                <div class="meta">
                  投稿 {fmtDate(e().createdAt)}　最終更新 {fmtDate(e().updatedAt)}　No.{e().no}
                </div>
                <h1 class="entry-h1">{e().title}</h1>
                <Author entry={e()} />
                <Tags tags={e().tags} />
                <Show when={e().summary}>
                  <div class="summary-box">{e().summary}</div>
                </Show>
                <Show when={e().score}>
                  {(s) => (
                    <div class="score big">
                      🏆 {s().rank}位　<b>{s().total}</b> pt（{s().count}票・平均 {s().avg.toFixed(2)}）
                    </div>
                  )}
                </Show>
              </section>

              <article class="reader">
                <Markup text={e().body ?? ""} class="markup body" />
              </article>

              <Show
                when={!e().anonymous}
                fallback={<div class="card muted">あとがきは結果発表（{fmtDate(c().voteEnd)}）後に公開されます。</div>}
              >
                <Show when={e().afterword}>
                  <div class="card afterword">
                    <Markup text={e().afterword!} />
                  </div>
                </Show>
              </Show>

              <Show when={canVote()}>
                <VoteBox entryId={e().id} myVote={d().myVote} onDone={refetch} />
              </Show>
              <Show when={c().phase === "closed"}>
                <VoteList votes={d().votes} />
              </Show>

              <section class="comments">
                <h2>コメント ({d().comments.length})</h2>
                <For each={d().comments}>
                  {(cm, i) => (
                    <div class="comment">
                      <div class="comment-head">
                        #{i() + 1} <b>{cm.name}</b> <span class="meta">{fmtDate(cm.createdAt)}</span>
                        <button class="link del" title="削除" onClick={() => delComment(cm.id)}>
                          🗑
                        </button>
                      </div>
                      <div class="comment-body">{cm.body}</div>
                    </div>
                  )}
                </For>
                <Show when={e().allowComments} fallback={<div class="muted">この作品はコメントを受け付けていません。</div>}>
                  <form class="card form" onSubmit={postComment}>
                    <h3>コメントを投稿する</h3>
                    <Field label="本文">
                      <textarea rows={4} value={comment.body} placeholder="コメントを入力してください" onInput={(ev) => setComment("body", ev.currentTarget.value)} />
                    </Field>
                    <Field label="ハンドルネーム">
                      <input value={comment.name} onInput={(ev) => setComment("name", ev.currentTarget.value)} />
                    </Field>
                    <Field label="削除パスワード" required>
                      <input type="password" value={comment.password} onInput={(ev) => setComment("password", ev.currentTarget.value)} />
                    </Field>
                    <ErrorBox msg={cErr()} />
                    <button class="btn block" disabled={!comment.body.trim() || comment.password.length < 4}>
                      コメントを投稿
                    </button>
                  </form>
                </Show>
              </section>

              <Show when={c().phase === "submission" || adminToken()}>
                <div class="owner-link">
                  <A href={`/entries/${e().id}/edit`}>作者用：編集・削除</A>
                </div>
              </Show>
            </div>
          );
        }}
      </Show>
    </Show>
  );
}

// ===== 作品編集（パスワード認証 → フォーム） =====
export function EditPage() {
  const params = useParams();
  const nav = useNavigate();
  const [pw, setPw] = createSignal("");
  const [err, setErr] = createSignal("");
  const [initial, setInitial] = createSignal<Awaited<ReturnType<typeof api.authEntry>>>();

  const auth = async (ev: Event) => {
    ev.preventDefault();
    setErr("");
    try {
      setInitial(await api.authEntry(params.id!, pw()));
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const del = async () => {
    if (!confirm("本当にこの作品を削除しますか？（元に戻せません）")) return;
    try {
      await api.deleteEntry(params.id!, pw());
      nav("/");
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div>
      <A href={`/entries/${params.id}`} class="back">
        ← 作品に戻る
      </A>
      <Show
        when={initial()}
        fallback={
          <form class="card form" onSubmit={auth}>
            <h2>作品の編集・削除</h2>
            <Field label="編集用パスワード" required>
              <input type="password" value={pw()} onInput={(e) => setPw(e.currentTarget.value)} />
            </Field>
            <ErrorBox msg={err()} />
            <button class="btn block">認証する</button>
          </form>
        }
      >
        {(init) => (
          <>
            <EntryForm
              mode="edit"
              initial={{ ...init(), tags: [...(init().tags ?? [])] }}
              onSubmit={async (v) => {
                await api.updateEntry(params.id!, { ...v, password: pw() });
                nav(`/entries/${params.id}`);
              }}
            />
            <div class="danger card">
              <ErrorBox msg={err()} />
              <button class="btn danger-btn" onClick={del}>
                この作品を削除する
              </button>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}

// ===== 管理（コンペの作成・編集） =====
const toLocal = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const toISO = (local: string) => new Date(local).toISOString();

export function AdminPage() {
  const [token, setToken] = createSignal(adminToken());
  const [authed, setAuthed] = createSignal(false);
  const [err, setErr] = createSignal("");
  const [list, { refetch }] = createResource(authed, api.contests);
  const blank = () => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    const add = (days: number) => toLocal(new Date(d.getTime() + days * 86400000).toISOString());
    return { id: "", title: "", theme: "", description: "", submitStart: add(0), submitEnd: add(14), voteEnd: add(21) };
  };
  const [form, setForm] = createStore(blank());

  const login = async (ev?: Event) => {
    ev?.preventDefault();
    setErr("");
    adminToken(token());
    try {
      await api.adminCheck();
      setAuthed(true);
    } catch (e) {
      setErr((e as Error).message);
      adminToken("");
    }
  };
  if (token()) login();

  const save = async (ev: Event) => {
    ev.preventDefault();
    setErr("");
    const body = {
      title: form.title,
      theme: form.theme,
      description: form.description,
      submitStart: toISO(form.submitStart),
      submitEnd: toISO(form.submitEnd),
      voteEnd: toISO(form.voteEnd),
    };
    try {
      if (form.id) await api.updateContest(form.id, body);
      else await api.createContest(body);
      setForm(blank());
      refetch();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div>
      <h1 class="page-title">管理</h1>
      <Show
        when={authed()}
        fallback={
          <form class="card form" onSubmit={login}>
            <Field label="管理者トークン" note="サーバーの環境変数 ADMIN_TOKEN の値">
              <input type="password" value={token()} onInput={(e) => setToken(e.currentTarget.value)} />
            </Field>
            <ErrorBox msg={err()} />
            <button class="btn block">ログイン</button>
          </form>
        }
      >
        <form class="card form" onSubmit={save}>
          <h2>{form.id ? "コンペを編集" : "新しいコンペを作成"}</h2>
          <Field label="コンペ名" required>
            <input value={form.title} onInput={(e) => setForm("title", e.currentTarget.value)} />
          </Field>
          <Field label="お題" required>
            <input value={form.theme} onInput={(e) => setForm("theme", e.currentTarget.value)} />
          </Field>
          <Field label="説明・募集要項">
            <textarea rows={4} value={form.description} onInput={(e) => setForm("description", e.currentTarget.value)} />
          </Field>
          <Field label="① 投稿受付開始" required>
            <input type="datetime-local" value={form.submitStart} onInput={(e) => setForm("submitStart", e.currentTarget.value)} />
          </Field>
          <Field label="② 投稿締切（ここから投票のみ）" required>
            <input type="datetime-local" value={form.submitEnd} onInput={(e) => setForm("submitEnd", e.currentTarget.value)} />
          </Field>
          <Field label="③ 投票締切＝結果発表・作者公開" required>
            <input type="datetime-local" value={form.voteEnd} onInput={(e) => setForm("voteEnd", e.currentTarget.value)} />
          </Field>
          <ErrorBox msg={err()} />
          <div class="actions">
            <Show when={form.id}>
              <button type="button" class="btn ghost" onClick={() => setForm(blank())}>
                キャンセル
              </button>
            </Show>
            <button class="btn">{form.id ? "更新する" : "作成する"}</button>
          </div>
        </form>

        <h2>コンペ一覧</h2>
        <For each={list()}>
          {(c) => (
            <div class="card admin-row">
              <div>
                <PhaseBadge phase={c.phase} /> <b>{c.title}</b>（{c.theme}）{c.entryCount}作品
              </div>
              <div class="actions">
                <A class="btn small" href={`/admin/contests/${c.id}/votes`}>
                  票を確認
                </A>
                <button
                  class="btn ghost small"
                  onClick={() => {
                    setForm({
                      id: c.id,
                      title: c.title,
                      theme: c.theme,
                      description: c.description,
                      submitStart: toLocal(c.submitStart),
                      submitEnd: toLocal(c.submitEnd),
                      voteEnd: toLocal(c.voteEnd),
                    });
                    window.scrollTo(0, 0);
                  }}
                >
                  編集
                </button>
                <button
                  class="btn danger-btn small"
                  onClick={async () => {
                    if (!confirm(`「${c.title}」と全作品・投票・コメントを削除します。よろしいですか？`)) return;
                    await api.deleteContest(c.id);
                    refetch();
                  }}
                >
                  削除
                </button>
              </div>
            </div>
          )}
        </For>
        <p class="muted">管理者としてログイン中は、各作品の「編集・削除」やコメント削除がパスワードなしで行えます。</p>
      </Show>
    </div>
  );
}
