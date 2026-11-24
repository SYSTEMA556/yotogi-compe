import { A, useParams } from "@solidjs/router";
import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js";
import { adminToken, api, fmtDate, MAX_POINTS, MIN_VOTE_COMMENT, store, type PublicVote } from "./api";
import { ErrorBox, Field, PhaseBadge } from "./components";

// ===== 投票フォーム：点数を選ぶ → 一言感想 → 投票 =====
export function VoteBox(p: { entryId: string; myVote: PublicVote | null; onDone: () => void }) {
  const [points, setPoints] = createSignal(0);
  const [comment, setComment] = createSignal("");
  const [name, setName] = createSignal(store("voteName"));
  const [err, setErr] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  createEffect(() => {
    const v = p.myVote;
    setPoints(v?.points ?? 0);
    setComment(v?.comment ?? "");
    if (v) setName(v.name === "名無し" ? "" : v.name);
  });

  const len = () => comment().trim().length;
  const ready = () => points() > 0 && len() >= MIN_VOTE_COMMENT;

  const send = async (pts: number) => {
    setErr("");
    setBusy(true);
    try {
      await api.vote(p.entryId, { points: pts, comment: comment(), name: name() });
      store("voteName", name());
      p.onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="card vote-box">
      <h2>{p.myVote ? "あなたの投票（変更できます）" : "ポイントと感想で投票する"}</h2>
      <div class="step-label">① 点数を選ぶ</div>
      <div class="points">
        <For each={Array.from({ length: MAX_POINTS }, (_, i) => i + 1)}>
          {(n) => (
            <button
              type="button"
              class={"pt" + (points() === n ? " on" : "") + (points() >= n ? " fill" : "")}
              onClick={() => setPoints(n)}
            >
              {n}
            </button>
          )}
        </For>
      </div>
      <div class="step-label">② 一言感想（{MIN_VOTE_COMMENT}文字以上・必須）</div>
      <textarea
        rows={3}
        value={comment()}
        maxLength={1000}
        placeholder="どこが良かったか、ひとことでも"
        onInput={(e) => setComment(e.currentTarget.value)}
      />
      <div class="meter">
        <div class="meter-fill" style={{ width: `${Math.min(100, (len() / MIN_VOTE_COMMENT) * 100)}%` }} />
      </div>
      <div class="meta">
        {len() >= MIN_VOTE_COMMENT ? "✓ OK" : `あと ${MIN_VOTE_COMMENT - len()} 文字`}
      </div>
      <Field label="ハンドルネーム（任意）">
        <input value={name()} maxLength={50} placeholder="名無し" onInput={(e) => setName(e.currentTarget.value)} />
      </Field>
      <div class="note">感想と点数は結果発表まで公開されません。結果発表時に、この作品の作者を含む全員に公開されます。</div>
      <ErrorBox msg={err()} />
      <button class="btn block" disabled={!ready() || busy()} onClick={() => send(points())}>
        {busy() ? "送信中…" : p.myVote ? `${points()} pt で更新する` : points() ? `${points()} pt で投票する` : "点数を選んでください"}
      </button>
      <Show when={p.myVote}>
        <button class="link cancel" disabled={busy()} onClick={() => confirm("投票を取り消しますか？") && send(0)}>
          投票を取り消す
        </button>
      </Show>
    </section>
  );
}

// ===== 結果発表後：その作品への票と感想の一覧 =====
export function VoteList(p: { votes: PublicVote[] }) {
  const hist = createMemo(() => {
    const h = Array(MAX_POINTS + 1).fill(0);
    p.votes.forEach((v) => h[v.points]++);
    return h;
  });
  const maxH = () => Math.max(1, ...hist());
  return (
    <section class="comments">
      <h2>投票と感想 ({p.votes.length})</h2>
      <Show when={p.votes.length} fallback={<div class="muted">投票はありませんでした。</div>}>
        <div class="hist">
          <For each={hist().slice(1)}>
            {(n, i) => (
              <div class="hist-col">
                <div class="hist-bar" style={{ height: `${(n / maxH()) * 100}%` }} title={`${i() + 1}pt：${n}票`} />
                <div class="hist-label">{i() + 1}</div>
              </div>
            )}
          </For>
        </div>
        <For each={[...p.votes].sort((a, b) => a.createdAt.localeCompare(b.createdAt))}>
          {(v) => (
            <div class="comment">
              <div class="comment-head">
                <span class="pt-badge">{v.points} pt</span> <b>{v.name}</b> <span class="meta">{fmtDate(v.createdAt)}</span>
              </div>
              <div class="comment-body">{v.comment}</div>
            </div>
          )}
        </For>
      </Show>
    </section>
  );
}

// ===== 管理：票の偏りチェック =====
const FLAG_HELP: Record<string, string> = {
  短時間に集中: "同じ作品へ短い間に票がまとまって入った",
  同じIPから複数票: "同じ回線から、別ブラウザ扱いで同じ作品に複数票",
  同じ感想文: "コンペ内に同じ文面の感想がある（記号・空白の違いは無視）",
};

export function AdminVotesPage() {
  const params = useParams();
  const [data, { refetch }] = createResource(() => (adminToken() ? params.id : undefined), api.reviewVotes);
  const [onlyFlagged, setOnlyFlagged] = createSignal(true);
  const [entryFilter, setEntryFilter] = createSignal("");
  const [err, setErr] = createSignal("");

  const shown = createMemo(() =>
    (data()?.votes ?? []).filter(
      (v) => (!onlyFlagged() || v.flags.length) && (!entryFilter() || v.entryId === entryFilter()),
    ),
  );
  const flaggedCount = () => (data()?.votes ?? []).filter((v) => v.flags.length).length;

  const del = async (id: string) => {
    if (!confirm("この票を削除しますか？（元に戻せません）")) return;
    setErr("");
    try {
      await api.deleteVote(id);
      refetch();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div>
      <A href="/admin" class="back">
        ← 管理へ戻る
      </A>
      <Show when={adminToken()} fallback={<div class="card">先に管理画面でログインしてください。</div>}>
        <ErrorBox msg={data.error?.message ?? err()} />
        <Show when={data()}>
          {(d) => (
            <>
              <h1 class="page-title">
                <PhaseBadge phase={d().contest.phase} /> 票の確認：{d().contest.title}
              </h1>

              <div class="stat-row">
                <div class="stat">
                  <b>{d().votes.length}</b>
                  <span>総票数</span>
                </div>
                <div class={"stat" + (flaggedCount() ? " warn" : "")}>
                  <b>{flaggedCount()}</b>
                  <span>要確認の票</span>
                </div>
              </div>

              <div class="card flag-help">
                <For each={Object.entries(FLAG_HELP)}>
                  {([k, v]) => (
                    <div>
                      <span class="flag">{k}</span> {v}
                      {k === "短時間に集中" && `（${d().rule.burstMinutes}分以内に${d().rule.burstCount}票以上）`}
                    </div>
                  )}
                </For>
                <div class="muted">※ 目印は「疑い」です。人気作に自然に票が集まることもあるので、感想の中身も見て判断してください。</div>
              </div>

              <h2>作品別（管理者のみ・途中経過）</h2>
              <div class="card table-wrap">
                <table class="admin-table">
                  <thead>
                    <tr>
                      <th>No</th>
                      <th>作品</th>
                      <th>合計</th>
                      <th>票</th>
                      <th>要確認</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={d().entries}>
                      {(e) => (
                        <tr class={e.flagged ? "warn-row" : ""} onClick={() => setEntryFilter(entryFilter() === e.id ? "" : e.id)}>
                          <td>{e.no}</td>
                          <td>
                            {e.title}
                            <div class="meta">{e.penName}</div>
                          </td>
                          <td>{e.total}</td>
                          <td>{e.count}</td>
                          <td>{e.flagged || ""}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
                <div class="meta">行をタップすると、その作品の票だけを表示します。</div>
              </div>

              <div class="list-head">
                <h2>票の一覧（{shown().length}）</h2>
                <label class="check">
                  <input type="checkbox" checked={onlyFlagged()} onChange={(e) => setOnlyFlagged(e.currentTarget.checked)} />
                  要確認だけ
                </label>
              </div>
              <Show when={entryFilter()}>
                <button class="link" onClick={() => setEntryFilter("")}>
                  × 作品の絞り込みを解除
                </button>
              </Show>
              <Show when={shown().length} fallback={<div class="card muted">該当する票はありません。</div>}>
                <For each={shown()}>
                  {(v) => (
                    <div class={"card vote-row" + (v.flags.length ? " flagged" : "")}>
                      <div class="row">
                        <span>
                          <span class="pt-badge">{v.points} pt</span> No.{v.entryNo} {v.entryTitle}
                        </span>
                        <button class="btn danger-btn small" onClick={() => del(v.id)}>
                          削除
                        </button>
                      </div>
                      <div class="comment-body">{v.comment}</div>
                      <div class="meta">
                        {v.name}　{fmtDate(v.createdAt)}　回線:{v.ip || "-"}　ブラウザ:{v.voter}
                      </div>
                      <div class="tags">
                        <For each={v.flags}>{(f) => <span class="flag">{f}</span>}</For>
                      </div>
                    </div>
                  )}
                </For>
              </Show>
            </>
          )}
        </Show>
      </Show>
    </div>
  );
}
