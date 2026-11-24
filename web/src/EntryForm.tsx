import { createSignal, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { store, type EntryInput } from "./api";
import { ErrorBox, Field, Markup, MarkupHelper, Tags, TagInput } from "./components";

export function EntryForm(p: {
  mode: "create" | "edit";
  initial?: Partial<EntryInput>;
  onSubmit: (v: EntryInput) => Promise<void>;
}) {
  const [v, setV] = createStore<EntryInput>({
    title: "",
    summary: "",
    body: "",
    afterword: "",
    penName: store("penName"),
    password: "",
    newPassword: "",
    tags: [],
    allowComments: true,
    ...p.initial,
  });
  const [step, setStep] = createSignal<"form" | "preview">("form");
  const [live, setLive] = createSignal(false);
  const [err, setErr] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const toPreview = (e: Event) => {
    e.preventDefault();
    setErr("");
    if (!v.title.trim()) return setErr("タイトルを入力してください");
    if (!v.body.trim()) return setErr("本文を入力してください");
    if (!v.penName.trim()) return setErr("ペンネームを入力してください");
    if (p.mode === "create" && v.password.length < 4) return setErr("編集用パスワードは4文字以上にしてください");
    setStep("preview");
    window.scrollTo(0, 0);
  };

  const submit = async () => {
    setBusy(true);
    setErr("");
    try {
      store("penName", v.penName);
      await p.onSubmit({ ...v, tags: [...v.tags] });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Show
      when={step() === "form"}
      fallback={
        <div>
          <div class="card notice">プレビューです。内容を確認して「投稿する」を押してください。</div>
          <article class="card reader">
            <h1 class="entry-h1">{v.title}</h1>
            <div class="anon">作者：？？？（結果発表まで非公開）</div>
            <Tags tags={v.tags} />
            <Show when={v.summary}>
              <div class="summary-box">{v.summary}</div>
            </Show>
            <Markup text={v.body} class="markup body" />
            <Show when={v.afterword}>
              <h2 class="sub">あとがき（結果発表後に公開）</h2>
              <Markup text={v.afterword} class="markup afterword" />
            </Show>
          </article>
          <ErrorBox msg={err()} />
          <div class="actions">
            <button class="btn ghost" onClick={() => setStep("form")}>
              戻って直す
            </button>
            <button class="btn" disabled={busy()} onClick={submit}>
              {busy() ? "送信中…" : p.mode === "create" ? "投稿する" : "更新する"}
            </button>
          </div>
        </div>
      }
    >
      <MarkupHelper />
      <form class="card form" onSubmit={toPreview}>
        <Field label="タイトル" required>
          <input value={v.title} maxLength={100} placeholder="魅力的なタイトルを入力" onInput={(e) => setV("title", e.currentTarget.value)} />
        </Field>
        <Field label="作品概要" note="読者が作品を選ぶ際の参考になります">
          <textarea rows={3} value={v.summary} maxLength={500} placeholder="作品の概要を簡潔に説明（任意）" onInput={(e) => setV("summary", e.currentTarget.value)} />
        </Field>
        <Field label="本文" required note="ルビや傍点の記法が使えます。上の記法ヘルパーを参考にしてください">
          <textarea rows={14} value={v.body} placeholder="あなたの物語をここに…" onInput={(e) => setV("body", e.currentTarget.value)} />
        </Field>
        <div class="count">{v.body.length.toLocaleString()} 文字</div>
        <label class="check">
          <input type="checkbox" checked={live()} onChange={(e) => setLive(e.currentTarget.checked)} /> リアルタイムプレビューを表示
        </label>
        <Show when={live()}>
          <Markup text={v.body} class="markup body live" />
        </Show>
        <Field label="あとがき" note="結果発表（作者公開）と同時に公開されます。匿名期間中は表示されません">
          <textarea rows={4} value={v.afterword} placeholder="作品に関する後書きやコメント（任意）" onInput={(e) => setV("afterword", e.currentTarget.value)} />
        </Field>
        <Field label="ペンネーム" required note="🔒 結果発表まで他の人には表示されません">
          <input value={v.penName} maxLength={50} onInput={(e) => setV("penName", e.currentTarget.value)} />
        </Field>
        <Show
          when={p.mode === "create"}
          fallback={
            <Field label="新しい編集用パスワード" note="変更する場合のみ入力">
              <input type="password" value={v.newPassword ?? ""} onInput={(e) => setV("newPassword", e.currentTarget.value)} />
            </Field>
          }
        >
          <Field label="編集用パスワード" required note="投稿期間中に作品を編集・削除する際に必要です">
            <input type="password" value={v.password} placeholder="後で編集するためのパスワード" onInput={(e) => setV("password", e.currentTarget.value)} />
          </Field>
        </Show>
        <Field label="タグ" note="既存のタグから選ぶか、新しいタグを作れます（10個まで）">
          <TagInput value={v.tags} onChange={(t) => setV("tags", t)} />
        </Field>
        <label class="check">
          <input type="checkbox" checked={v.allowComments} onChange={(e) => setV("allowComments", e.currentTarget.checked)} /> コメントを許可する
        </label>
        <ErrorBox msg={err()} />
        <div class="actions">
          <button class="btn" type="submit">
            プレビューへ進む
          </button>
        </div>
      </form>
    </Show>
  );
}
